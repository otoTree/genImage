import {
  ensureAppInfrastructure,
  getConfigStatus,
  insertPromptTemplate,
  listPromptTemplates,
} from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const config = getConfigStatus();

  try {
    await ensureAppInfrastructure();

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const prompts = await listPromptTemplates(
      kind === "text" || kind === "image" || kind === "video" ? kind : undefined,
    );

    return Response.json({
      ok: true,
      config,
      prompts,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        config,
        prompts: [],
        error: error instanceof Error ? error.message : "读取提示词失败",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: Request) {
  const config = getConfigStatus();

  try {
    await ensureAppInfrastructure();
    const payload = await request.json();
    const prompt = await insertPromptTemplate(payload);

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
        error: error instanceof Error ? error.message : "保存提示词失败",
      },
      {
        status: 400,
      },
    );
  }
}
