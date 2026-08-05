// Configuração compartilhada do dashboard: os textos editados pelo lápis e o mapa
// KMZ importado. Fica no Neon porque o localStorage guardava só no navegador de quem
// editou — outro usuário nunca via a mudança, e bastava trocar de máquina para "perder".
//
//   GET  /api/config                    -> {config: {...}}  leitura pública
//   POST {senha, chave, valor}          -> grava a chave inteira
//   POST {senha, chave, patch}          -> mescla no objeto já gravado (jsonb ||)
//   POST {senha, chave, apagar:true}    -> remove a chave (volta ao padrão do repositório)
//
// Segurança: a escrita usa a MESMA senha do upload da síntese (SINTESE_UPLOAD_SENHA),
// conferida no servidor. Sem a variável, só a leitura funciona. As chaves são uma
// whitelist: um endpoint público de escrita não pode aceitar nome de chave arbitrário.
import { neon } from '@neondatabase/serverless';

const ORIGENS = [/^https:\/\/oferta-futura[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];
// 'ia' guarda só provedor + modelo. A CHAVE de API nunca entra aqui: o GET é
// público, então gravá-la publicaria a chave do usuário para qualquer visitante.
const CHAVES = new Set(['textos', 'mapa_kmz', 'ia']);
const TABELA = 'site_config';
// a Vercel Hobby corta a requisição perto de 4,5 MB; barrar antes dá erro legível
const MAX_BYTES = 3.5 * 1024 * 1024;

const ddl = sql => sql(`CREATE TABLE IF NOT EXISTS ${TABELA} (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
)`);

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ORIGENS.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) return res.status(500).json({ error: 'DATABASE_URL não configurada no servidor.' });
  const sql = neon(url);

  if (req.method === 'GET') {
    try {
      await ddl(sql);
      const linhas = await sql(`SELECT chave, valor, atualizado_em FROM ${TABELA}`);
      const config = {}, atualizado = {};
      linhas.forEach(l => { config[l.chave] = l.valor; atualizado[l.chave] = l.atualizado_em; });
      // sem cache: o ponto do recurso é todo mundo ver a última versão
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ config, atualizado });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao ler a configuração: ' + (err.message || String(err)) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET ou POST.' });

  const SENHA = process.env.SINTESE_UPLOAD_SENHA;
  if (!SENHA) return res.status(503).json({ error: 'Escrita desativada: defina SINTESE_UPLOAD_SENHA nas variáveis de ambiente da Vercel.' });

  const body = req.body || {};
  if (String(body.senha || '') !== String(SENHA)) return res.status(401).json({ error: 'Senha incorreta.' });

  const chave = String(body.chave || '');
  if (!CHAVES.has(chave)) return res.status(400).json({ error: 'Chave inválida.' });

  try {
    await ddl(sql);

    if (body.apagar) {
      await sql(`DELETE FROM ${TABELA} WHERE chave = $1`, [chave]);
      return res.status(200).json({ ok: true, apagada: chave });
    }

    let alvo = body.patch !== undefined ? body.patch : body.valor;
    if (alvo === undefined) return res.status(400).json({ error: 'Informe valor, patch ou apagar.' });
    /* rede de segurança: 'ia' é lido por qualquer visitante, então só provedor e
       modelo passam. Um 'key' escapando do cliente viraria chave pública. */
    if (chave === 'ia') {
      if (!alvo || typeof alvo !== 'object' || Array.isArray(alvo)) {
        return res.status(400).json({ error: 'ia precisa ser um objeto {provider, model}.' });
      }
      alvo = { provider: String(alvo.provider || ''), model: String(alvo.model || '') };
      if (!alvo.provider || !alvo.model) return res.status(400).json({ error: 'Informe provider e model.' });
    }
    const texto = JSON.stringify(alvo);
    if (texto.length > MAX_BYTES) {
      return res.status(413).json({ error: `Conteúdo grande demais (${(texto.length / 1048576).toFixed(1)} MB; máximo ${(MAX_BYTES / 1048576).toFixed(1)} MB).` });
    }

    if (body.patch !== undefined) {
      // mescla no servidor: dois usuários editando títulos diferentes não se sobrescrevem
      if (alvo === null || typeof alvo !== 'object' || Array.isArray(alvo)) {
        return res.status(400).json({ error: 'patch precisa ser um objeto.' });
      }
      await sql(
        `INSERT INTO ${TABELA} (chave, valor, atualizado_em) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (chave) DO UPDATE SET valor = ${TABELA}.valor || EXCLUDED.valor, atualizado_em = now()`,
        [chave, texto]);
    } else {
      await sql(
        `INSERT INTO ${TABELA} (chave, valor, atualizado_em) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
        [chave, texto]);
    }

    const [linha] = await sql(`SELECT atualizado_em FROM ${TABELA} WHERE chave = $1`, [chave]);
    return res.status(200).json({ ok: true, chave, atualizado_em: linha && linha.atualizado_em, bytes: texto.length });
  } catch (err) {
    return res.status(400).json({ error: 'Erro ao gravar: ' + (err.message || String(err)) });
  }
}
