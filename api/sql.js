// Consulta read-only ao Neon para o chat de IA do dashboard.
// POST {sql: "SELECT ..."} -> {rows: [...], rowCount, truncated}
import { neon } from '@neondatabase/serverless';
import { requireApiSession } from '../lib/security-node.mjs';

// Comandos que não podem aparecer numa leitura. Palavras que também são identificadores
// do schema ficam de fora de propósito: 'cluster' é coluna de projecao_of, e barrá-la
// rejeitava consultas legítimas do chat.
const BLOCKED = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|merge|reindex|lock|pg_sleep|pg_read|pg_write|pg_ls|pg_terminate|pg_cancel|lo_import|lo_export|dblink)\b/i;
const MAX_ROWS = 200;
const ORIGENS = [/^https:\/\/oferta-futura[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

export default async function handler(req, res) {
  if (!(await requireApiSession(req, res))) return;
  const origin = req.headers.origin || '';
  if (ORIGENS.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const sql = String((req.body && req.body.sql) || '').trim().replace(/;+\s*$/, '');
  if (!sql) return res.status(400).json({ error: 'Informe o SQL.' });
  if (!/^(select|with)\b/i.test(sql)) return res.status(400).json({ error: 'Apenas SELECT/WITH.' });
  if (sql.includes(';')) return res.status(400).json({ error: 'Apenas uma instrução por consulta.' });
  // palavras bloqueadas fora de literais de string ('DO' em nomes de bairro é legítimo)
  const scrubbed = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (BLOCKED.test(scrubbed)) return res.status(400).json({ error: 'Consulta somente leitura.' });

  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) return res.status(500).json({ error: 'DATABASE_URL não configurada no servidor.' });

  try {
    const q = neon(url);
    const rows = await q(`SELECT * FROM (${sql}) AS _q LIMIT ${MAX_ROWS + 1}`);
    const truncated = rows.length > MAX_ROWS;
    return res.status(200).json({ rows: truncated ? rows.slice(0, MAX_ROWS) : rows, rowCount: Math.min(rows.length, MAX_ROWS), truncated });
  } catch (err) {
    return res.status(400).json({ error: 'Erro na consulta: ' + (err.message || String(err)) });
  }
}
