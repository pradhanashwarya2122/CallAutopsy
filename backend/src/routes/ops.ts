import { Router } from 'express';
import { pool, query } from '../db/client.js';
import { redisConnection } from '../queue/connection.js';
import { callQueue } from '../queue/retryQueue.js';
import { dlq } from '../queue/dlq.js';
import { budgetGuard, getCaps, getSessionSpend, getTodaySpend } from '../cost/budget.js';
import { currentDriver } from '../storage/audioStore.js';

export const opsRouter = Router();

// Wrap any promise with a hard timeout so /health can never hang the pod.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

opsRouter.get('/health', async (_req, res) => {
  const checks: Record<string, any> = {};
  let ok = true;
  try {
    await withTimeout(pool.query('SELECT 1'), 3000, 'db');
    checks.db = 'ok';
  } catch (e) {
    ok = false;
    checks.db = (e as Error).message;
  }
  try {
    const pong = await withTimeout(Promise.resolve(redisConnection.ping()), 2000, 'redis');
    checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
  } catch (e) {
    ok = false;
    checks.redis = (e as Error).message;
  }
  checks.storage = currentDriver();
  res.status(ok ? 200 : 503).json({ ok, ts: new Date().toISOString(), checks });
});

opsRouter.get('/queue/stats', async (_req, res) => {
  try {
    const counts = await callQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    const dlqCount = await dlq.count();
    res.json({
      call_queue: counts,
      dlq: { size: dlqCount },
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

opsRouter.get('/queue/dlq', async (_req, res) => {
  try {
    const jobs = await dlq.getJobs(['completed', 'failed', 'waiting'], 0, 20);
    res.json({
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        failedReason: j.failedReason ?? j.data?.error,
        deadLetteredAt: j.data?.deadLetteredAt,
        attemptsMade: j.attemptsMade,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

opsRouter.get('/budget', async (_req, res) => {
  const caps = getCaps();
  const sessionSpent = getSessionSpend();
  const todaySpent = await getTodaySpend();
  const guard = await budgetGuard();
  res.json({
    sessionSpentUsd: sessionSpent,
    todaySpentUsd: todaySpent,
    ...caps,
    within: guard.ok,
    reason: guard.ok ? null : (guard as any).reason,
  });
});

// Small aggregate used by the header cost meter.
opsRouter.get('/cost/summary', async (_req, res) => {
  const { rows } = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN started_at >= date_trunc('day', now()) THEN total_cost_usd ELSE 0 END),0)::float AS today,
      COALESCE(SUM(CASE WHEN started_at >= date_trunc('month', now()) THEN total_cost_usd ELSE 0 END),0)::float AS month,
      COALESCE(SUM(total_cost_usd),0)::float AS all_time
    FROM calls
  `);
  res.json({
    sessionSpentUsd: getSessionSpend(),
    todaySpentUsd: Number(rows[0]?.today ?? 0),
    monthSpentUsd: Number(rows[0]?.month ?? 0),
    allTimeSpentUsd: Number(rows[0]?.all_time ?? 0),
    caps: getCaps(),
  });
});
