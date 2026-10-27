// Adaptação SG para as funções Node da Vercel (sem middleware Edge).
import { SESSION_COOKIE } from './security.mjs';
import { getSessionFromToken } from './security-db.mjs';

// Acesso público temporário autorizado; remover a variável restaura o SG.
export function publicAccessEnabled() {
  return process.env.SG_AUTH_DISABLED === 'true';
}

export function sessionToken(req) {
  const part = String(req.headers?.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(SESSION_COOKIE + '='));
  const token = part?.slice(SESSION_COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return req.headers?.['sec-fetch-site'] !== 'cross-site';
  try {
    const url = new URL(origin);
    const protocol = process.env.NODE_ENV === 'production' ? 'https:' : url.protocol;
    return url.protocol === protocol && url.host === req.headers.host;
  } catch { return false; }
}

export async function readSession(req) {
  const token = sessionToken(req);
  return token ? getSessionFromToken(token).catch(() => null) : null;
}

export async function requireApiSession(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return null;
  }
  if (publicAccessEnabled()) return { origem: 'public' };
  const session = await readSession(req);
  if (!session) res.status(401).json({ error: 'Acesso não autorizado.' });
  return session;
}
