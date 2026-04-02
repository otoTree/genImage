import {
  ensureAppInfrastructure,
  getConfigStatus,
  listRecentJobs,
} from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const config = getConfigStatus();

  if (searchParams.get("configOnly") === "1") {
    return Response.json({
      ok: true,
      config,
    });
  }

  try {
    await ensureAppInfrastructure();
    const jobs = await listRecentJobs();

    return Response.json({
      ok: true,
      config,
      jobs,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config,
        jobs: [],
        error: error instanceof Error ? error.message : "读取任务失败",
      },
      {
        status: 500,
      },
    );
  }
}
