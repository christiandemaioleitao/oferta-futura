import { SESSION_COOKIE, clearCookieHeader, isCorporateEmail, normalizeEmail, requiredEnv, setCookieHeader } from '../../lib/security.mjs';
import { createSessionCookieValue, isAuthorizedEmail, revokeSessionToken, sendOtpWithNeon, verifyOtpWithNeon } from '../../lib/security-db.mjs';
import { publicAccessEnabled, readSession, sameOrigin, sessionToken } from '../../lib/security-node.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const action = req.query?.action;
  if (!['state', 'request-otp', 'verify-otp', 'logout'].includes(action)) return res.status(404).json({ error: 'Não encontrado.' });
  if (req.method !== (action === 'state' ? 'GET' : 'POST')) return res.status(405).json({ error: 'Método não permitido.' });
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, reason: 'invalid_origin' });
  if (publicAccessEnabled()) {
    if (action === 'state') return res.status(200).json({ authenticated: false, publicAccess: true, email: null });
    return res.status(409).json({ ok: false, reason: 'authentication_disabled' });
  }
  if (action === 'state') {
    const session = await readSession(req);
    return res.status(200).json({ authenticated: Boolean(session), email: session?.email ?? null });
  }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return res.status(415).json({ ok: false, reason: 'invalid_request' });
  }
  try {
    if (action === 'logout') {
      await revokeSessionToken(sessionToken(req));
      res.setHeader('Set-Cookie', clearCookieHeader(SESSION_COOKIE));
      return res.status(200).json({ ok: true });
    }
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    if (!isCorporateEmail(email)) return res.status(400).json({ ok: false, reason: 'corporate_only' });
    requiredEnv('SG_DATABASE_URL');
    if (requiredEnv('APP_KEY') !== 'oferta_futura') throw new Error('APP_KEY inválida');
    requiredEnv('NEON_AUTH_URL');
    requiredEnv('APP_ORIGIN');

    if (action === 'request-otp') {
      // A mesma resposta para qualquer e-mail corporativo: não enumera sg.acessos.
      if (await isAuthorizedEmail(email)) {
        const sent = await sendOtpWithNeon(email).catch(() => false);
        if (!sent) console.warn('SG: envio de código indisponível no provedor.');
      }
      return res.status(200).json({ ok: true });
    }
    const otp = String(body.otp || '').trim();
    if (!/^\d{6}$/.test(otp) || !(await isAuthorizedEmail(email)) || !(await verifyOtpWithNeon(email, otp))) {
      return res.status(401).json({ ok: false, reason: 'invalid_otp' });
    }
    // Revalidar após o OTP: uma autorização pode ter sido retirada durante o login.
    if (!(await isAuthorizedEmail(email))) return res.status(401).json({ ok: false, reason: 'invalid_otp' });
    const { token, maxAgeSeconds } = await createSessionCookieValue(email, 'otp');
    res.setHeader('Set-Cookie', setCookieHeader(SESSION_COOKIE, token, maxAgeSeconds));
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ ok: false, reason: 'security_unavailable' });
  }
}
