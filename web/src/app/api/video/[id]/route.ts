import {
  getConfigStatus,
  getJobById,
  getVideoStatusWithCloubic,
  normalizeVideoGenerationStatus,
  updateJob,
  uploadSourceToS3,
} from "@/lib/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const record = await getJobById(id);

    if (!record) {
      return Response.json(
        {
          ok: false,
          error: "任务不存在",
          config: getConfigStatus(),
        },
        {
          status: 404,
        },
      );
    }

    if (!record.providerTaskId) {
      return Response.json(
        {
          ok: false,
          error: "任务缺少 providerTaskId",
          config: getConfigStatus(),
        },
        {
          status: 400,
        },
      );
    }

    const result = await getVideoStatusWithCloubic(record.providerTaskId);
    let storageKey = record.storageKey;
    let storageUrl = record.storageUrl;

    if (result.videoUrl && (!storageKey || !storageUrl)) {
      const uploaded = await uploadSourceToS3({
        source: result.videoUrl,
        kind: "video",
        jobId: record.id,
      });

      storageKey = uploaded.key;
      storageUrl = uploaded.url;
    }

    const nextStatus = normalizeVideoGenerationStatus({
      currentStatus: record.status,
      providerStatus: result.providerStatus,
      sourceUrl: result.videoUrl ?? record.sourceUrl,
      storageUrl,
    });

    const updatedRecord = await updateJob(record.id, {
      status: nextStatus,
      sourceUrl: result.videoUrl ?? record.sourceUrl,
      storageKey,
      storageUrl,
      providerStatus: result.providerStatus ?? record.providerStatus,
      metadata: {
        ...record.metadata,
        progress: result.progress,
        lastVideoStatusResponse: result.response,
      },
      errorMessage:
        nextStatus === "failed" ? "视频生成失败，请检查上游任务状态" : null,
    });

    return Response.json({
      ok: true,
      job: updatedRecord,
      config: getConfigStatus(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "刷新视频任务失败",
        config: getConfigStatus(),
      },
      {
        status: 400,
      },
    );
  }
}
