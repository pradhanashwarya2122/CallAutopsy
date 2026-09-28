import { query } from '../db/client.js';
import { notifyDiscord } from './discordWebhook.js';
import { broadcast } from '../websocket/broadcaster.js';

let running = false;

export async function checkSlaOnce(): Promise<{ breached: boolean; observed: number; threshold: number }> {
  const { rows: cfgRows } = await query('SELECT * FROM sla_config WHERE id=1');
  const cfg = cfgRows[0] ?? { max_failure_rate_pct: 5, window_minutes: 60 };

  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed
     FROM calls
     WHERE started_at > now() - ($1 || ' minutes')::interval`,
    [cfg.window_minutes],
  );
  const total = rows[0]?.total ?? 0;
  const failed = rows[0]?.failed ?? 0;
  const observedPct = total ? (failed / total) * 100 : 0;
  const breached = total >= 5 && observedPct > Number(cfg.max_failure_rate_pct);

  if (breached) {
    const { rows: recent } = await query(
      `SELECT id FROM sla_breaches WHERE breached_at > now() - interval '15 minutes' LIMIT 1`,
    );
    if (!recent.length) {
      const { rows: ins } = await query(
        'INSERT INTO sla_breaches (observed_failure_rate_pct, notified) VALUES ($1, $2) RETURNING id',
        [observedPct, false],
      );
      const breachId = ins[0]?.id;
      broadcast({ type: 'sla.breach', observed: observedPct, threshold: cfg.max_failure_rate_pct });
      const notified = await notifyDiscord(
        `SLA breach: failure rate ${observedPct.toFixed(1)}% > ${cfg.max_failure_rate_pct}% in last ${cfg.window_minutes}m`,
      );
      if (notified && breachId) {
        await query('UPDATE sla_breaches SET notified=true WHERE id=$1', [breachId]);
      }
    }
  }

  return { breached, observed: observedPct, threshold: Number(cfg.max_failure_rate_pct) };
}

export function startSlaMonitor(intervalMs = 60_000) {
  if (running) return;
  running = true;
  const tick = async () => {
    try {
      await checkSlaOnce();
    } catch (e) {
      console.error('[sla]', (e as Error).message);
    }
    setTimeout(tick, intervalMs);
  };
  tick();
}
