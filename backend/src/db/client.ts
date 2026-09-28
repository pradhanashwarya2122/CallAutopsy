import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const url = process.env.DATABASE_URL ?? '';
const isLocal = /^(postgres(ql)?:\/\/)([^@]+@)?(localhost|127\.0\.0\.1|::1)/i.test(url);
const wantsSsl = /sslmode=require/i.test(url) || (!isLocal && !!url);

export const pool = new Pool({
  connectionString: url,
  ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX ?? 12),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  return pool.query(text, params);
}
