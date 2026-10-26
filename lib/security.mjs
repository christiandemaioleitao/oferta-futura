// Módulo SG - Segurança | núcleo sem dependências (roda em Node e Edge).
// Cookie de sessão httpOnly; o valor é um token aleatório, só o hash fica no banco.
const IS_PROD = process.env.NODE_ENV === "production";
// SG_IFRAME=true: app embutido em iframe de outro domínio (portal) -> cookie SameSite=None; Partitioned.
const IFRAME = String(process.env.SG_IFRAME || "").toLowerCase() === "true";

export const SESSION_COOKIE = IS_PROD ? "__Host-ebm-sg-session" : "ebm-sg-session";

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurado no .env desta aplicação.`);
  return value;
}

function corporateDomain() {
  return (process.env.CORPORATE_EMAIL_DOMAIN || "ebm.com.br").trim().toLowerCase().replace(/^@/, "");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isCorporateEmail(email) {
  const normalized = normalizeEmail(email);
  const domain = corporateDomain();
  const parts = normalized.split('@');
  return parts.length === 2 && parts[1] === domain && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(parts[0]) && normalized.length <= 254;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

export function cookieFlags(maxAgeSeconds) {
  if (!IS_PROD) return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
  const site = IFRAME ? "SameSite=None; Partitioned" : "SameSite=Lax";
  return `HttpOnly; Secure; ${site}; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function setCookieHeader(name, value, maxAgeSeconds) {
  return `${name}=${value}; ${cookieFlags(maxAgeSeconds)}`;
}

export function clearCookieHeader(name) {
  return `${name}=; ${cookieFlags(0)}`;
}
