import {
  ensureAppInfrastructure,
  getConfigStatus,
  listJobsPaginated,
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
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "12");
    const result = await listJobsPaginated({
      page,
      pageSize,
    });

    return Response.json({
      ok: true,
      config,
      jobs: result.items,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config,
        jobs: [],
        pagination: {
          total: 0,
          page: 1,
          pageSize: 12,
          totalPages: 0,
        },
        error: error instanceof Error ? error.message : "读取任务失败",
      },
      {
        status: 500,
      },
    );
  }
}
