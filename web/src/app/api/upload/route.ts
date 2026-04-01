import { getConfigStatus, uploadBufferToS3 } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const target =
      typeof formData.get("target") === "string"
        ? String(formData.get("target"))
        : "reference";
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File);

    if (!files.length) {
      return Response.json(
        {
          ok: false,
          error: "请先选择至少一张图片",
          config: getConfigStatus(),
        },
        {
          status: 400,
        },
      );
    }

    const uploads = await Promise.all(
      files.map(async (file) => {
        if (!file.type.startsWith("image/")) {
          throw new Error(`文件 ${file.name} 不是图片格式`);
        }

        const arrayBuffer = await file.arrayBuffer();
        const uploaded = await uploadBufferToS3({
          body: new Uint8Array(arrayBuffer),
          contentType: file.type || "application/octet-stream",
          folder: `uploads/${target}`,
          fileName: file.name,
        });

        return {
          name: file.name,
          type: file.type,
          size: file.size,
          key: uploaded.key,
          url: uploaded.url,
        };
      }),
    );

    return Response.json({
      ok: true,
      files: uploads,
      config: getConfigStatus(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "图片上传失败",
        config: getConfigStatus(),
      },
      {
        status: 400,
      },
    );
  }
}
