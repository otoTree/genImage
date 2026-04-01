export const SITE_PASSWORD_ENV_NAME = "SITE_PASSWORD";
export const SITE_ACCESS_COOKIE_NAME = "site_access";

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
