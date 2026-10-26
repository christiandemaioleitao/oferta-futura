import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

process.env.NODE_ENV = 'production';
process.env.SG_DATABASE_URL = 'test-only';
process.env.APP_KEY = 'oferta_futura';
process.env.APP_ORIGIN = 'https://oferta-futura.vercel.app';
process.env.NEON_AUTH_URL = 'https://auth.invalid';
const token = 'A'.repeat(43);
let active = true, sent = [], revoked = [], sessions = [], delivery = true;
mock.module('../lib/security-db.mjs', { namedExports: {
  getSessionFromToken: async value => active && value === token ? { email: 'teste@ebm.com.br', origem: 'otp' } : null,
  isAuthorizedEmail: async email => email === 'teste@ebm.com.br',
  sendOtpWithNeon: async email => { sent.push(email); return delivery; },
  verifyOtpWithNeon: async (_email, otp) => otp === '123456',
  createSessionCookieValue: async (email, origem) => { sessions.push({ email, origem }); return { token, maxAgeSeconds: 43200 }; },
  revokeSessionToken: async value => { if (value) revoked.push(value); active = false; },
} });
const core = await import('../lib/security.mjs');
const { default: security } = await import('../api/security/[action].js');
const protectedHandlers = await Promise.all(['sql', 'config', 'upload-sintese', 'atualizar-portal', 'secure-data'].map(async name => [name, (await import(`../api/${name}.js`)).default]));

function request({ action, method = action === 'state' ? 'GET' : 'POST', cookie = '', body = {}, origin = 'https://oferta-futura.vercel.app', query = {} } = {}) {
  return { method, headers: { host: 'oferta-futura.vercel.app', origin, 'content-type': 'application/json', cookie }, query: { ...query, ...(action ? { action } : {}) }, body };
}
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body; return this; } };
}
const cookie = `${core.SESSION_COOKIE}=${token}`;
async function call(handler, opts) { const res = response(); await handler(request(opts), res); return res; }

test('SG: cookies seguros e núcleo criptográfico', async () => {
  const a = core.randomToken(), b = core.randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(await core.sha256(a), a);
  assert.equal(await core.sha256(a), await core.sha256(a));
  const header = core.setCookieHeader(core.SESSION_COOKIE, a, 43200);
  for (const flag of ['__Host-', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) assert.ok(header.includes(flag));
  assert.ok(!header.includes('Domain='));
});

test('SG: todas as APIs recusam anônimo antes de ler o corpo ou banco', async () => {
  for (const [name, handler] of protectedHandlers) {
    const req = request();
    Object.defineProperty(req, 'body', { get() { throw new Error('não pode ler o corpo antes da sessão'); } });
    const res = response();
    await handler(req, res);
    assert.equal(res.code, 401, name);
    assert.match(res.headers['Cache-Control'], /no-store/);
  }
});

test('SG: sessão inválida, revogada ou expirada não acessa os dados', async () => {
  active = false;
  for (const [name, handler] of protectedHandlers) assert.equal((await call(handler, { cookie })).code, 401, name);
  assert.deepEqual((await call(security, { action: 'state', cookie })).body, { authenticated: false, email: null });
  active = true;
  assert.equal((await call(protectedHandlers[0][1], { cookie: `${core.SESSION_COOKIE}=inválido` })).code, 401);
});

test('SG: state anônimo não precisa de configuração nem expõe e-mail', async () => {
  assert.deepEqual((await call(security, { action: 'state' })).body, { authenticated: false, email: null });
  assert.deepEqual((await call(security, { action: 'state', cookie })).body, { authenticated: true, email: 'teste@ebm.com.br' });
});

test('SG: domínio, formatos de e-mail e OTP inválidos são recusados', async () => {
  for (const email of ['a@gmail.com', 'a@@ebm.com.br', 'a@outro.ebm.com.br', '@ebm.com.br', 'a b@ebm.com.br']) {
    assert.equal((await call(security, { action: 'request-otp', body: { email } })).code, 400);
  }
  for (const otp of ['123', 'abcdef', '1234567', '111111']) {
    assert.equal((await call(security, { action: 'verify-otp', body: { email: 'teste@ebm.com.br', otp } })).code, 401);
  }
  assert.equal(sessions.length, 0);
});

test('SG: envio não revela autorização nem falha individual do provedor', async () => {
  sent = [];
  const allowed = await call(security, { action: 'request-otp', body: { email: 'teste@ebm.com.br' } });
  const denied = await call(security, { action: 'request-otp', body: { email: 'outro@ebm.com.br' } });
  assert.deepEqual(allowed.body, denied.body);
  assert.equal(allowed.code, denied.code);
  assert.deepEqual(sent, ['teste@ebm.com.br']);
  delivery = false;
  assert.deepEqual((await call(security, { action: 'request-otp', body: { email: 'teste@ebm.com.br' } })).body, denied.body);
  delivery = true;
  const unauthorized = await call(security, { action: 'verify-otp', body: { email: 'outro@ebm.com.br', otp: '123456' } });
  assert.deepEqual(unauthorized.body, { ok: false, reason: 'invalid_otp' });
});

test('SG: falha fechada quando faltam variáveis ou APP_KEY está incorreta', async () => {
  const saved = process.env.SG_DATABASE_URL;
  delete process.env.SG_DATABASE_URL;
  assert.equal((await call(security, { action: 'request-otp', body: { email: 'teste@ebm.com.br' } })).code, 503);
  process.env.SG_DATABASE_URL = saved;
  process.env.APP_KEY = 'outro_app';
  assert.equal((await call(security, { action: 'verify-otp', body: { email: 'teste@ebm.com.br', otp: '123456' } })).code, 503);
  process.env.APP_KEY = 'oferta_futura';
});

test('SG: origens externas são recusadas mesmo com cookie', async () => {
  for (const [, handler] of protectedHandlers) assert.equal((await call(handler, { cookie, origin: 'https://outro.invalid' })).code, 403);
  assert.equal((await call(security, { action: 'request-otp', origin: 'https://outro.invalid', body: { email: 'teste@ebm.com.br' } })).code, 403);
});

test('SG: dados privados exigem sessão e não permitem travessia de diretórios', async () => {
  const handler = protectedHandlers.find(([name]) => name === 'secure-data')[1];
  const res = await call(handler, { method: 'GET', cookie, query: { file: 'dados_of.js' } });
  assert.equal(res.code, 200);
  assert.match(res.body.toString(), /^window.OF_DATA=/);
  for (const file of ['../package.json', '%2e%2e/package.json', 'plano_diretor/../../package.json', ['dados_of.js'], 'fontes/arquivo.csv']) {
    assert.equal((await call(handler, { method: 'GET', cookie, query: { file } })).code, 404);
  }
  assert.equal((await call(handler, { method: 'GET', cookie, query: { file: 'sintese_schema.json' } })).code, 200);
  for (const file of await readdir(new URL('../data/plano_diretor/', import.meta.url))) {
    assert.equal((await call(handler, { method: 'GET', cookie, query: { file: 'plano_diretor/' + file } })).code, 200, file);
  }
});

test('SG: login cria cookie httpOnly e logout revoga a sessão', async () => {
  const login = await call(security, { action: 'verify-otp', body: { email: ' TESTE@EBM.COM.BR ', otp: '123456' } });
  assert.equal(login.code, 200);
  assert.deepEqual(login.body, { ok: true });
  assert.match(login.headers['Set-Cookie'], /HttpOnly; Secure;/);
  assert.deepEqual(sessions, [{ email: 'teste@ebm.com.br', origem: 'otp' }]);
  const logout = await call(security, { action: 'logout', cookie });
  assert.equal(logout.code, 200);
  assert.deepEqual(revoked, [token]);
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/);
  assert.deepEqual((await call(security, { action: 'state', cookie })).body, { authenticated: false, email: null });
});
