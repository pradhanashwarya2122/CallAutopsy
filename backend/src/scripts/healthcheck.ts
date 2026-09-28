import 'dotenv/config';
import { pool } from '../db/client.js';
import { redisConnection } from '../queue/connection.js';

async function main() {
  let ok = true;

  try {
    const r = await pool.query('SELECT 1 AS ok');
    console.log('[db] connected:', r.rows[0]);
  } catch (e) {
    console.error('[db] FAILED:', (e as Error).message);
    ok = false;
  }

  try {
    const pong = await redisConnection.ping();
    console.log('[redis] ping:', pong);
  } catch (e) {
    console.error('[redis] FAILED:', (e as Error).message);
    ok = false;
  }

  await pool.end();
  redisConnection.disconnect();
  process.exit(ok ? 0 : 1);
}

main();
