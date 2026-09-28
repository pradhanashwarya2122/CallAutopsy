import http from 'http';
import { createServer } from './server.js';
import { attachWebSocket } from './websocket/broadcaster.js';
import { startSlaMonitor } from './sla/monitor.js';
import { startCallWorker, callQueue } from './queue/retryQueue.js';
import { startHealingMonitor } from './healing/suggestEngine.js';
import { pool, query } from './db/client.js';
import { redisConnection } from './queue/connection.js';
import { migrate } from './db/migrate.js';
import 'dotenv/config';

const app = createServer();
const server = http.createServer(app);
attachWebSocket(server);

const port = Number(process.env.PORT) || 3000;
let worker: any = null;
let shuttingDown = false;

server.listen(port, async () => {
  console.log(`[call-autopsy] listening on :${port}`);
  // Auto-apply schema on boot — safe because every CREATE / ALTER is IF NOT EXISTS.
  try { await migrate(); } catch (e) { console.error('[migrate]', (e as Error).message); }
  try {
    worker = startCallWorker();
    startSlaMonitor();
    startHealingMonitor();
  } catch (e) {
    console.error('[boot] worker/sla start failed:', (e as Error).message);
  }
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] signal=${signal}, draining…`);

  // 1. stop taking new HTTP
  await new Promise<void>((r) => server.close(() => r()));

  // 2. drain worker
  try {
    if (worker) {
      await worker.close();
    }
    await callQueue.close();
  } catch (e) {
    console.error('[shutdown] worker close', (e as Error).message);
  }

  // 3. mark in-flight calls as aborted
  try {
    await query(
      `UPDATE calls SET status='aborted', ended_at=now(), updated_at=now()
       WHERE status IN ('queued','in_progress')`,
    );
  } catch (e) {
    console.error('[shutdown] mark aborted', (e as Error).message);
  }

  // 4. close DB + Redis
  try { await pool.end(); } catch {}
  try { redisConnection.disconnect(); } catch {}

  console.log('[shutdown] done');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
