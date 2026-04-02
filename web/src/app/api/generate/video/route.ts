import {
  createDraftJob,
  getConfigStatus,
  insertJob,
  submitVideoWithCloubic,
} from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const id = crypto.randomUUID();
    const result = await submitVideoWithCloubic(payload);

    const record = await insertJob(
      createDraftJob({
        id,
        kind: "video",
        status: "pending",
        model: String(result.requestBody.model),
        prompt: typeof payload.prompt === "string" ? payload.prompt : "",
        referenceImages: Array.isArray(payload.referenceImages)
          ? payload.referenceImages
          : [],
        requestPayload: result.requestBody,
        providerTaskId: result.providerTaskId,
        providerStatus: result.providerStatus,
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
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "视频任务提交失败",
        config: getConfigStatus(),
      },
      {
        status: 400,
      },
    );
  }
}
