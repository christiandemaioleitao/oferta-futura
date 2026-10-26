/**
 * Módulo SG - Segurança: fala com o banco de dados (Neon "SG - Segurança")
 * e com o Neon Auth. Só é usado dentro de rotas de API (Node.js).
 */
import { normalizeEmail, isCorporateEmail, randomToken, sha256, requiredEnv } from "./security.mjs";

function appKey() {
  const key = requiredEnv("APP_KEY");
  if (key !== 'oferta_futura') throw new Error('APP_KEY inválida para Oferta Futura.');
  return key;
}

function sessionTtlHours() {
  const parsed = Number(process.env.SESSION_TTL_HOURS || "12");
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24 * 7) : 12;
}

let sgClientSingleton = null;
async function sgClient() {
  if (!sgClientSingleton) {
    const { neon } = await import("@neondatabase/serverless");
    sgClientSingleton = neon(requiredEnv("SG_DATABASE_URL"));
  }
  return sgClientSingleton;
}

export async function isAuthorizedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!isCorporateEmail(normalized)) return false;
  const sql = await sgClient();
  const rows = await sql`
    SELECT 1 FROM sg.acessos
    WHERE lower(trim(email)) = ${normalized}
      AND aplicacao = ${appKey()}
      AND ativo = TRUE
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function createSessionCookieValue(email, origem) {
  const normalized = normalizeEmail(email);
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const ttlHours = sessionTtlHours();
  const sql = await sgClient();
  await sql`
    INSERT INTO sg.sessoes (token_hash, email, aplicacao, origem, expira_em)
    VALUES (${tokenHash}, ${normalized}, ${appKey()}, ${origem}, NOW() + (${ttlHours} * INTERVAL '1 hour'))
  `;
  return { token, maxAgeSeconds: Math.floor(ttlHours * 60 * 60) };
}

export async function getSessionFromToken(token) {
  if (!token) return null;
  const tokenHash = await sha256(token);
  const sql = await sgClient();
  const rows = await sql`
    SELECT s.email, s.origem, s.expira_em
    FROM sg.sessoes s
    INNER JOIN sg.acessos a
      ON lower(trim(a.email)) = lower(s.email)
     AND a.aplicacao = s.aplicacao
     AND a.ativo = TRUE
    WHERE s.token_hash = ${tokenHash}
      AND s.aplicacao = ${appKey()}
      AND s.revogado_em IS NULL
      AND s.expira_em > NOW()
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return { email: row.email, origem: row.origem, expiraEm: row.expira_em };
}

export async function revokeSessionToken(token) {
  if (!token) return;
  const tokenHash = await sha256(token);
  const sql = await sgClient();
  await sql`UPDATE sg.sessoes SET revogado_em = COALESCE(revogado_em, NOW()) WHERE token_hash = ${tokenHash} AND aplicacao = ${appKey()}`;
}

function neonAuthBaseUrl() {
  return requiredEnv("NEON_AUTH_URL").replace(/\/$/, "");
}

async function neonAuthPost(path, body) {
  const response = await fetch(`${neonAuthBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(process.env.APP_ORIGIN ? { origin: process.env.APP_ORIGIN } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  return { ok: response.ok, payload };
}

export async function sendOtpWithNeon(email) {
  const result = await neonAuthPost("/email-otp/send-verification-otp", {
    email: normalizeEmail(email),
    type: "sign-in",
  });
  return result.ok;
}

export async function verifyOtpWithNeon(email, otp) {
  const normalized = normalizeEmail(email);
  const result = await neonAuthPost("/sign-in/email-otp", { email: normalized, otp });
  if (!result.ok || !result.payload || typeof result.payload !== "object") return false;
  const user = result.payload.user;
  if (!user || typeof user !== "object") return false;
  return normalizeEmail(String(user.email || "")) === normalized;
}
