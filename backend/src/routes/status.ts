import { Router } from 'express';
import { query } from '../db/client.js';
import { checkSlaOnce } from '../sla/monitor.js';

export const statusRouter = Router();

statusRouter.get('/status', async (_req, res) => {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed,
      MAX(started_at) AS last_call
    FROM calls
    WHERE started_at > now() - interval '1 hour'
  `);
  const sla = await checkSlaOnce();
  const total = rows[0]?.total ?? 0;
  const failed = rows[0]?.failed ?? 0;
  const health = !total ? 'idle' : sla.breached ? 'degraded' : 'operational';
  res.json({
    health,
    lastCallAt: rows[0]?.last_call,
    windowMinutes: 60,
    totalCalls: total,
    failedCalls: failed,
    failureRatePct: total ? (failed / total) * 100 : 0,
    sla,
  });
});

statusRouter.get('/status/activity', async (_req, res) => {
  const { rows } = await query(`
    SELECT
      date_trunc('hour', started_at) AS bucket,
      COUNT(*)::int AS total,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed
    FROM calls
    WHERE started_at > now() - interval '24 hours'
    GROUP BY bucket ORDER BY bucket ASC
  `);
  res.json({ activity: rows });
});

statusRouter.get('/status/providers', async (_req, res) => {
  const { rows } = await query(`
    SELECT provider, stage,
      COUNT(*)::int AS total,
      SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END)::int AS errors,
      AVG(duration_ms)::float AS avg_ms
    FROM call_stages
    WHERE provider IS NOT NULL AND started_at > now() - interval '1 hour'
    GROUP BY provider, stage
    ORDER BY provider, stage
  `);
  res.json({ providers: rows });
});
