import { Router } from 'express';
import { query } from '../db/client.js';
import { checkSlaOnce } from '../sla/monitor.js';

export const slaRouter = Router();

slaRouter.get('/sla', async (_req, res) => {
  const { rows } = await query('SELECT * FROM sla_config WHERE id=1');
  const status = await checkSlaOnce();
  res.json({ config: rows[0], status });
});

slaRouter.put('/sla', async (req, res) => {
  const { maxFailureRatePct, windowMinutes } = req.body;
  await query(
    `INSERT INTO sla_config (id, max_failure_rate_pct, window_minutes)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET max_failure_rate_pct=$1, window_minutes=$2`,
    [maxFailureRatePct, windowMinutes],
  );
  res.json({ ok: true });
});

slaRouter.get('/sla/breaches', async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM sla_breaches ORDER BY breached_at DESC LIMIT 50',
  );
  res.json({ breaches: rows });
});

slaRouter.post('/sla/test-webhook', async (_req, res) => {
  const { notifyDiscord } = await import('../sla/discordWebhook.js');
  const ok = await notifyDiscord('Test alert from CallAutopsy — this is a manual SLA webhook test.');
  res.json({ ok, note: ok ? 'sent' : 'no DISCORD_WEBHOOK_URL configured or send failed' });
});
