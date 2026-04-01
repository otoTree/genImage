import {
  ensureAppInfrastructure,
  getConfigStatus,
  listRecentJobs,
} from "@/lib/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureAppInfrastructure();
    const jobs = await listRecentJobs();

    return Response.json({
      ok: true,
      config: getConfigStatus(),
      jobs,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config: getConfigStatus(),
        jobs: [],
        error: error instanceof Error ? error.message : "读取任务失败",
      },
      {
        status: 500,
      },
    );
  }
}
