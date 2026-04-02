export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return Response.json({
    ok: true,
  });
}
