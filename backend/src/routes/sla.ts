import { Router } from 'express';
import { requireAdmin } from '../auth/adminGuard.js';
import { query } from '../db/client.js';
import { requireWorkspace } from '../auth/workspace.js';
import { checkSla, getSlaConfig, setSlaConfig } from '../sla/monitor.js';

export const slaRouter = Router();

slaRouter.get('/sla', requireWorkspace, async (_req, res) => {
  const ws: string = res.locals.workspaceId;
  res.json({ config: await getSlaConfig(ws), status: await checkSla(ws) });
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
