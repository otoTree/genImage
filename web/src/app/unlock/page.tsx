import { redirect } from "next/navigation";
import { isSitePasswordEnabled, normalizeNextPath } from "@/lib/site-access";
import styles from "../page.module.css";

type UnlockPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function UnlockPage({ searchParams }: UnlockPageProps) {
  if (!isSitePasswordEnabled()) {
    redirect("/");
  }

  const params = await searchParams;
  const hasError = params.error === "1";
  const nextPath = normalizeNextPath(params.next);

  return (
    <main className={styles.page}>
      <div
        className={styles.main}
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <section
          className={styles.panel}
          style={{
            width: "min(480px, 100%)",
            minHeight: "auto",
          }}
        >
          <div>
            <span className={styles.eyebrow}>Internal Only</span>
            <h1
              style={{
                fontSize: "clamp(32px, 5vw, 44px)",
                lineHeight: 1.05,
                letterSpacing: "-0.05em",
                marginBottom: 16,
              }}
            >
              输入访问密码后再进入工作台
            </h1>
            <p className={styles.description}>
              这个站点只给内部使用。输入环境变量里配置的访问密码后，会在当前浏览器保存登录状态。
            </p>
          </div>

          <form action="/api/unlock" className={styles.form} method="post">
            <input name="next" type="hidden" value={nextPath} />

            <label className={styles.field}>
              <span>访问密码</span>
              <input
                autoComplete="current-password"
                autoFocus
                name="password"
                placeholder="请输入站点密码"
                required
                type="password"
              />
            </label>

            {hasError ? (
              <p className={styles.errorText}>密码不正确，请重试。</p>
            ) : null}

            <button className={styles.submit} type="submit">
              进入网站
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
