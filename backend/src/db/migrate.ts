import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

// Runs schema.sql on boot. Idempotent — every CREATE / ALTER uses IF NOT EXISTS.
export async function migrate() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // In prod the compiled JS lives in dist/, so schema.sql sits next to this file
  // only in dev (tsx). Try both locations.
  const candidates = [
    path.join(here, 'schema.sql'),
    path.join(here, '..', '..', 'src', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'backend', 'src', 'db', 'schema.sql'),
  ];
  let sql: string | null = null;
  let used = '';
  for (const p of candidates) {
    try {
      sql = await fs.readFile(p, 'utf8');
      used = p;
      break;
    } catch {}
  }
  if (!sql) {
    console.error('[migrate] schema.sql not found in any candidate path');
    return;
  }
  try {
    await pool.query(sql);
    console.log(`[migrate] applied schema.sql (${used})`);
  } catch (e) {
    console.error('[migrate] failed:', (e as Error).message);
  }
}
