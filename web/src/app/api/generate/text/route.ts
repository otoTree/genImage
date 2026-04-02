import {
  createDraftJob,
  generateTextWithCloubic,
  getConfigStatus,
  insertJob,
} from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const id = crypto.randomUUID();
    const result = await generateTextWithCloubic(payload);

    const record = await insertJob(
      createDraftJob({
        id,
        kind: "text",
        status: "completed",
        model: String(result.requestBody.model),
        prompt: String(payload.prompt),
        systemPrompt:
          typeof payload.systemPrompt === "string" ? payload.systemPrompt : null,
        responseFormat:
          typeof payload.responseFormat === "string"
            ? payload.responseFormat
            : "text",
        referenceImages: Array.isArray(payload.referenceImages)
          ? payload.referenceImages
          : [],
        requestPayload: result.requestBody,
        resultText: result.content,
        metadata: {
          provider: "cloubic",
          rawResponse: result.response,
        },
      }),
    );

    return Response.json({
      ok: true,
      job: record,
      config: getConfigStatus(),
    });
  } catch (error) {
    if (error instanceof Error) {
      return Response.json(
        {
          ok: false,
          error: error.message,
          config: getConfigStatus(),
        },
        {
          status: 400,
        },
      );
    }

    return Response.json(
      {
        ok: false,
        error: "文本生成失败",
        config: getConfigStatus(),
      },
      {
        status: 500,
      },
    );
  }
}
