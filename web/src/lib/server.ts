import {
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { z } from "zod";

export type GenerationKind = "text" | "image" | "video";
export type GenerationStatus = "pending" | "completed" | "failed";

export type GenerationRecord = {
  id: string;
  kind: GenerationKind;
  status: GenerationStatus;
  model: string;
  prompt: string;
  systemPrompt: string | null;
  responseFormat: string | null;
  referenceImages: string[];
  requestPayload: Record<string, unknown>;
  resultText: string | null;
  sourceUrl: string | null;
  storageKey: string | null;
  storageUrl: string | null;
  providerTaskId: string | null;
  providerStatus: string | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type CloubicMessageContent =
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    >;

type CloubicResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  status?: string;
  data?: {
    status?: string;
    task_id?: string;
    video_url?: string;
    url?: string;
    file_url?: string;
    progress?: number;
    output?: {
      video_url?: string;
      url?: string;
      file_url?: string;
    };
    outputs?: Array<{
      video_url?: string;
      url?: string;
      file_url?: string;
    }>;
  };
  id?: string;
  task_id?: string;
  video_url?: string;
  url?: string;
  file_url?: string;
  progress?: number;
  model?: string;
  output?: {
    video_url?: string;
    url?: string;
    file_url?: string;
  };
  outputs?: Array<{
    video_url?: string;
    url?: string;
    file_url?: string;
  }>;
};

const defaultTextModel = "gemini-3-pro-preview";
const defaultImageModel = "gemini-3-pro-image-preview";
const defaultVideoModel = "kling-v3-omni-pro";

const textSchema = z.object({
  prompt: z.string().trim().min(1),
  systemPrompt: z.string().trim().max(2000).optional().or(z.literal("")),
  temperature: z.number().min(0).max(2).default(0.7),
  responseFormat: z.enum(["text", "json"]).default("text"),
  referenceImages: z.array(z.string().url()).default([]),
  model: z.string().trim().min(1).default(defaultTextModel),
});

const imageSchema = z.object({
  prompt: z.string().trim().min(1),
  referenceImages: z.array(z.string().url()).default([]),
  model: z.string().trim().min(1).default(defaultImageModel),
});

const shotPromptSchema = z.object({
  prompt: z.string().trim().min(1),
  duration: z.number().int().min(1).max(30).optional(),
});

const videoSchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1).default(defaultVideoModel),
  duration: z.number().int().min(1).max(30).default(5),
  imageUrl: z.string().url().optional().or(z.literal("")),
  endImageUrl: z.string().url().optional().or(z.literal("")),
  referenceImages: z.array(z.string().url()).default([]),
  aspectRatio: z.enum(["1:1", "4:3", "16:9", "9:16"]).default("9:16"),
  sound: z.enum(["on", "off"]).default("off"),
  shotPrompts: z.array(shotPromptSchema).default([]),
});

let pool: Pool | null = null;
let databaseReady: Promise<void> | null = null;
let schemaReady: Promise<void> | null = null;
let s3Client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;
let storageUrlBackfillReady: Promise<void> | null = null;

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string) {
  return process.env[name]?.trim() || undefined;
}

function shouldAutoProvisionInfrastructure() {
  return process.env.NODE_ENV !== "production";
}

function isPgConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function isS3Configured() {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_REGION &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

function isCloubicConfigured() {
  return Boolean(process.env.CLOUBIC_API_KEY);
}

function getPool() {
  if (!isPgConfigured()) {
    throw new Error("未配置 DATABASE_URL");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: getRequiredEnv("DATABASE_URL"),
      max: 10,
    });
  }

  return pool;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function getDatabaseNameFromConnectionString(connectionString: string) {
  const url = new URL(connectionString);
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

function getPostgresAdminConnectionString() {
  const explicitAdminUrl = getOptionalEnv("POSTGRES_ADMIN_URL");

  if (explicitAdminUrl) {
    return explicitAdminUrl;
  }

  const databaseUrl = getRequiredEnv("DATABASE_URL");
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";

  return url.toString();
}

function getMissingDatabaseMessage() {
  return shouldAutoProvisionInfrastructure()
    ? "DATABASE_URL 指向的数据库不存在，且自动创建失败"
    : "DATABASE_URL 指向的数据库不存在，请在部署前手动创建数据库";
}

function getMissingBucketMessage(bucket: string) {
  return shouldAutoProvisionInfrastructure()
    ? `S3 Bucket ${bucket} 不存在，且自动创建失败`
    : `S3 Bucket ${bucket} 不存在，请在部署前手动创建 Bucket`;
}

function isMissingDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "") : "";

  return code === "3D000" || message.includes("does not exist");
}

function isDuplicateDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && String(error.code ?? "") === "42P04";
}

async function ensureDatabase() {
  if (!isPgConfigured()) {
    return;
  }

  if (!databaseReady) {
    databaseReady = (async () => {
      try {
        await getPool().query("SELECT 1");
      } catch (error) {
        if (!isMissingDatabaseError(error)) {
          throw error;
        }

        if (!shouldAutoProvisionInfrastructure()) {
          throw new Error(getMissingDatabaseMessage());
        }

        const databaseUrl = getRequiredEnv("DATABASE_URL");
        const databaseName = getDatabaseNameFromConnectionString(databaseUrl);

        if (!databaseName) {
          throw new Error("无法从 DATABASE_URL 中解析数据库名称");
        }

        const adminPool = new Pool({
          connectionString: getPostgresAdminConnectionString(),
          max: 1,
        });

        try {
          await adminPool.query(
            `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
          );
        } catch (adminError) {
          if (!isDuplicateDatabaseError(adminError)) {
            throw new Error(getMissingDatabaseMessage(), {
              cause: adminError,
            });
          }
        } finally {
          await adminPool.end();
        }

        pool = null;
        await getPool().query("SELECT 1");
      }
    })().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }

  await databaseReady;
}

function getS3Client() {
  if (!isS3Configured()) {
    throw new Error("未完整配置 S3 环境变量");
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: getRequiredEnv("S3_REGION"),
      endpoint: getOptionalEnv("S3_ENDPOINT"),
      forcePathStyle: getOptionalEnv("S3_FORCE_PATH_STYLE") === "true",
      credentials: {
        accessKeyId: getRequiredEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: getRequiredEnv("S3_SECRET_ACCESS_KEY"),
      },
    });
  }

  return s3Client;
}

function isMissingBucketError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? String(error.name ?? "") : "";
  const code = "Code" in error ? String(error.Code ?? "") : "";
  const httpStatusCode =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? Number(error.$metadata.httpStatusCode)
      : 0;

  return (
    name === "NotFound" ||
    name === "NoSuchBucket" ||
    code === "NoSuchBucket" ||
    httpStatusCode === 404
  );
}

async function ensureBucket() {
  if (!isS3Configured()) {
    return;
  }

  if (!bucketReady) {
    bucketReady = (async () => {
      const client = getS3Client();
      const bucket = getRequiredEnv("S3_BUCKET");
      const region = getRequiredEnv("S3_REGION");

      try {
        await client.send(
          new HeadBucketCommand({
            Bucket: bucket,
          }),
        );
      } catch (error) {
        if (!isMissingBucketError(error)) {
          throw error;
        }

        if (!shouldAutoProvisionInfrastructure()) {
          throw new Error(getMissingBucketMessage(bucket));
        }

        const createBucketInput: CreateBucketCommandInput = {
          Bucket: bucket,
        };

        if (region !== "us-east-1") {
          createBucketInput.CreateBucketConfiguration = {
            LocationConstraint: region as BucketLocationConstraint,
          };
        }

        await client.send(
          new CreateBucketCommand(createBucketInput),
        );
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }

  await bucketReady;
}

async function ensureSchema() {
  if (!isPgConfigured()) {
    return;
  }

  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureDatabase();
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS generation_jobs (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt TEXT NOT NULL,
          system_prompt TEXT,
          response_format TEXT,
          reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
          request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          result_text TEXT,
          source_url TEXT,
          storage_key TEXT,
          storage_url TEXT,
          provider_task_id TEXT,
          provider_status TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await getPool().query(`
        CREATE INDEX IF NOT EXISTS generation_jobs_created_at_idx
        ON generation_jobs (created_at DESC);
      `);
      await backfillStorageUrls();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}

export async function ensureAppInfrastructure() {
  await Promise.all([ensureSchema(), ensureBucket()]);
}

async function backfillStorageUrls() {
  if (!isPgConfigured() || !isS3Configured()) {
    return;
  }

  if (!storageUrlBackfillReady) {
    storageUrlBackfillReady = (async () => {
      const publicBaseUrl = getOptionalEnv("S3_PUBLIC_BASE_URL");

      if (!publicBaseUrl) {
        return;
      }

      const result = await getPool().query<{
        id: string;
        storage_key: string | null;
        storage_url: string | null;
      }>(`
        SELECT id, storage_key, storage_url
        FROM generation_jobs
        WHERE storage_key IS NOT NULL
      `);

      const updates = result.rows
        .map((row) => {
          const storageKey = row.storage_key?.trim();
          const storageUrl = row.storage_url?.trim() ?? null;

          if (!storageKey) {
            return null;
          }

          const legacyUrl = `${publicBaseUrl.replace(/\/$/, "")}/${storageKey}`;
          const expectedUrl = buildStorageUrl(storageKey);

          if (storageUrl && storageUrl !== legacyUrl) {
            return null;
          }

          if (storageUrl === expectedUrl) {
            return null;
          }

          return {
            id: row.id,
            storageUrl: expectedUrl,
          };
        })
        .filter(
          (
            value,
          ): value is {
            id: string;
            storageUrl: string;
          } => Boolean(value),
        );

      if (!updates.length) {
        return;
      }

      await Promise.all(
        updates.map((item) =>
          getPool().query(
            `
              UPDATE generation_jobs
              SET storage_url = $2, updated_at = NOW()
              WHERE id = $1
            `,
            [item.id, item.storageUrl],
          ),
        ),
      );
    })().catch((error) => {
      storageUrlBackfillReady = null;
      throw error;
    });
  }

  await storageUrlBackfillReady;
}

export function normalizeVideoGenerationStatus(input: {
  currentStatus: string | null;
  providerStatus: string | null;
  sourceUrl: string | null;
  storageUrl: string | null;
}): GenerationStatus {
  const normalizedCurrentStatus = input.currentStatus?.trim().toLowerCase();
  const normalizedProviderStatus = input.providerStatus?.trim().toLowerCase();

  if (
    normalizedProviderStatus === "completed" ||
    normalizedProviderStatus === "complete" ||
    normalizedProviderStatus === "succeeded" ||
    normalizedProviderStatus === "succeed" ||
    normalizedProviderStatus === "success" ||
    input.sourceUrl ||
    input.storageUrl
  ) {
    return "completed";
  }

  if (
    normalizedProviderStatus === "failed" ||
    normalizedProviderStatus === "fail" ||
    normalizedProviderStatus === "error" ||
    normalizedProviderStatus === "canceled" ||
    normalizedProviderStatus === "cancelled"
  ) {
    return "failed";
  }

  if (
    normalizedCurrentStatus === "completed" ||
    normalizedCurrentStatus === "failed"
  ) {
    return normalizedCurrentStatus;
  }

  return "pending";
}

function normalizeRecord(row: Record<string, unknown>): GenerationRecord {
  const kind = row.kind as GenerationKind;
  const rawStatus = row.status ? String(row.status) : null;
  const sourceUrl = row.source_url ? String(row.source_url) : null;
  const storageUrl = row.storage_url ? String(row.storage_url) : null;
  const providerStatus = row.provider_status ? String(row.provider_status) : null;

  return {
    id: String(row.id),
    kind,
    status:
      kind === "video"
        ? normalizeVideoGenerationStatus({
            currentStatus: rawStatus,
            providerStatus,
            sourceUrl,
            storageUrl,
          })
        : (rawStatus as GenerationStatus),
    model: String(row.model),
    prompt: String(row.prompt),
    systemPrompt: row.system_prompt ? String(row.system_prompt) : null,
    responseFormat: row.response_format ? String(row.response_format) : null,
    referenceImages: Array.isArray(row.reference_images)
      ? (row.reference_images as string[])
      : [],
    requestPayload:
      row.request_payload && typeof row.request_payload === "object"
        ? (row.request_payload as Record<string, unknown>)
        : {},
    resultText: row.result_text ? String(row.result_text) : null,
    sourceUrl,
    storageKey: row.storage_key ? String(row.storage_key) : null,
    storageUrl,
    providerTaskId: row.provider_task_id ? String(row.provider_task_id) : null,
    providerStatus,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listRecentJobs(limit = 12) {
  if (!isPgConfigured()) {
    return [];
  }

  await ensureSchema();

  const result = await getPool().query(
    `
      SELECT *
      FROM generation_jobs
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit],
  );

  return result.rows.map((row) =>
    normalizeRecord(row as unknown as Record<string, unknown>),
  );
}

export async function getJobById(id: string) {
  if (!isPgConfigured()) {
    return null;
  }

  await ensureSchema();

  const result = await getPool().query(
    `
      SELECT *
      FROM generation_jobs
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  if (!result.rows[0]) {
    return null;
  }

  return normalizeRecord(result.rows[0] as unknown as Record<string, unknown>);
}

export async function insertJob(
  job: Omit<GenerationRecord, "createdAt" | "updatedAt">,
) {
  if (!isPgConfigured()) {
    throw new Error("未配置 DATABASE_URL，无法写入任务记录");
  }

  await ensureSchema();

  const result = await getPool().query(
    `
      INSERT INTO generation_jobs (
        id,
        kind,
        status,
        model,
        prompt,
        system_prompt,
        response_format,
        reference_images,
        request_payload,
        result_text,
        source_url,
        storage_key,
        storage_url,
        provider_task_id,
        provider_status,
        metadata,
        error_message
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16::jsonb, $17
      )
      RETURNING *
    `,
    [
      job.id,
      job.kind,
      job.status,
      job.model,
      job.prompt,
      job.systemPrompt,
      job.responseFormat,
      JSON.stringify(job.referenceImages),
      JSON.stringify(job.requestPayload),
      job.resultText,
      job.sourceUrl,
      job.storageKey,
      job.storageUrl,
      job.providerTaskId,
      job.providerStatus,
      JSON.stringify(job.metadata),
      job.errorMessage,
    ],
  );

  return normalizeRecord(result.rows[0] as unknown as Record<string, unknown>);
}

export async function updateJob(
  id: string,
  patch: Partial<Omit<GenerationRecord, "id" | "createdAt" | "updatedAt">>,
) {
  if (!isPgConfigured()) {
    throw new Error("未配置 DATABASE_URL，无法更新任务记录");
  }

  await ensureSchema();

  const current = await getJobById(id);

  if (!current) {
    throw new Error("任务不存在");
  }

  const next: Omit<GenerationRecord, "createdAt" | "updatedAt"> = {
    ...current,
    ...patch,
    id: current.id,
    kind: (patch.kind ?? current.kind) as GenerationKind,
    status: (patch.status ?? current.status) as GenerationStatus,
    model: patch.model ?? current.model,
    prompt: patch.prompt ?? current.prompt,
    systemPrompt:
      patch.systemPrompt === undefined
        ? current.systemPrompt
        : patch.systemPrompt,
    responseFormat:
      patch.responseFormat === undefined
        ? current.responseFormat
        : patch.responseFormat,
    referenceImages: patch.referenceImages ?? current.referenceImages,
    requestPayload: patch.requestPayload ?? current.requestPayload,
    resultText:
      patch.resultText === undefined ? current.resultText : patch.resultText,
    sourceUrl: patch.sourceUrl === undefined ? current.sourceUrl : patch.sourceUrl,
    storageKey:
      patch.storageKey === undefined ? current.storageKey : patch.storageKey,
    storageUrl:
      patch.storageUrl === undefined ? current.storageUrl : patch.storageUrl,
    providerTaskId:
      patch.providerTaskId === undefined
        ? current.providerTaskId
        : patch.providerTaskId,
    providerStatus:
      patch.providerStatus === undefined
        ? current.providerStatus
        : patch.providerStatus,
    metadata: patch.metadata ?? current.metadata,
    errorMessage:
      patch.errorMessage === undefined
        ? current.errorMessage
        : patch.errorMessage,
  };

  const result = await getPool().query(
    `
      UPDATE generation_jobs
      SET
        kind = $2,
        status = $3,
        model = $4,
        prompt = $5,
        system_prompt = $6,
        response_format = $7,
        reference_images = $8::jsonb,
        request_payload = $9::jsonb,
        result_text = $10,
        source_url = $11,
        storage_key = $12,
        storage_url = $13,
        provider_task_id = $14,
        provider_status = $15,
        metadata = $16::jsonb,
        error_message = $17,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      next.kind,
      next.status,
      next.model,
      next.prompt,
      next.systemPrompt,
      next.responseFormat,
      JSON.stringify(next.referenceImages),
      JSON.stringify(next.requestPayload),
      next.resultText,
      next.sourceUrl,
      next.storageKey,
      next.storageUrl,
      next.providerTaskId,
      next.providerStatus,
      JSON.stringify(next.metadata),
      next.errorMessage,
    ],
  );

  return normalizeRecord(result.rows[0] as unknown as Record<string, unknown>);
}

async function cloubicFetch<T>(path: string, init: RequestInit) {
  const apiKey = getRequiredEnv("CLOUBIC_API_KEY");
  const baseUrl =
    getOptionalEnv("CLOUBIC_BASE_URL") ?? "https://api.cloubic.com/v1";

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const rawText = await response.text();
  const payload = rawText ? (JSON.parse(rawText) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(
      `Cloubic 请求失败：${response.status} ${response.statusText} ${rawText}`,
    );
  }

  return payload;
}

function buildUserContent(prompt: string, referenceImages: string[]) {
  if (!referenceImages.length) {
    return prompt;
  }

  const content: CloubicMessageContent = [
    {
      type: "text",
      text: prompt,
    },
    ...referenceImages.map((url) => ({
      type: "image_url" as const,
      image_url: {
        url,
      },
    })),
  ];

  return content;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item) {
          return String(item.text ?? "");
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function findImageLikeValue(input: unknown): string | null {
  if (typeof input === "string") {
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(input)) {
      return input;
    }

    if (/^https?:\/\/\S+/i.test(input)) {
      return input;
    }
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findImageLikeValue(item);

      if (value) {
        return value;
      }
    }
  }

  if (input && typeof input === "object") {
    const preferredKeys = [
      "imageUrl",
      "image_url",
      "url",
      "dataUri",
      "data_uri",
      "image",
      "src",
    ];

    for (const key of preferredKeys) {
      if (key in input) {
        const value = findImageLikeValue((input as Record<string, unknown>)[key]);

        if (value) {
          return value;
        }
      }
    }

    for (const value of Object.values(input)) {
      const nestedValue = findImageLikeValue(value);

      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return null;
}

function extractImageSource(content: string) {
  const markdownMatch = content.match(/!\[[^\]]*]\(([^)]+)\)/);

  if (markdownMatch?.[1]) {
    return markdownMatch[1];
  }

  const dataUriMatch = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);

  if (dataUriMatch?.[0]) {
    return dataUriMatch[0];
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    const imageValue = findImageLikeValue(parsed);

    if (imageValue) {
      return imageValue;
    }
  } catch {}

  const urlMatch = content.match(/https?:\/\/\S+/i);

  if (urlMatch?.[0]) {
    return urlMatch[0];
  }

  return null;
}

function getFileExtension(contentType: string | null, source: string) {
  if (contentType?.includes("png")) {
    return "png";
  }

  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) {
    return "jpg";
  }

  if (contentType?.includes("webp")) {
    return "webp";
  }

  if (contentType?.includes("gif")) {
    return "gif";
  }

  if (contentType?.includes("mp4")) {
    return "mp4";
  }

  if (contentType?.includes("quicktime")) {
    return "mov";
  }

  const cleanSource = source.split("?")[0]?.toLowerCase() ?? "";

  if (cleanSource.endsWith(".png")) {
    return "png";
  }

  if (cleanSource.endsWith(".jpg") || cleanSource.endsWith(".jpeg")) {
    return "jpg";
  }

  if (cleanSource.endsWith(".webp")) {
    return "webp";
  }

  if (cleanSource.endsWith(".gif")) {
    return "gif";
  }

  if (cleanSource.endsWith(".mp4")) {
    return "mp4";
  }

  if (cleanSource.endsWith(".mov")) {
    return "mov";
  }

  return "bin";
}

function sanitizeFileName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, "-");
  const safe = normalized.replace(/[^a-z0-9._-]/g, "");

  return safe || "asset";
}

function getPublicStorageBaseUrl(baseUrl: string, bucket: string) {
  try {
    const url = new URL(baseUrl);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const hostIncludesBucket =
      url.hostname === bucket || url.hostname.startsWith(`${bucket}.`);
    const pathIncludesBucket = pathSegments.includes(bucket);

    if (!hostIncludesBucket && !pathIncludesBucket) {
      pathSegments.push(bucket);
      url.pathname = `/${pathSegments.join("/")}`;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    if (
      normalizedBaseUrl === bucket ||
      normalizedBaseUrl.endsWith(`/${bucket}`) ||
      normalizedBaseUrl.includes(`://${bucket}.`)
    ) {
      return normalizedBaseUrl;
    }

    return `${normalizedBaseUrl}/${bucket}`;
  }
}

function buildStorageUrl(key: string) {
  const publicBaseUrl = getOptionalEnv("S3_PUBLIC_BASE_URL");
  const bucket = getRequiredEnv("S3_BUCKET");

  if (publicBaseUrl) {
    return `${getPublicStorageBaseUrl(publicBaseUrl, bucket)}/${key}`;
  }

  const endpoint = getOptionalEnv("S3_ENDPOINT");
  const region = getRequiredEnv("S3_REGION");

  if (endpoint) {
    return `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
  }

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function uploadSourceToS3(input: {
  source: string;
  kind: "image" | "video";
  jobId: string;
}) {
  await ensureBucket();

  const client = getS3Client();
  const bucket = getRequiredEnv("S3_BUCKET");
  const datePrefix = new Date().toISOString().slice(0, 10);
  let body: Uint8Array;
  let contentType: string | null = null;

  if (input.source.startsWith("data:")) {
    const [meta, data] = input.source.split(",", 2);

    if (!meta || !data) {
      throw new Error("无效的 Data URI");
    }

    const mimeMatch = meta.match(/^data:([^;]+);base64$/);
    contentType = mimeMatch?.[1] ?? "application/octet-stream";
    body = Buffer.from(data, "base64");
  } else {
    const response = await fetch(input.source);

    if (!response.ok) {
      throw new Error(`下载资源失败：${response.status} ${response.statusText}`);
    }

    contentType = response.headers.get("content-type");
    body = new Uint8Array(await response.arrayBuffer());
  }

  const extension = getFileExtension(contentType, input.source);
  const key = `${input.kind}/${datePrefix}/${input.jobId}.${extension}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    }),
  );

  return {
    key,
    url: buildStorageUrl(key),
  };
}

export async function uploadBufferToS3(input: {
  body: Uint8Array;
  contentType: string;
  folder: string;
  fileName?: string;
}) {
  await ensureBucket();

  const client = getS3Client();
  const bucket = getRequiredEnv("S3_BUCKET");
  const datePrefix = new Date().toISOString().slice(0, 10);
  const extension = getFileExtension(input.contentType, input.fileName ?? "");
  const baseName = sanitizeFileName(
    input.fileName?.replace(/\.[^.]+$/, "") ?? crypto.randomUUID(),
  );
  const key = `${input.folder}/${datePrefix}/${baseName}-${crypto.randomUUID()}.${extension}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );

  return {
    key,
    url: buildStorageUrl(key),
  };
}

export function parseTextPayload(input: unknown) {
  return textSchema.parse(input);
}

export function parseImagePayload(input: unknown) {
  return imageSchema.parse(input);
}

export function parseVideoPayload(input: unknown) {
  return videoSchema.parse(input);
}

export async function generateTextWithCloubic(input: unknown) {
  const payload = parseTextPayload(input);
  const messages: Array<{ role: string; content: CloubicMessageContent }> = [];

  if (payload.systemPrompt) {
    messages.push({
      role: "system",
      content: payload.systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: buildUserContent(payload.prompt, payload.referenceImages),
  });

  const body: Record<string, unknown> = {
    model: payload.model,
    messages,
    temperature: payload.temperature,
  };

  if (payload.responseFormat === "json") {
    body.response_format = {
      type: "json_object",
    };
  }

  const response = await cloubicFetch<CloubicResponse>("/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    requestBody: body,
    response,
    content: extractTextContent(response.choices?.[0]?.message?.content),
  };
}

export async function generateImageWithCloubic(input: unknown) {
  const payload = parseImagePayload(input);
  const body = {
    model: payload.model,
    messages: [
      {
        role: "user",
        content: buildUserContent(payload.prompt, payload.referenceImages),
      },
    ],
    n: 1,
  };

  const response = await cloubicFetch<CloubicResponse>("/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const content = extractTextContent(response.choices?.[0]?.message?.content);
  const source = extractImageSource(content);

  if (!source) {
    throw new Error("未能从 Cloubic 响应中提取图片地址");
  }

  return {
    requestBody: body,
    response,
    content,
    source,
  };
}

function extractTaskId(response: CloubicResponse) {
  return response.id ?? response.task_id ?? response.data?.task_id ?? null;
}

function extractTaskStatus(response: CloubicResponse) {
  return response.status ?? response.data?.status ?? null;
}

function pickFirstString(...values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function extractVideoSource(response: CloubicResponse) {
  return pickFirstString(
    response.video_url,
    response.url,
    response.file_url,
    response.output?.video_url,
    response.output?.url,
    response.output?.file_url,
    response.outputs?.[0]?.video_url,
    response.outputs?.[0]?.url,
    response.outputs?.[0]?.file_url,
    response.data?.video_url,
    response.data?.url,
    response.data?.file_url,
    response.data?.output?.video_url,
    response.data?.output?.url,
    response.data?.output?.file_url,
    response.data?.outputs?.[0]?.video_url,
    response.data?.outputs?.[0]?.url,
    response.data?.outputs?.[0]?.file_url,
  );
}

function buildVideoRequestBody(payload: z.infer<typeof videoSchema>) {
  const imageList = payload.referenceImages.map((imageUrl) => ({
    image_url: imageUrl,
  }));
  const isOmniModel = payload.model.includes("kling-v3-omni");
  const multiPrompt = payload.shotPrompts.map((item) => ({
    prompt: item.prompt,
    ...(item.duration ? { duration: item.duration } : {}),
  }));
  const metadata: Record<string, unknown> = {
    aspect_ratio: payload.aspectRatio,
    sound: payload.sound,
  };

  if (imageList.length) {
    metadata.image_list = imageList;
  }

  if (multiPrompt.length) {
    metadata.multi_prompt = multiPrompt;
  }

  if (isOmniModel) {
    metadata.multi_shot = false;
  } else if (multiPrompt.length) {
    metadata.multi_shot = true;
    metadata.generation_mode = "multi_shot";
    metadata.shot_type = "customize";
    metadata.images = [
      ...new Set(
        [payload.imageUrl, ...payload.referenceImages].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ];
  }

  const body: Record<string, unknown> = {
    model: payload.model,
    prompt: multiPrompt.length && !isOmniModel
      ? "生成模式：智能分镜视频。请基于完整分镜自动组织镜头切换、节奏与衔接。"
      : payload.prompt,
    duration: payload.duration,
    metadata,
  };

  if (payload.imageUrl) {
    body.image_url = payload.imageUrl;
  }

  if (payload.endImageUrl) {
    body.end_image_url = payload.endImageUrl;
  }

  return body;
}

export async function submitVideoWithCloubic(input: unknown) {
  const payload = parseVideoPayload(input);
  const body = buildVideoRequestBody(payload);
  const response = await cloubicFetch<CloubicResponse>("/video/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    requestBody: body,
    response,
    providerTaskId: extractTaskId(response),
    providerStatus: extractTaskStatus(response),
  };
}

export async function getVideoStatusWithCloubic(providerTaskId: string) {
  const response = await cloubicFetch<CloubicResponse>(
    `/video/generations/${providerTaskId}`,
    {
      method: "GET",
    },
  );

  return {
    response,
    providerTaskId,
    providerStatus: extractTaskStatus(response),
    videoUrl: extractVideoSource(response),
    progress:
      typeof response.progress === "number"
        ? response.progress
        : response.data?.progress ?? null,
  };
}

export function createDraftJob(input: {
  id: string;
  kind: GenerationKind;
  status: GenerationStatus;
  model: string;
  prompt: string;
  systemPrompt?: string | null;
  responseFormat?: string | null;
  referenceImages?: string[];
  requestPayload?: Record<string, unknown>;
  resultText?: string | null;
  sourceUrl?: string | null;
  storageKey?: string | null;
  storageUrl?: string | null;
  providerTaskId?: string | null;
  providerStatus?: string | null;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
}): Omit<GenerationRecord, "createdAt" | "updatedAt"> {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    model: input.model,
    prompt: input.prompt,
    systemPrompt: input.systemPrompt ?? null,
    responseFormat: input.responseFormat ?? null,
    referenceImages: input.referenceImages ?? [],
    requestPayload: input.requestPayload ?? {},
    resultText: input.resultText ?? null,
    sourceUrl: input.sourceUrl ?? null,
    storageKey: input.storageKey ?? null,
    storageUrl: input.storageUrl ?? null,
    providerTaskId: input.providerTaskId ?? null,
    providerStatus: input.providerStatus ?? null,
    metadata: input.metadata ?? {},
    errorMessage: input.errorMessage ?? null,
  };
}

export function getConfigStatus() {
  return {
    cloubic: isCloubicConfigured(),
    postgres: isPgConfigured(),
    s3: isS3Configured(),
    defaults: {
      textModel: defaultTextModel,
      imageModel: defaultImageModel,
      videoModel: defaultVideoModel,
    },
  };
}
