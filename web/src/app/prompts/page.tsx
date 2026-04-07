"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";

type GenerationKind = "text" | "image" | "video";

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
  prompt?: PromptTemplate;
  prompts?: PromptTemplate[];
};

const kindLabels: Record<GenerationKind, string> = {
  text: "文本",
  image: "图像",
  video: "视频",
};

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function createEmptyForm(kind: GenerationKind = "text") {
  return {
    kind,
    title: "",
    description: "",
    prompt: "",
    systemPrompt: "",
    model: "",
  };
}

export default function PromptsPage() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [activeKind, setActiveKind] = useState<GenerationKind>("text");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(createEmptyForm());

  async function loadPrompts() {
    setLoading(true);

    try {
      const response = await fetch("/api/prompts", {
        cache: "no-store",
      });
      const data = (await response.json()) as ApiResponse;

      if (data.config) {
        setConfig(data.config);
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "读取提示词失败");
      }

      setPrompts(data.prompts ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取提示词失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPrompts();
  }, []);

  const filteredPrompts = useMemo(
    () => prompts.filter((item) => item.kind === activeKind),
    [activeKind, prompts],
  );

  function resetForm(kind = activeKind) {
    setEditingId(null);
    setForm(createEmptyForm(kind));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        editingId ? `/api/prompts/${editingId}` : "/api/prompts",
        {
          method: editingId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...form,
            metadata: {},
          }),
        },
      );
      const data = (await response.json()) as ApiResponse;

      if (data.config) {
        setConfig(data.config);
      }

      if (!response.ok || !data.ok || !data.prompt) {
        throw new Error(data.error ?? "保存提示词失败");
      }

      setPrompts((current) => {
        const next = current.filter((item) => item.id !== data.prompt?.id);
        return [data.prompt as PromptTemplate, ...next];
      });
      setActiveKind(data.prompt.kind);
      resetForm(data.prompt.kind);
      setMessage(editingId ? "提示词已更新" : "提示词已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存提示词失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setMessage("");

    try {
      const response = await fetch(`/api/prompts/${id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as ApiResponse;

      if (data.config) {
        setConfig(data.config);
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "删除提示词失败");
      }

      setPrompts((current) => current.filter((item) => item.id !== id));

      if (editingId === id) {
        resetForm(activeKind);
      }

      setMessage("提示词已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除提示词失败");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Onebeat Studio</p>
            <h1>提示词管理</h1>
            <p className={styles.description}>
              统一维护文本、图像、视频提示词模板，保存到后端后可在首页直接选择并带入表单。
            </p>
          </div>
          <div className={styles.statusGrid}>
            <div className={styles.statusCard}>
              <span>Cloubic</span>
              <strong data-ready={config?.cloubic ? "true" : "false"}>
                {config?.cloubic ? "已配置" : "未配置"}
              </strong>
            </div>
            <div className={styles.statusCard}>
              <span>PostgreSQL</span>
              <strong data-ready={config?.postgres ? "true" : "false"}>
                {config?.postgres ? "已配置" : "未配置"}
              </strong>
            </div>
            <div className={styles.statusCard}>
              <span>S3</span>
              <strong data-ready={config?.s3 ? "true" : "false"}>
                {config?.s3 ? "已配置" : "未配置"}
              </strong>
            </div>
          </div>
        </section>

        <section className={styles.shell}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>{editingId ? "编辑提示词" : "新增提示词"}</h2>
                <p>按类型分别维护模板，文本模板可额外保存系统提示词。</p>
              </div>
              <div className={styles.headerActions}>
                <Link className={styles.ghost} href="/">
                  返回工作区
                </Link>
                <Link className={styles.ghost} href="/history">
                  查看任务记录
                </Link>
              </div>
            </div>

            {message ? <p className={styles.message}>{message}</p> : null}

            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.field}>
                <span>类型</span>
                <select
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: event.target.value as GenerationKind,
                    }))
                  }
                >
                  <option value="text">文本</option>
                  <option value="image">图像</option>
                  <option value="video">视频</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>标题</span>
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                <span>描述</span>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                <span>默认模型</span>
                <input
                  value={form.model}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                />
              </label>
              {form.kind === "text" ? (
                <label className={styles.field}>
                  <span>系统提示词</span>
                  <textarea
                    rows={3}
                    value={form.systemPrompt}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        systemPrompt: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
              <label className={styles.field}>
                <span>提示词内容</span>
                <textarea
                  rows={10}
                  value={form.prompt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                />
              </label>
              <div className={styles.headerActions}>
                <button className={styles.submit} disabled={saving} type="submit">
                  {saving ? "保存中..." : editingId ? "更新提示词" : "保存提示词"}
                </button>
                <button
                  className={styles.ghost}
                  onClick={() => resetForm(form.kind)}
                  type="button"
                >
                  清空表单
                </button>
              </div>
            </form>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>提示词列表</h2>
                <p>按类型筛选，点击即可编辑。</p>
              </div>
              <div className={styles.tabs}>
                {(["text", "image", "video"] as GenerationKind[]).map((kind) => (
                  <button
                    className={activeKind === kind ? styles.tabActive : styles.tab}
                    key={kind}
                    onClick={() => {
                      setActiveKind(kind);

                      if (!editingId) {
                        resetForm(kind);
                      }
                    }}
                    type="button"
                  >
                    {kindLabels[kind]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.jobList}>
              {loading ? (
                <div className={styles.emptyState}>
                  <p>提示词加载中...</p>
                </div>
              ) : filteredPrompts.length ? (
                filteredPrompts.map((item) => (
                  <article className={styles.jobCard} key={item.id}>
                    <div className={styles.jobCardMain}>
                      <div className={styles.jobHeader}>
                        <div className={styles.jobTitleBlock}>
                          <span className={styles.jobKind}>{kindLabels[item.kind]}</span>
                          <h3>{item.title}</h3>
                        </div>
                        <strong data-status="completed">已保存</strong>
                      </div>
                      {item.description ? (
                        <p className={styles.jobPrompt}>{item.description}</p>
                      ) : null}
                      <div className={styles.jobMeta}>
                        <span>{formatCreatedAt(item.updatedAt)}</span>
                        {item.model ? <span>{item.model}</span> : null}
                      </div>
                      <pre className={styles.receiptText}>{item.prompt}</pre>
                      <div className={styles.jobActions}>
                        <button
                          className={styles.ghost}
                          onClick={() => {
                            setEditingId(item.id);
                            setActiveKind(item.kind);
                            setForm({
                              kind: item.kind,
                              title: item.title,
                              description: item.description ?? "",
                              prompt: item.prompt,
                              systemPrompt: item.systemPrompt ?? "",
                              model: item.model ?? "",
                            });
                          }}
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className={styles.ghost}
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item.id)}
                          type="button"
                        >
                          {deletingId === item.id ? "删除中..." : "删除"}
                        </button>
                      </div>
                    </div>
                    <div className={styles.assetPreview}>
                      <span className={styles.previewLabel}>模板信息</span>
                      {item.systemPrompt ? (
                        <div className={styles.previewInfoBox}>
                          <strong>系统提示词</strong>
                          <p>{item.systemPrompt}</p>
                        </div>
                      ) : (
                        <div className={styles.previewInfoBox}>
                          <strong>系统提示词</strong>
                          <p>该模板未设置系统提示词。</p>
                        </div>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className={styles.emptyState}>
                  <p>这个类型还没有提示词，先在左侧创建一个。</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
