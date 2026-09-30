import { query } from '../db/client.js';
import { broadcast } from '../websocket/broadcaster.js';

const DEFAULTS = { max_failure_rate_pct: 5, window_minutes: 60 };

export async function getSlaConfig(ownerId: string) {
  const { rows } = await query('SELECT max_failure_rate_pct, window_minutes FROM workspace_sla WHERE owner_id=$1', [ownerId]);
  const r = rows[0];
  return { max_failure_rate_pct: Number(r?.max_failure_rate_pct ?? DEFAULTS.max_failure_rate_pct), window_minutes: Number(r?.window_minutes ?? DEFAULTS.window_minutes) };
}

export async function setSlaConfig(ownerId: string, maxFailureRatePct: number, windowMinutes: number) {
  await query(
    `INSERT INTO workspace_sla (owner_id, max_failure_rate_pct, window_minutes) VALUES ($1,$2,$3)
     ON CONFLICT (owner_id) DO UPDATE SET max_failure_rate_pct=$2, window_minutes=$3`,
    [ownerId, maxFailureRatePct, windowMinutes],
  );
}

// Failure rate of this workspace's calls over its configured window. A breach needs at least 5 finished calls.
export async function checkSla(ownerId: string): Promise<{ breached: boolean; observed: number; threshold: number; total: number; failed: number; windowMinutes: number }> {
  const cfg = await getSlaConfig(ownerId);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='failed')::int AS failed
     FROM calls WHERE owner_id=$1 AND status IN ('completed','failed') AND started_at > now() - ($2::int * interval '1 minute')`,
    [ownerId, cfg.window_minutes],
  );
  const total = rows[0]?.total ?? 0;
  const failed = rows[0]?.failed ?? 0;
  const observed = total ? (failed / total) * 100 : 0;
  const breached = total >= 5 && observed > cfg.max_failure_rate_pct;

  if (breached) {
    const { rows: recent } = await query(
      `SELECT id FROM sla_breaches WHERE owner_id=$1 AND breached_at > now() - interval '15 minutes' LIMIT 1`,
      [ownerId],
    );
    if (!recent.length) {
      await query('INSERT INTO sla_breaches (observed_failure_rate_pct, notified, owner_id) VALUES ($1, false, $2)', [observed, ownerId]);
      broadcast({ type: 'sla.breach', observed, threshold: cfg.max_failure_rate_pct }, ownerId);
    }
  }
  return { breached, observed, threshold: cfg.max_failure_rate_pct, total, failed, windowMinutes: cfg.window_minutes };
}
