export const SITE_PASSWORD_ENV_NAME = "SITE_PASSWORD";
export const SITE_ACCESS_COOKIE_NAME = "site_access";
export const SITE_ACCESS_COOKIE_SECURE_ENV_NAME = "SITE_ACCESS_COOKIE_SECURE";

let cachedPassword: string | undefined;
let cachedTokenPromise: Promise<string | undefined> | null = null;

export function getSitePassword() {
  const value = process.env[SITE_PASSWORD_ENV_NAME]?.trim();

  return value || undefined;
}

export function isSitePasswordEnabled() {
  return Boolean(getSitePassword());
}

export function normalizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function getForwardedHeaderValue(request: Request, headerName: string) {
  return request.headers
    .get(headerName)
    ?.split(",")[0]
    ?.trim();
}

export function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = getForwardedHeaderValue(request, "x-forwarded-proto");
  const forwardedHost = getForwardedHeaderValue(request, "x-forwarded-host");
  const host = forwardedHost ?? getForwardedHeaderValue(request, "host");
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : url.protocol.replace(":", "");

  if (!host) {
    return url.origin;
  }

  return `${protocol}://${host}`;
}

export function buildRequestUrl(request: Request, pathname: string) {
  return new URL(pathname, getRequestOrigin(request));
}

export function shouldUseSecureSiteAccessCookie(request: Request) {
  const configuredValue =
    process.env[SITE_ACCESS_COOKIE_SECURE_ENV_NAME]?.trim().toLowerCase();

  if (configuredValue === "true") {
    return true;
  }

  if (configuredValue === "false") {
    return false;
  }

  const forwardedProto = getForwardedHeaderValue(request, "x-forwarded-proto")
    ?.toLowerCase();

  if (forwardedProto === "https") {
    return true;
  }

  if (forwardedProto === "http") {
    return false;
  }

  return new URL(request.url).protocol === "https:";
}

async function hashValue(value: string) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(buffer), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getSiteAccessToken() {
  const password = getSitePassword();

  if (!password) {
    return undefined;
  }

  if (cachedPassword !== password || !cachedTokenPromise) {
    cachedPassword = password;
    cachedTokenPromise = hashValue(password);
  }

  return cachedTokenPromise;
}

export async function hasValidSiteAccess(value: string | undefined) {
  const expectedToken = await getSiteAccessToken();

  if (!expectedToken) {
    return true;
  }

  return value === expectedToken;
}
