// Auditor da skill SG, adaptado de scripts/auditar.mjs para HTML + Vercel Node.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const errors = [];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const check = (ok, msg) => { if (!ok) errors.push(msg); };
function files(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(item => {
    const name = path.posix.join(dir, item.name);
    if (item.isSymbolicLink()) { errors.push(`Link simbólico não permitido: ${name}`); return []; }
    return item.isDirectory() ? files(name) : [name];
  });
}

const html = read('index.html');
check(/id="dashboardRoot" hidden/.test(html) && /id="sgGate"/.test(html) && /src="js\/security-gate.js/.test(html), 'Gate SG ausente no HTML.');
check(!/<script\b[^>]*\ssrc="data\//.test(html), 'Dados carregados antes da autenticação.');
for (const file of ['lib/security.mjs', 'lib/security-db.mjs', 'lib/security-node.mjs', 'js/security-gate.js']) {
  check(fs.existsSync(path.join(root, file)), `Módulo SG ausente: ${file}`);
}
const auth = read('api/security/[action].js');
for (const action of ['state', 'request-otp', 'verify-otp', 'logout']) {
  check(auth.includes(`'${action}'`), `Endpoint SG ausente: ${action}`);
}
const api = files('api').filter(f => /\.js$/.test(f) && !f.startsWith('api/security/'));
for (const file of api) {
  const body = read(file).split('export default async function handler(req, res) {')[1] || '';
  check(body.trimStart().startsWith('if (!(await requireApiSession(req, res))) return;'), `${file}: sessão deve ser a primeira instrução do handler.`);
}
check(/^\.env\*$/m.test(read('.gitignore')), '.gitignore deve ignorar .env*.');
for (const file of ['audit-security.mjs', 'build-site.mjs']) check(read('.vercelignore').includes('!scripts/' + file), `A Vercel precisa incluir scripts/${file}.`);
const config = JSON.parse(read('vercel.json'));
check(config.outputDirectory === 'dist', 'A Vercel deve publicar somente dist.');
check(config.buildCommand === 'npm run build', 'A Vercel deve executar a auditoria no build.');
check(config.rewrites.some(r => r.source === '/data/:file*' && r.destination === '/api/secure-data?file=:file*'), 'Dados sem rewrite para a API protegida.');
check(config.rewrites.some(r => r.source === '/sintese_schema.json' && r.destination === '/api/secure-data?file=sintese_schema.json'), 'Schema sem rewrite protegido.');
check(config.functions['api/secure-data.js']?.includeFiles === '{data/**,sintese_schema.json}', 'Arquivos privados não incluídos na função.');
check(config.headers.some(rule => rule.headers.some(h => h.key === 'Content-Security-Policy' && h.value.includes('frame-ancestors'))), 'CSP ausente.');
const pkg = JSON.parse(read('package.json'));
check(pkg.scripts.build.startsWith('node scripts/audit-security.mjs &&') && pkg.scripts.build.endsWith('node scripts/audit-security.mjs --output'), 'Auditoria deve rodar antes e depois de gerar dist.');

for (const file of [...files('js'), ...files('lib'), ...api]) {
  const text = read(file);
  check(!/NEXT_PUBLIC_[A-Z0-9_]*(PASSWORD|SECRET|DATABASE|TOKEN|KEY)[A-Z0-9_]*/.test(text), `Variável sensível pública: ${file}`);
  check(!/postgres(?:ql)?:\/\/[^\s'"`$]+:[^\s'"`$@]+@/.test(text), `Credencial de banco embutida: ${file}`);
  check(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), `Token GitHub embutido: ${file}`);
}
check(!/CREATE\s+(?:TABLE|SCHEMA)[\s\S]{0,50}\bsg\b/i.test(read('lib/security-db.mjs')), 'O app não pode criar tabelas do SG.');
if (process.argv.includes('--output')) {
  for (const file of files('dist')) {
    const rel = path.posix.relative('dist', file);
    check(rel === 'index.html' || /^(?:css|js|assets)\//.test(rel), `Arquivo fora da lista pública: ${rel}`);
    check(!/\.(?:json|csv|sql|xlsx?|km[zl]|gz|zip|env|bak|sqlite|db)$/i.test(rel), `Arquivo de dados publicado: ${rel}`);
    if (rel.endsWith('.js')) check(!/window\.OF_(?:DATA|MAPA|BAIRROS)\s*=/.test(read(file)), `Dados privados no bundle público: ${rel}`);
  }
}
if (errors.length) {
  console.error('SG SECURITY AUDIT: FALHOU\n' + errors.map(e => '- ' + e).join('\n'));
  process.exit(1);
}
console.log(`SG SECURITY AUDIT: OK — gate, ${api.length} APIs e publicação privada verificados.`);
