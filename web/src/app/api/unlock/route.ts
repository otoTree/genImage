import { NextResponse } from "next/server";
import {
  SITE_ACCESS_COOKIE_NAME,
  getSiteAccessToken,
  getSitePassword,
  normalizeNextPath,
} from "@/lib/site-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const submittedPassword =
    typeof formData.get("password") === "string"
      ? String(formData.get("password")).trim()
      : "";
  const nextPath = normalizeNextPath(
    typeof formData.get("next") === "string"
      ? String(formData.get("next"))
      : undefined,
  );
  const sitePassword = getSitePassword();

  if (!sitePassword) {
    return NextResponse.redirect(new URL(nextPath, request.url));
  }

  if (submittedPassword !== sitePassword) {
    const failureUrl = new URL("/unlock", request.url);

    failureUrl.searchParams.set("error", "1");

    if (nextPath !== "/") {
      failureUrl.searchParams.set("next", nextPath);
    }

    return NextResponse.redirect(failureUrl);
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  const token = await getSiteAccessToken();

  response.cookies.set({
    name: SITE_ACCESS_COOKIE_NAME,
    value: token ?? "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
