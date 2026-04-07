import {
  deletePromptTemplate,
  ensureAppInfrastructure,
  getConfigStatus,
  getPromptTemplateById,
  updatePromptTemplate,
} from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const config = getConfigStatus();

  try {
    await ensureAppInfrastructure();
    const { id } = await context.params;
    const prompt = await getPromptTemplateById(id);

    if (!prompt) {
      return Response.json(
        {
          ok: false,
          config,
          error: "提示词不存在",
        },
        {
          status: 404,
        },
      );
    }

    return Response.json({
      ok: true,
      config,
      prompt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config,
        error: error instanceof Error ? error.message : "读取提示词失败",
      },
      {
        status: 500,
      },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const config = getConfigStatus();

  try {
    await ensureAppInfrastructure();
    const { id } = await context.params;
    const payload = await request.json();
    const prompt = await updatePromptTemplate(id, payload);

    return Response.json({
      ok: true,
      config,
      prompt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config,
        error: error instanceof Error ? error.message : "更新提示词失败",
      },
      {
        status: 400,
      },
    );
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const config = getConfigStatus();

  try {
    await ensureAppInfrastructure();
    const { id } = await context.params;
    await deletePromptTemplate(id);

    return Response.json({
      ok: true,
      config,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config,
        error: error instanceof Error ? error.message : "删除提示词失败",
      },
      {
        status: 400,
      },
    );
  }
}
