import { Router } from 'express';
import { requireAdmin } from '../auth/adminGuard.js';
import { pool } from '../db/client.js';
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

// /health = LIVENESS. Always returns 200 as long as the Node process is up
// and responding to HTTP. This is what Railway's platform healthcheck hits —
// if it returns non-200, Railway shuts the container down. We still report
// the deep checks in the JSON body for humans / debugging.
//
// /health/ready = READINESS. Returns 503 if DB or Redis are down. Use this
// for load-balancer readiness or CI smoke tests, NOT for the platform
// healthcheck.
opsRouter.get('/health', async (_req, res) => {
  const checks: Record<string, any> = { storage: currentDriver() };
  try {
    await withTimeout(pool.query('SELECT 1'), 3000, 'db');
    checks.db = 'ok';
  } catch (e) {
    checks.db = (e as Error).message;
  }
  try {
    const pong = await withTimeout(Promise.resolve(redisConnection.ping()), 2000, 'redis');
    checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
  } catch (e) {
    checks.redis = (e as Error).message;
  }
  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    checks,
    ready: checks.db === 'ok' && checks.redis === 'ok',
  });
});

opsRouter.get('/health/ready', async (_req, res) => {
  const checks: Record<string, any> = { storage: currentDriver() };
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

opsRouter.get('/queue/dlq', requireAdmin, async (_req, res) => {
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

opsRouter.get('/budget', requireAdmin, async (_req, res) => {
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
