import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_KEY = 'oferta_futura';
process.env.SG_DATABASE_URL = 'test-only';
process.env.NEON_AUTH_URL = 'https://auth.invalid/neondb/auth';
process.env.APP_ORIGIN = 'https://oferta-futura.vercel.app';
const queries = [];
let rows = [];
mock.module('@neondatabase/serverless', { namedExports: {
  neon: () => async (parts, ...params) => { queries.push({ text: parts.join('?'), params }); return rows; },
} });
const db = await import('../lib/security-db.mjs');
const { sha256 } = await import('../lib/security.mjs');

test('SG: grava só o hash e vincula sessão ao app e à whitelist ativa', async () => {
  const session = await db.createSessionCookieValue(' TESTE@EBM.COM.BR ', 'otp');
  const insert = queries.at(-1);
  assert.match(insert.text, /INSERT INTO sg.sessoes/);
  assert.ok(insert.params.includes(await sha256(session.token)));
  assert.ok(!insert.params.includes(session.token));
  assert.ok(insert.params.includes('oferta_futura'));
  assert.ok(insert.params.includes('teste@ebm.com.br'));
  rows = [{ email: 'teste@ebm.com.br', origem: 'otp', expira_em: '2026-10-27' }];
  assert.equal((await db.getSessionFromToken(session.token)).email, 'teste@ebm.com.br');
  const lookup = queries.at(-1);
  for (const requirement of ['INNER JOIN sg.acessos', 'a.ativo = TRUE', 's.aplicacao =', 's.revogado_em IS NULL', 's.expira_em > NOW()']) assert.ok(lookup.text.includes(requirement));
  rows = [];
  assert.equal(await db.getSessionFromToken(session.token), null);
  await db.revokeSessionToken(session.token);
  assert.match(queries.at(-1).text, /revogado_em = COALESCE/);
  assert.match(queries.at(-1).text, /AND aplicacao =/);
});

test('SG: contrato do Neon Auth exige correspondência do e-mail verificado', async () => {
  const original = globalThis.fetch;
  let calls = [], responseEmail = 'teste@ebm.com.br';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ user: { email: responseEmail } }) };
  };
  try {
    assert.equal(await db.sendOtpWithNeon(' TESTE@EBM.COM.BR '), true);
    assert.equal(calls[0].url, 'https://auth.invalid/neondb/auth/email-otp/send-verification-otp');
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'teste@ebm.com.br', type: 'sign-in' });
    assert.ok(calls[0].options.signal);
    assert.equal(await db.verifyOtpWithNeon('teste@ebm.com.br', '123456'), true);
    assert.equal(calls[1].url, 'https://auth.invalid/neondb/auth/sign-in/email-otp');
    responseEmail = 'outro@ebm.com.br';
    assert.equal(await db.verifyOtpWithNeon('teste@ebm.com.br', '123456'), false);
  } finally { globalThis.fetch = original; }
});
