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
const HOST = '0.0.0.0';
let worker: any = null;
let shuttingDown = false;

// Bind explicitly to 0.0.0.0 so Railway's edge proxy can reach the container.
// The startup callback runs migrations and starts background workers AFTER
// the socket is bound — so the platform sees the port up immediately and
// the healthcheck doesn't fail while migrations run.
server.listen(port, HOST, () => {
  console.log(`[call-autopsy] listening on ${HOST}:${port}`);
  // Kick off async boot work but don't block the listen callback.
  (async () => {
    try { await migrate(); } catch (e) { console.error('[migrate]', (e as Error).message); }
    try {
      worker = startCallWorker();
      startSlaMonitor();
      startHealingMonitor();
    } catch (e) {
      console.error('[boot] worker/sla start failed:', (e as Error).message);
    }
  })();
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] signal=${signal}, draining…`);

  await new Promise<void>((r) => server.close(() => r()));

  try {
    if (worker) await worker.close();
    await callQueue.close();
  } catch (e) {
    console.error('[shutdown] worker close', (e as Error).message);
  }

  try {
    await query(
      `UPDATE calls SET status='aborted', ended_at=now(), updated_at=now()
       WHERE status IN ('queued','in_progress')`,
    );
  } catch (e) {
    console.error('[shutdown] mark aborted', (e as Error).message);
  }

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
