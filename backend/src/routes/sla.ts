import { Router } from 'express';
import { requireAdmin } from '../auth/adminGuard.js';
import { query } from '../db/client.js';
import { requireWorkspace } from '../auth/workspace.js';
import { SLA as SLA_LIMITS } from '../pipeline/orchestrator.js';
import { checkSla, getSlaConfig, setSlaConfig } from '../sla/monitor.js';

export const slaRouter = Router();

slaRouter.get('/sla', requireWorkspace, async (_req, res) => {
  const ws: string = res.locals.workspaceId;
  res.json({ config: await getSlaConfig(ws), status: await checkSla(ws) });
});

// Per-stage latency of the workspace's own finished calls (failures injected on purpose are left out: they would distort it) against the stage limits, so a slow stage is visible before it breaches.
slaRouter.get('/sla/stages', requireWorkspace, async (_req, res) => {
  const limits: Record<string, number> = { stt: SLA_LIMITS.stt, llm: SLA_LIMITS.llm, tts: SLA_LIMITS.tts };
  const { rows } = await query(
    `SELECT s.stage, COUNT(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_ms)::float AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY s.duration_ms)::float AS p95,
            MAX(s.duration_ms)::int AS max_ms,
            COUNT(*) FILTER (WHERE s.status = 'timeout')::int AS timeouts,
            COUNT(*) FILTER (WHERE s.status = 'error')::int AS errors
     FROM call_stages s JOIN calls c ON c.id = s.call_id
     WHERE c.owner_id = $1 AND c.status IN ('completed','failed') AND c.injected_fault IS NULL AND s.stage IN ('stt','llm','tts') AND s.duration_ms IS NOT NULL
     GROUP BY s.stage`,
    [res.locals.workspaceId],
  );
  const by = new Map((rows as any[]).map((r) => [r.stage, r]));
  res.json({
    stages: (['stt', 'llm', 'tts'] as const).map((stage) => {
      const r = by.get(stage);
      return { stage, limitMs: limits[stage], n: r?.n ?? 0, p50Ms: r?.p50 ?? null, p95Ms: r?.p95 ?? null, maxMs: r?.max_ms ?? null, timeouts: r?.timeouts ?? 0, errors: r?.errors ?? 0 };
    }),
  });
});

slaRouter.put('/sla', requireWorkspace, async (req, res) => {
  const pct = Number(req.body?.maxFailureRatePct);
  const mins = Math.round(Number(req.body?.windowMinutes));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !Number.isFinite(mins) || mins < 1 || mins > 1440) {
    return res.status(400).json({ error: 'bad_sla', message: 'Failure rate must be 0-100% and the window 1-1440 minutes.' });
  }
  await setSlaConfig(res.locals.workspaceId, pct, mins);
  res.json({ ok: true });
});

slaRouter.get('/sla/breaches', requireWorkspace, async (_req, res) => {
  const { rows } = await query(
    'SELECT id, breached_at, observed_failure_rate_pct, notified FROM sla_breaches WHERE owner_id=$1 ORDER BY breached_at DESC LIMIT 50',
    [res.locals.workspaceId],
  );
  res.json({ breaches: rows });
});

// Posts to the operator's Discord channel, so it is only enabled when an admin token is configured and supplied.
slaRouter.post('/sla/test-webhook', requireAdmin, async (_req, res) => {
  const { notifyDiscord } = await import('../sla/discordWebhook.js');
  const ok = await notifyDiscord('Test alert from CallAutopsy: manual SLA webhook test.');
  res.json({ ok, note: ok ? 'sent' : 'no DISCORD_WEBHOOK_URL configured or send failed' });
});
