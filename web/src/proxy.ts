import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SITE_ACCESS_COOKIE_NAME,
  buildRequestUrl,
  hasValidSiteAccess,
  isSitePasswordEnabled,
  normalizeNextPath,
} from "./lib/site-access";

function isPublicPath(pathname: string) {
  return (
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
    pathname === "/api/health"
  );
}

export async function proxy(request: NextRequest) {
  if (!isSitePasswordEnabled()) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const hasAccess = await hasValidSiteAccess(
    request.cookies.get(SITE_ACCESS_COOKIE_NAME)?.value,
  );

  if (hasAccess) {
    if (pathname === "/unlock") {
      const nextPath = normalizeNextPath(
        request.nextUrl.searchParams.get("next"),
      );

      return NextResponse.redirect(buildRequestUrl(request, nextPath));
    }

    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        ok: false,
        error: "站点已启用访问密码，请先解锁",
      },
      {
        status: 401,
      },
    );
  }

  const loginUrl = buildRequestUrl(request, "/unlock");
  const nextPath = normalizeNextPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  if (nextPath !== "/") {
    loginUrl.searchParams.set("next", nextPath);
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
