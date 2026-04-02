"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";

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

type ApiResponse = {
  ok: boolean;
  error?: string;
  config?: ConfigStatus;
  job?: GenerationJob;
  jobs?: GenerationJob[];
};

type PreviewAsset =
  | {
      kind: "image";
      url: string;
    }
  | {
      kind: "video";
      url: string;
    }
  | {
      kind: "text";
      content: string;
      sourceUrl: string | null;
    };

const statusLabels: Record<GenerationStatus, string> = {
  pending: "进行中",
  completed: "已完成",
  failed: "失败",
};

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function getTextSummary(value: string) {
  const summary = value.replace(/\s+/g, " ").trim();

  if (summary.length <= 140) {
    return summary;
  }

  return `${summary.slice(0, 140)}…`;
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

export default function HistoryPage() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [refreshingIds, setRefreshingIds] = useState<string[]>([]);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);
  const [message, setMessage] = useState("");

  async function loadHistory() {
    setConfigLoading(true);

    try {
      const response = await fetch("/api/history", {
        cache: "no-store",
      });
      const data = (await response.json()) as ApiResponse;

      if (data.config) {
        setConfig(data.config);
      }

      setJobs(data.jobs ?? []);

      if (!data.ok && data.error) {
        setMessage(data.error);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取任务失败");
    } finally {
      setConfigLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  const recentVideoJobs = useMemo(
    () => jobs.filter((job) => job.kind === "video"),
    [jobs],
  );
  const pendingVideoJobIds = useMemo(
    () =>
      jobs
        .filter((job) => job.kind === "video" && job.status === "pending")
        .map((job) => job.id),
    [jobs],
  );

  const upsertJob = useCallback((nextJob: GenerationJob) => {
    setJobs((current) => {
      const existingIndex = current.findIndex((job) => job.id === nextJob.id);

      if (existingIndex === -1) {
        return [nextJob, ...current];
      }

      const next = [...current];
      next[existingIndex] = nextJob;
      return next;
    });
  }, []);

  const refreshVideos = useCallback(async (jobIds: string[], silent = false) => {
    const nextIds = [...new Set(jobIds.filter(Boolean))];

    if (!nextIds.length) {
      return;
    }

    setRefreshingIds((current) => [...new Set([...current, ...nextIds])]);

    if (!silent) {
      setMessage("");
    }

    try {
      const results = await Promise.all(
        nextIds.map(async (jobId) => {
          const response = await fetch(`/api/video/${jobId}`, {
            cache: "no-store",
          });
          const data = (await response.json()) as ApiResponse;

          if (!response.ok || !data.ok || !data.job) {
            throw new Error(data.error ?? "刷新失败");
          }

          return data;
        }),
      );

      results.forEach((data) => {
        if (data.config) {
          setConfig(data.config);
        }

        if (data.job) {
          upsertJob(data.job);
        }
      });

      if (!silent) {
        setMessage("视频状态已刷新。");
      }
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : "刷新失败");
      }
    } finally {
      setRefreshingIds((current) =>
        current.filter((jobId) => !nextIds.includes(jobId)),
      );
    }
  }, [upsertJob]);

  useEffect(() => {
    if (!pendingVideoJobIds.length) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshVideos(pendingVideoJobIds, true);
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [pendingVideoJobIds, refreshVideos]);

  function isRefreshing(jobId: string) {
    return refreshingIds.includes(jobId);
  }

  const cloubicConfigState = getConfigDisplayState(
    config?.cloubic,
    configLoading,
  );
  const postgresConfigState = getConfigDisplayState(
    config?.postgres,
    configLoading,
  );
  const s3ConfigState = getConfigDisplayState(config?.s3, configLoading);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Onebeat Studio</p>
            <h1>任务记录</h1>
            <p className={styles.description}>
              统一查看文本、图片、视频任务，视频任务可在这里手动刷新状态并回看资源。
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

        <section className={styles.historyShell}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>全部任务</h2>
                <p>历史记录独立展示，首页右侧保留给固定工作区。</p>
              </div>
              <div className={styles.headerActions}>
                <Link className={styles.ghost} href="/">
                  返回工作区
                </Link>
                <button className={styles.ghost} onClick={() => void loadHistory()} type="button">
                  刷新列表
                </button>
              </div>
            </div>

            {message ? <p className={styles.message}>{message}</p> : null}

            <div className={styles.jobList}>
              {jobs.length ? (
                jobs.map((job) => {
                  const assetUrl = job.storageUrl ?? job.sourceUrl ?? null;
                  const textContent = job.resultText?.trim() ?? "";
                  const textSummary = textContent ? getTextSummary(textContent) : "暂无文本结果";

                  return (
                    <article className={styles.jobCard} key={job.id}>
                      <div className={styles.jobCardMain}>
                        <div className={styles.jobHeader}>
                          <div className={styles.jobTitleBlock}>
                            <span className={styles.jobKind}>{job.kind.toUpperCase()}</span>
                            <h3>{job.model}</h3>
                          </div>
                          <strong data-status={job.status}>{statusLabels[job.status]}</strong>
                        </div>
                        <p className={styles.jobPrompt}>{job.prompt}</p>
                        <div className={styles.jobMeta}>
                          <span>{formatCreatedAt(job.createdAt)}</span>
                          {job.providerStatus ? <span>上游状态：{job.providerStatus}</span> : null}
                        </div>
                        {job.errorMessage ? (
                          <p className={styles.errorText}>{job.errorMessage}</p>
                        ) : null}
                        <div className={styles.jobActions}>
                          {job.kind === "text" ? (
                            <button
                              className={styles.ghost}
                              onClick={() =>
                                setPreviewAsset({
                                  kind: "text",
                                  content: textContent || "暂无文本结果",
                                  sourceUrl: job.sourceUrl,
                                })
                              }
                              type="button"
                            >
                              查看原文
                            </button>
                          ) : null}
                          {job.kind === "image" && assetUrl ? (
                            <a
                              className={styles.assetLink}
                              href={assetUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              查看原图
                            </a>
                          ) : null}
                          {job.kind === "video" && assetUrl ? (
                            <a
                              className={styles.assetLink}
                              href={assetUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              查看原视频
                            </a>
                          ) : null}
                          {job.kind === "video" ? (
                            <button
                              className={styles.ghost}
                              disabled={isRefreshing(job.id)}
                              onClick={() => void refreshVideos([job.id])}
                              type="button"
                            >
                              {isRefreshing(job.id) ? "刷新中..." : "刷新视频状态"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {job.kind === "text" ? (
                        <button
                          aria-label={`查看 ${job.model} 的文本原文`}
                          className={styles.textSummaryButton}
                          onClick={() =>
                            setPreviewAsset({
                              kind: "text",
                              content: textContent || "暂无文本结果",
                              sourceUrl: job.sourceUrl,
                            })
                          }
                          type="button"
                        >
                          <span className={styles.previewLabel}>文本摘要</span>
                          <span className={styles.textSummary}>{textSummary}</span>
                          <span className={styles.previewHint}>点击查看原文</span>
                        </button>
                      ) : null}
                      {job.kind === "image" && assetUrl ? (
                        <div className={styles.assetPreview}>
                          <button
                            aria-label={job.prompt}
                            className={styles.previewImageButton}
                            onClick={() =>
                              setPreviewAsset({
                                kind: "image",
                                url: assetUrl,
                              })
                            }
                            type="button"
                          >
                            <div
                              className={styles.previewImage}
                              style={{
                                backgroundImage: `url(${assetUrl})`,
                              }}
                            />
                          </button>
                          <span className={styles.previewHint}>点击缩略图预览</span>
                        </div>
                      ) : null}
                      {job.kind === "video" && assetUrl ? (
                        <div className={styles.assetPreview}>
                          <button
                            aria-label={`预览 ${job.model} 视频`}
                            className={styles.previewImageButton}
                            onClick={() =>
                              setPreviewAsset({
                                kind: "video",
                                url: assetUrl,
                              })
                            }
                            type="button"
                          >
                            <div className={styles.previewVideoThumb}>
                              <video
                                className={styles.previewVideo}
                                muted
                                playsInline
                                preload="metadata"
                                src={assetUrl}
                              />
                              <span className={styles.previewOverlay}>点击预览</span>
                            </div>
                          </button>
                          <span className={styles.previewHint}>点击缩略视频预览</span>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className={styles.emptyState}>
                  <p>还没有任务记录，先回到工作区发起一个生成请求。</p>
                </div>
              )}
            </div>

            {recentVideoJobs.length ? (
              <div className={styles.videoTip}>
                <span>视频任务提醒</span>
                <p>视频任务会每 30 秒自动轮询一次，列表里也可以手动刷新并在点击后预览视频。</p>
              </div>
            ) : null}
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
            {previewAsset.kind === "text" ? (
              <pre className={styles.previewModalText}>{previewAsset.content}</pre>
            ) : previewAsset.kind === "image" ? (
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
            {previewAsset.kind === "text" ? (
              previewAsset.sourceUrl ? (
                <a
                  className={styles.assetLink}
                  href={previewAsset.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  新窗口打开原文
                </a>
              ) : null
            ) : (
              <a
                className={styles.assetLink}
                href={previewAsset.url}
                rel="noreferrer"
                target="_blank"
              >
                {previewAsset.kind === "image" ? "新窗口打开原图" : "新窗口打开视频"}
              </a>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
