import {
  createDraftJob,
  generateImageWithCloubic,
  getConfigStatus,
  insertJob,
  updateJob,
  uploadSourceToS3,
} from "@/lib/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = crypto.randomUUID();

  try {
    const payload = await request.json();
    const record = await insertJob(
      createDraftJob({
        id,
        kind: "image",
        status: "pending",
        model: typeof payload.model === "string" ? payload.model : "",
        prompt: typeof payload.prompt === "string" ? payload.prompt : "",
        referenceImages: Array.isArray(payload.referenceImages)
          ? payload.referenceImages
          : [],
        requestPayload:
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : {},
        metadata: {
          provider: "cloubic",
        },
      }),
    );

    const result = await generateImageWithCloubic(payload);
    const uploaded = await uploadSourceToS3({
      source: result.source,
      kind: "image",
      jobId: id,
    });

    const updatedRecord = await updateJob(record.id, {
      status: "completed",
      model: String(result.requestBody.model),
      requestPayload: result.requestBody,
      sourceUrl: result.source,
      storageKey: uploaded.key,
      storageUrl: uploaded.url,
      resultText: result.content,
      metadata: {
        provider: "cloubic",
        rawResponse: result.response,
      },
    });

    return Response.json({
      ok: true,
      job: updatedRecord,
      config: getConfigStatus(),
    });
  } catch (error) {
    try {
      await updateJob(id, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "图片生成失败",
      });
    } catch {}

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "图片生成失败",
        config: getConfigStatus(),
      },
      {
        status: 400,
      },
    );
  }
}
