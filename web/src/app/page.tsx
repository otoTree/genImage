"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type GenerationKind = "text" | "image" | "video";
type GenerationStatus = "pending" | "completed" | "failed";

type GenerationJob = {
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

type ConfigStatus = {
  cloubic: boolean;
  postgres: boolean;
  s3: boolean;
  defaults: {
    textModel: string;
    imageModel: string;
    videoModel: string;
  };
};

type PromptTemplate = {
  id: string;
  kind: GenerationKind;
  title: string;
  description: string | null;
  prompt: string;
  systemPrompt: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  config?: ConfigStatus;
  job?: GenerationJob;
  jobs?: GenerationJob[];
  prompt?: PromptTemplate;
  prompts?: PromptTemplate[];
};

type UploadItem = {
  name: string;
  type: string;
  size: number;
  key: string;
  url: string;
};

type UploadResponse = {
  ok: boolean;
  error?: string;
  config?: ConfigStatus;
  files?: UploadItem[];
};

type PreviewAsset =
  | {
      kind: "image";
      url: string;
    }
  | {
      kind: "video";
      url: string;
    };

type ThumbnailListProps = {
  urls: string[];
  emptyText?: string;
  onPreview: (url: string) => void;
  onRemove: (url: string) => void;
};

const statusLabels: Record<GenerationStatus, string> = {
  pending: "进行中",
  completed: "已完成",
  failed: "失败",
};

function splitMultilineUrls(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitShotPrompts(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((prompt) => ({ prompt }));
}

function mergeUrlLines(currentValue: string, nextUrls: string[]) {
  return [...new Set([...splitMultilineUrls(currentValue), ...nextUrls])].join("\n");
}

function removeUrlLine(currentValue: string, targetUrl: string) {
  return splitMultilineUrls(currentValue)
    .filter((url) => url !== targetUrl)
    .join("\n");
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function getConfigDisplayState(
  ready: boolean | undefined,
  loading: boolean,
): { label: string; readiness: "true" | "false" | "loading" } {
  if (loading && ready === undefined) {
    return {
      label: "检测中",
      readiness: "loading",
    };
  }

  return {
    label: ready ? "已配置" : "未配置",
    readiness: ready ? "true" : "false",
  };
}

function ThumbnailList({
  urls,
  emptyText = "暂未上传图片",
  onPreview,
  onRemove,
}: ThumbnailListProps) {
  const hasItems = urls.length > 0;

  return (
    <div className={styles.thumbnailSection}>
      {!hasItems ? <div className={styles.helperText}>{emptyText}</div> : null}
      {hasItems ? (
        <div className={styles.previewGrid}>
          {urls.map((url) => (
            <div className={styles.previewCard} key={url}>
              <button
                className={styles.previewThumb}
                onClick={() => onPreview(url)}
                style={{ backgroundImage: `url(${url})` }}
                type="button"
              />
              <div className={styles.previewActions}>
                <button
                  className={styles.previewAction}
                  onClick={() => onPreview(url)}
                  type="button"
                >
                  放大
                </button>
                <button
                  className={styles.previewActionDanger}
                  onClick={() => onRemove(url)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<GenerationKind>("image");
  const [loading, setLoading] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);
  const [message, setMessage] = useState<string>("");
  const [currentJob, setCurrentJob] = useState<GenerationJob | null>(null);
  const [selectedTextPromptId, setSelectedTextPromptId] = useState<string>("");
  const [selectedImagePromptId, setSelectedImagePromptId] = useState<string>("");
  const [selectedVideoPromptId, setSelectedVideoPromptId] = useState<string>("");
  const [textForm, setTextForm] = useState({
    model: "gemini-3-pro-preview",
    prompt: "请结合参考图，写一段适合电商主图的卖点文案。",
    systemPrompt: "你是一个专业的电商内容创作助手。",
    temperature: "0.7",
    responseFormat: "text",
    referenceImages: "",
  });
  const [imageForm, setImageForm] = useState({
    model: "gemini-3-pro-image-preview",
    prompt: "请生成一张高级感女装电商棚拍主图，纯色背景，柔和自然光。",
    referenceImages: "",
  });
  const [videoForm, setVideoForm] = useState({
    model: "kling-v3-omni-pro",
    prompt: "一条浅色连衣裙在自然光下缓慢旋转展示，镜头由中景推近到面料细节。",
    duration: "5",
    imageUrl: "",
    endImageUrl: "",
    referenceImages: "",
    aspectRatio: "9:16",
    sound: "off",
    shotPrompts: "",
  });

  async function loadConfig() {
    setConfigLoading(true);

    try {
      const response = await fetch("/api/history?configOnly=1", {
        cache: "no-store",
      });
      const data = (await response.json()) as ApiResponse;

      if (data.config) {
        setConfig(data.config);
      }

      if (!data.ok && data.error) {
        setMessage(data.error);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取配置失败");
    } finally {
      setConfigLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPromptTemplates() {
      try {
        const response = await fetch("/api/prompts", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as ApiResponse;

        if (data.config) {
          setConfig(data.config);
        }

        if (response.ok && data.ok) {
          setPromptTemplates(data.prompts ?? []);
        }
      } catch {}
    }

    void loadPromptTemplates();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!currentJob || currentJob.kind !== "video" || currentJob.status !== "pending") {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/video/${currentJob.id}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as ApiResponse;

        if (!response.ok || !data.ok || !data.job) {
          return;
        }

        if (data.config) {
          setConfig(data.config);
        }

        setCurrentJob(data.job);
      } catch {}
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentJob]);

  async function submitForm(endpoint: string, payload: Record<string, unknown>) {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.ok || !data.job) {
        throw new Error(data.error ?? "请求失败");
      }

      if (data.config) {
        setConfig(data.config);
      }

      setCurrentJob(data.job);
      setMessage("任务已提交，可在任务记录页查看完整历史。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  async function uploadImages(
    files: FileList | File[],
    target: string,
    onComplete: (urls: string[]) => void,
  ) {
    const normalizedFiles = Array.from(files);

    if (!normalizedFiles.length) {
      return;
    }

    setUploadingTarget(target);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("target", target);

      normalizedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as UploadResponse;

      if (!response.ok || !data.ok || !data.files?.length) {
        throw new Error(data.error ?? "上传失败");
      }

      if (data.config) {
        setConfig(data.config);
      }

      onComplete(data.files.map((file) => file.url));
      setMessage("图片已上传，可直接作为参考图使用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploadingTarget(null);
    }
  }

  async function handleTextSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await submitForm("/api/generate/text", {
      model: textForm.model,
      prompt: textForm.prompt,
      systemPrompt: textForm.systemPrompt,
      temperature: Number(textForm.temperature),
      responseFormat: textForm.responseFormat,
      referenceImages: splitMultilineUrls(textForm.referenceImages),
    });
  }

  async function handleImageSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await submitForm("/api/generate/image", {
      model: imageForm.model,
      prompt: imageForm.prompt,
      referenceImages: splitMultilineUrls(imageForm.referenceImages),
    });
  }

  async function handleVideoSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await submitForm("/api/generate/video", {
      model: videoForm.model,
      prompt: videoForm.prompt,
      duration: Number(videoForm.duration),
      imageUrl: videoForm.imageUrl,
      endImageUrl: videoForm.endImageUrl,
      referenceImages: splitMultilineUrls(videoForm.referenceImages),
      aspectRatio: videoForm.aspectRatio,
      sound: videoForm.sound,
      shotPrompts: splitShotPrompts(videoForm.shotPrompts),
    });
  }

  function applyPromptTemplate(templateId: string, kind: GenerationKind) {
    const template = promptTemplates.find(
      (item) => item.id === templateId && item.kind === kind,
    );

    if (!template) {
      return;
    }

    if (kind === "text") {
      setSelectedTextPromptId(template.id);
      setTextForm((current) => ({
        ...current,
        model: template.model ?? current.model,
        prompt: template.prompt,
        systemPrompt: template.systemPrompt ?? "",
      }));
      return;
    }

    if (kind === "image") {
      setSelectedImagePromptId(template.id);
      setImageForm((current) => ({
        ...current,
        model: template.model ?? current.model,
        prompt: template.prompt,
      }));
      return;
    }

    setSelectedVideoPromptId(template.id);
    setVideoForm((current) => ({
      ...current,
      model: template.model ?? current.model,
      prompt: template.prompt,
    }));
  }

  const textPromptTemplates = useMemo(
    () => promptTemplates.filter((item) => item.kind === "text"),
    [promptTemplates],
  );
  const imagePromptTemplates = useMemo(
    () => promptTemplates.filter((item) => item.kind === "image"),
    [promptTemplates],
  );
  const videoPromptTemplates = useMemo(
    () => promptTemplates.filter((item) => item.kind === "video"),
    [promptTemplates],
  );
  const activePromptTemplate = useMemo(() => {
    const selectedId =
      activeTab === "text"
        ? selectedTextPromptId
        : activeTab === "image"
          ? selectedImagePromptId
          : selectedVideoPromptId;

    return promptTemplates.find((item) => item.id === selectedId) ?? null;
  }, [
    activeTab,
    promptTemplates,
    selectedImagePromptId,
    selectedTextPromptId,
    selectedVideoPromptId,
  ]);
  const textReferenceImages = splitMultilineUrls(textForm.referenceImages);
  const imageReferenceImages = splitMultilineUrls(imageForm.referenceImages);
  const videoReferenceImages = splitMultilineUrls(videoForm.referenceImages);
  const workspaceTitle =
    activeTab === "text" ? "文本工作区" : activeTab === "image" ? "图片工作区" : "视频工作区";
  const workspaceModel =
    activeTab === "text"
      ? textForm.model
      : activeTab === "image"
        ? imageForm.model
        : videoForm.model;
  const workspacePrompt =
    activeTab === "text"
      ? textForm.prompt
      : activeTab === "image"
        ? imageForm.prompt
        : videoForm.prompt;
  const cloubicConfigState = getConfigDisplayState(
    config?.cloubic,
    configLoading,
  );
  const postgresConfigState = getConfigDisplayState(
    config?.postgres,
    configLoading,
  );
  const s3ConfigState = getConfigDisplayState(config?.s3, configLoading);
  const workspaceAssets = useMemo(() => {
    if (activeTab === "text") {
      return textReferenceImages;
    }

    if (activeTab === "image") {
      return imageReferenceImages;
    }

    return [
      videoForm.imageUrl,
      videoForm.endImageUrl,
      ...videoReferenceImages,
    ].filter((value, index, current): value is string => Boolean(value) && current.indexOf(value) === index);
  }, [
    activeTab,
    imageReferenceImages,
    textReferenceImages,
    videoForm.endImageUrl,
    videoForm.imageUrl,
    videoReferenceImages,
  ]);
  const currentJobAssetUrl = currentJob?.storageUrl ?? currentJob?.sourceUrl ?? null;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Onebeat Studio</p>
            <h1>快速生成文本、图片与视频</h1>
            <p className={styles.description}>
              基于 Next.js App Router、Cloubic API、S3 对象存储与 PostgreSQL，
              适合内部快速出图、写文案、提交视频任务并回收结果。
            </p>
          </div>
          <div className={styles.statusGrid}>
            <div className={styles.statusCard}>
              <span>Cloubic</span>
              <strong data-ready={cloubicConfigState.readiness}>
                {cloubicConfigState.label}
              </strong>
            </div>
            <div className={styles.statusCard}>
              <span>PostgreSQL</span>
              <strong data-ready={postgresConfigState.readiness}>
                {postgresConfigState.label}
              </strong>
            </div>
            <div className={styles.statusCard}>
              <span>S3</span>
              <strong data-ready={s3ConfigState.readiness}>
                {s3ConfigState.label}
              </strong>
            </div>
          </div>
        </section>

        <section className={styles.shell}>
          <div className={styles.panel}>
            <div className={styles.tabs}>
              <button
                className={activeTab === "text" ? styles.tabActive : styles.tab}
                onClick={() => setActiveTab("text")}
                type="button"
              >
                文本
              </button>
              <button
                className={activeTab === "image" ? styles.tabActive : styles.tab}
                onClick={() => setActiveTab("image")}
                type="button"
              >
                图片
              </button>
              <button
                className={activeTab === "video" ? styles.tabActive : styles.tab}
                onClick={() => setActiveTab("video")}
                type="button"
              >
                视频
              </button>
            </div>

            {activeTab === "text" ? (
              <form className={styles.form} onSubmit={handleTextSubmit}>
                <label className={styles.field}>
                  <span>选择提示词模板</span>
                  <select
                    value={selectedTextPromptId}
                    onChange={(event) => {
                      const { value } = event.target;
                      setSelectedTextPromptId(value);

                      if (value) {
                        applyPromptTemplate(value, "text");
                      }
                    }}
                  >
                    <option value="">不使用模板</option>
                    {textPromptTemplates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTextPromptId ? (
                  <button
                    className={styles.ghost}
                    onClick={() => setSelectedTextPromptId("")}
                    type="button"
                  >
                    清空已选模板
                  </button>
                ) : null}
                <label className={styles.field}>
                  <span>模型</span>
                  <input
                    value={textForm.model}
                    onChange={(event) =>
                      setTextForm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>系统提示词</span>
                  <textarea
                    rows={3}
                    value={textForm.systemPrompt}
                    onChange={(event) =>
                      setTextForm((current) => ({
                        ...current,
                        systemPrompt: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>生成提示词</span>
                  <textarea
                    rows={5}
                    value={textForm.prompt}
                    onChange={(event) =>
                      setTextForm((current) => ({
                        ...current,
                        prompt: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span>温度</span>
                    <input
                      value={textForm.temperature}
                      onChange={(event) =>
                        setTextForm((current) => ({
                          ...current,
                          temperature: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>返回格式</span>
                    <select
                      value={textForm.responseFormat}
                      onChange={(event) =>
                        setTextForm((current) => ({
                          ...current,
                          responseFormat: event.target.value,
                        }))
                      }
                    >
                      <option value="text">text</option>
                      <option value="json">json</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>参考图 URL，一行一个</span>
                  <textarea
                    rows={4}
                    value={textForm.referenceImages}
                    onChange={(event) =>
                      setTextForm((current) => ({
                        ...current,
                        referenceImages: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.uploadBox}>
                  <span>或直接上传参考图</span>
                  <input
                    accept="image/*"
                    className={styles.fileInput}
                    disabled={uploadingTarget === "text-reference"}
                    multiple
                    onChange={(event) => {
                      const { files } = event.currentTarget;

                      if (files?.length) {
                        void uploadImages(files, "text-reference", (urls) => {
                          setTextForm((current) => ({
                            ...current,
                            referenceImages: mergeUrlLines(current.referenceImages, urls),
                          }));
                        });
                      }

                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                  <small className={styles.helperText}>
                    {uploadingTarget === "text-reference"
                      ? "上传中..."
                      : "支持多张图片，上传后会自动填入参考图 URL"}
                  </small>
                </label>
                <ThumbnailList
                  emptyText="上传后会在这里显示缩略预览"
                  onPreview={(url) =>
                    setPreviewAsset({
                      kind: "image",
                      url,
                    })
                  }
                  onRemove={(url) =>
                    setTextForm((current) => ({
                      ...current,
                      referenceImages: removeUrlLine(current.referenceImages, url),
                    }))
                  }
                  urls={textReferenceImages}
                />
                <button className={styles.submit} disabled={loading} type="submit">
                  {loading ? "处理中..." : "生成文本"}
                </button>
              </form>
            ) : null}

            {activeTab === "image" ? (
              <form className={styles.form} onSubmit={handleImageSubmit}>
                <label className={styles.field}>
                  <span>选择提示词模板</span>
                  <select
                    value={selectedImagePromptId}
                    onChange={(event) => {
                      const { value } = event.target;
                      setSelectedImagePromptId(value);

                      if (value) {
                        applyPromptTemplate(value, "image");
                      }
                    }}
                  >
                    <option value="">不使用模板</option>
                    {imagePromptTemplates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedImagePromptId ? (
                  <button
                    className={styles.ghost}
                    onClick={() => setSelectedImagePromptId("")}
                    type="button"
                  >
                    清空已选模板
                  </button>
                ) : null}
                <label className={styles.field}>
                  <span>模型</span>
                  <input
                    value={imageForm.model}
                    onChange={(event) =>
                      setImageForm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>生成提示词</span>
                  <textarea
                    rows={6}
                    value={imageForm.prompt}
                    onChange={(event) =>
                      setImageForm((current) => ({
                        ...current,
                        prompt: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>参考图 URL，一行一个</span>
                  <textarea
                    rows={5}
                    value={imageForm.referenceImages}
                    onChange={(event) =>
                      setImageForm((current) => ({
                        ...current,
                        referenceImages: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.uploadBox}>
                  <span>或直接上传参考图</span>
                  <input
                    accept="image/*"
                    className={styles.fileInput}
                    disabled={uploadingTarget === "image-reference"}
                    multiple
                    onChange={(event) => {
                      const { files } = event.currentTarget;

                      if (files?.length) {
                        void uploadImages(files, "image-reference", (urls) => {
                          setImageForm((current) => ({
                            ...current,
                            referenceImages: mergeUrlLines(current.referenceImages, urls),
                          }));
                        });
                      }

                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                  <small className={styles.helperText}>
                    {uploadingTarget === "image-reference"
                      ? "上传中..."
                      : "支持多张图片，上传后会自动填入参考图 URL"}
                  </small>
                </label>
                <ThumbnailList
                  emptyText="上传后会在这里显示缩略预览"
                  onPreview={(url) =>
                    setPreviewAsset({
                      kind: "image",
                      url,
                    })
                  }
                  onRemove={(url) =>
                    setImageForm((current) => ({
                      ...current,
                      referenceImages: removeUrlLine(current.referenceImages, url),
                    }))
                  }
                  urls={imageReferenceImages}
                />
                <button className={styles.submit} disabled={loading} type="submit">
                  {loading ? "处理中..." : "生成图片并上传 S3"}
                </button>
              </form>
            ) : null}

            {activeTab === "video" ? (
              <form className={styles.form} onSubmit={handleVideoSubmit}>
                <label className={styles.field}>
                  <span>选择提示词模板</span>
                  <select
                    value={selectedVideoPromptId}
                    onChange={(event) => {
                      const { value } = event.target;
                      setSelectedVideoPromptId(value);

                      if (value) {
                        applyPromptTemplate(value, "video");
                      }
                    }}
                  >
                    <option value="">不使用模板</option>
                    {videoPromptTemplates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedVideoPromptId ? (
                  <button
                    className={styles.ghost}
                    onClick={() => setSelectedVideoPromptId("")}
                    type="button"
                  >
                    清空已选模板
                  </button>
                ) : null}
                <label className={styles.field}>
                  <span>模型</span>
                  <input
                    value={videoForm.model}
                    onChange={(event) =>
                      setVideoForm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>视频提示词</span>
                  <textarea
                    rows={5}
                    value={videoForm.prompt}
                    onChange={(event) =>
                      setVideoForm((current) => ({
                        ...current,
                        prompt: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <span>首帧图 URL</span>
                    <input
                      value={videoForm.imageUrl}
                      onChange={(event) =>
                        setVideoForm((current) => ({
                          ...current,
                          imageUrl: event.target.value,
                        }))
                      }
                    />
                    <div className={styles.inlineUpload}>
                      <input
                        accept="image/*"
                        className={styles.fileInput}
                        disabled={uploadingTarget === "video-start"}
                        onChange={(event) => {
                          const { files } = event.currentTarget;

                          if (files?.length) {
                            void uploadImages([files[0]], "video-start", (urls) => {
                              setVideoForm((current) => ({
                                ...current,
                                imageUrl: urls[0] ?? current.imageUrl,
                              }));
                            });
                          }

                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                      <small className={styles.helperText}>
                        {uploadingTarget === "video-start" ? "上传中..." : "可直接上传首帧"}
                      </small>
                    </div>
                    <ThumbnailList
                      emptyText="上传首帧后显示"
                      onPreview={(url) =>
                        setPreviewAsset({
                          kind: "image",
                          url,
                        })
                      }
                      onRemove={() =>
                        setVideoForm((current) => ({
                          ...current,
                          imageUrl: "",
                        }))
                      }
                      urls={videoForm.imageUrl ? [videoForm.imageUrl] : []}
                    />
                  </div>
                  <div className={styles.field}>
                    <span>尾帧图 URL</span>
                    <input
                      value={videoForm.endImageUrl}
                      onChange={(event) =>
                        setVideoForm((current) => ({
                          ...current,
                          endImageUrl: event.target.value,
                        }))
                      }
                    />
                    <div className={styles.inlineUpload}>
                      <input
                        accept="image/*"
                        className={styles.fileInput}
                        disabled={uploadingTarget === "video-end"}
                        onChange={(event) => {
                          const { files } = event.currentTarget;

                          if (files?.length) {
                            void uploadImages([files[0]], "video-end", (urls) => {
                              setVideoForm((current) => ({
                                ...current,
                                endImageUrl: urls[0] ?? current.endImageUrl,
                              }));
                            });
                          }

                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                      <small className={styles.helperText}>
                        {uploadingTarget === "video-end" ? "上传中..." : "可直接上传尾帧"}
                      </small>
                    </div>
                    <ThumbnailList
                      emptyText="上传尾帧后显示"
                      onPreview={(url) =>
                        setPreviewAsset({
                          kind: "image",
                          url,
                        })
                      }
                      onRemove={() =>
                        setVideoForm((current) => ({
                          ...current,
                          endImageUrl: "",
                        }))
                      }
                      urls={videoForm.endImageUrl ? [videoForm.endImageUrl] : []}
                    />
                  </div>
                </div>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span>时长</span>
                    <input
                      value={videoForm.duration}
                      onChange={(event) =>
                        setVideoForm((current) => ({
                          ...current,
                          duration: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>比例</span>
                    <select
                      value={videoForm.aspectRatio}
                      onChange={(event) =>
                        setVideoForm((current) => ({
                          ...current,
                          aspectRatio: event.target.value,
                        }))
                      }
                    >
                      <option value="9:16">9:16</option>
                      <option value="16:9">16:9</option>
                      <option value="1:1">1:1</option>
                      <option value="4:3">4:3</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>声音</span>
                    <select
                      value={videoForm.sound}
                      onChange={(event) =>
                        setVideoForm((current) => ({
                          ...current,
                          sound: event.target.value,
                        }))
                      }
                    >
                      <option value="off">off</option>
                      <option value="on">on</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>参考图 URL，一行一个</span>
                  <textarea
                    rows={4}
                    value={videoForm.referenceImages}
                    onChange={(event) =>
                      setVideoForm((current) => ({
                        ...current,
                        referenceImages: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.uploadBox}>
                  <span>或直接上传参考图</span>
                  <input
                    accept="image/*"
                    className={styles.fileInput}
                    disabled={uploadingTarget === "video-reference"}
                    multiple
                    onChange={(event) => {
                      const { files } = event.currentTarget;

                      if (files?.length) {
                        void uploadImages(files, "video-reference", (urls) => {
                          setVideoForm((current) => ({
                            ...current,
                            referenceImages: mergeUrlLines(current.referenceImages, urls),
                          }));
                        });
                      }

                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                  <small className={styles.helperText}>
                    {uploadingTarget === "video-reference"
                      ? "上传中..."
                      : "支持多张图片，上传后会自动填入参考图 URL"}
                  </small>
                </label>
                <ThumbnailList
                  emptyText="上传后会在这里显示缩略预览"
                  onPreview={(url) =>
                    setPreviewAsset({
                      kind: "image",
                      url,
                    })
                  }
                  onRemove={(url) =>
                    setVideoForm((current) => ({
                      ...current,
                      referenceImages: removeUrlLine(current.referenceImages, url),
                    }))
                  }
                  urls={videoReferenceImages}
                />
                <label className={styles.field}>
                  <span>分镜提示词，一行一个</span>
                  <textarea
                    rows={4}
                    value={videoForm.shotPrompts}
                    onChange={(event) =>
                      setVideoForm((current) => ({
                        ...current,
                        shotPrompts: event.target.value,
                      }))
                    }
                  />
                </label>
                <button className={styles.submit} disabled={loading} type="submit">
                  {loading ? "处理中..." : "提交视频任务"}
                </button>
              </form>
            ) : null}

            <div className={styles.envHint}>
              <span>必填环境变量</span>
              <p>
                CLOUBIC_API_KEY、DATABASE_URL、S3_BUCKET、S3_REGION、
                S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY
              </p>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>固定工作区</h2>
                <p>只保留当前操作需要的信息，保持快捷、干净、可连续使用。</p>
              </div>
              <Link className={styles.ghost} href="/history">
                查看任务记录
              </Link>
              <Link className={styles.ghost} href="/prompts">
                管理提示词
              </Link>
            </div>

            {message ? <p className={styles.inlineMessage}>{message}</p> : null}

            <div className={styles.workspaceCard}>
              <div className={styles.workspaceHeader}>
                <strong>{workspaceTitle}</strong>
                <span className={styles.jobKind}>{activeTab.toUpperCase()}</span>
              </div>
              <div className={styles.workspaceMeta}>
                <span className={styles.metaPill}>{workspaceModel}</span>
                <span className={styles.metaPill}>素材 {workspaceAssets.length}</span>
                <span className={styles.metaPill}>
                  模板 {activePromptTemplate ? activePromptTemplate.title : "未选择"}
                </span>
              </div>
              <p className={styles.workspacePrompt}>{workspacePrompt}</p>

              {workspaceAssets.length ? (
                <div className={styles.workspaceAssets}>
                  {workspaceAssets.map((url) => (
                    <button
                      aria-label="打开工作区素材预览"
                      className={styles.previewThumb}
                      key={url}
                      onClick={() =>
                        setPreviewAsset({
                          kind: "image",
                          url,
                        })
                      }
                      style={{ backgroundImage: `url(${url})` }}
                      type="button"
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <p>当前工作区还没有素材，上传参考图后会固定显示在这里。</p>
                </div>
              )}
            </div>

            {currentJob ? (
              <div className={styles.workspaceReceipt}>
                <div className={styles.receiptHeader}>
                  <span className={styles.receiptLabel}>最近回执</span>
                  <span className={styles.receiptStatus} data-status={currentJob.status}>
                    {statusLabels[currentJob.status]}
                  </span>
                </div>
                <div className={styles.jobMeta}>
                  <span>{currentJob.model}</span>
                  <span>{formatCreatedAt(currentJob.createdAt)}</span>
                </div>
                <p className={styles.receiptPrompt}>{currentJob.prompt}</p>
                {currentJob.kind === "text" && currentJob.resultText ? (
                  <pre className={styles.receiptText}>{currentJob.resultText}</pre>
                ) : null}
                {currentJob.kind === "image" && currentJobAssetUrl ? (
                  <div className={styles.receiptActions}>
                    <button
                      className={styles.ghost}
                      onClick={() =>
                        setPreviewAsset({
                          kind: "image",
                          url: currentJobAssetUrl,
                        })
                      }
                      type="button"
                    >
                      预览图片
                    </button>
                    <a
                      className={styles.ghost}
                      href={currentJobAssetUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      打开资源
                    </a>
                  </div>
                ) : null}
                {currentJob.kind === "video" && currentJobAssetUrl ? (
                  <div className={styles.receiptActions}>
                    <button
                      className={styles.ghost}
                      onClick={() =>
                        setPreviewAsset({
                          kind: "video",
                          url: currentJobAssetUrl,
                        })
                      }
                      type="button"
                    >
                      预览视频
                    </button>
                    <Link className={styles.ghost} href="/history">
                      去任务页查看视频
                    </Link>
                    <a
                      className={styles.ghost}
                      href={currentJobAssetUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      打开资源
                    </a>
                  </div>
                ) : null}
                {currentJob.errorMessage ? (
                  <p className={styles.errorText}>{currentJob.errorMessage}</p>
                ) : null}
              </div>
            ) : (
              <div className={styles.workspaceAside}>
                <span className={styles.receiptLabel}>任务记录已分离</span>
                <p>历史任务、状态刷新和资源回看统一放到任务记录页，首页只保留当前工作上下文。</p>
              </div>
            )}
          </div>
        </section>
      </main>
      {previewAsset ? (
        <div
          className={styles.previewModal}
          onClick={() => setPreviewAsset(null)}
          role="presentation"
        >
          <div
            className={styles.previewModalCard}
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <button
              className={styles.previewModalClose}
              onClick={() => setPreviewAsset(null)}
              type="button"
            >
              关闭
            </button>
            {previewAsset.kind === "image" ? (
              <div
                aria-label="图片放大预览"
                className={styles.previewModalImage}
                role="img"
                style={{ backgroundImage: `url(${previewAsset.url})` }}
              />
            ) : (
              <video
                autoPlay
                className={styles.previewModalVideo}
                controls
                src={previewAsset.url}
              />
            )}
            <a
              className={styles.assetLink}
              href={previewAsset.url}
              rel="noreferrer"
              target="_blank"
            >
              {previewAsset.kind === "image" ? "新窗口打开原图" : "新窗口打开视频"}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
