import { Router } from 'express';
import { query } from '../db/client.js';
import { requireWorkspace } from '../auth/workspace.js';

export const blastRadiusRouter = Router();

// Projects this workspace's own observed outcome mix to a hypothetical daily call volume.
blastRadiusRouter.post('/blast-radius', requireWorkspace, async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const callsPerDay = Number(req.body?.callsPerDay);
  if (!Number.isFinite(callsPerDay) || callsPerDay <= 0 || callsPerDay > 10_000_000) {
    return res.status(400).json({ error: 'bad_volume', message: 'Enter a daily call volume between 1 and 10,000,000.' });
  }

  const { rows: totals } = await query(
    `SELECT COUNT(*)::int AS n FROM calls WHERE owner_id=$1 AND status IN ('completed','failed')`, [ws]);
  const sampleSize = totals[0]?.n ?? 0;

  const { rows } = await query(
    `SELECT predicted_category AS fault_type, COUNT(*)::int AS n,
            AVG(total_cost_usd)::float AS avg_cost_usd, MIN(total_cost_usd)::float AS min_cost_usd, MAX(total_cost_usd)::float AS max_cost_usd
     FROM calls WHERE owner_id=$1 AND status='failed' AND total_cost_usd IS NOT NULL GROUP BY predicted_category`,
    [ws],
  );
  const projection = rows.map((r: any) => {
    const rate = sampleSize ? r.n / sampleSize : 0;
    const monthly = callsPerDay * 30 * rate;
    return {
      faultType: r.fault_type,
      observedFailureRate: rate,
      avgCostPerCallUsd: r.avg_cost_usd,
      minCostUsd: r.min_cost_usd,
      maxCostUsd: r.max_cost_usd,
      projectedMonthlyOccurrences: monthly,
      projectedMonthlyCostUsd: monthly * (r.avg_cost_usd ?? 0),
    };
  });

  const { rows: stageRows } = await query(
    `SELECT s.stage, s.provider, COUNT(*)::int AS n, AVG(s.cost_usd)::float AS avg_cost
     FROM call_stages s JOIN calls c ON c.id = s.call_id
     WHERE c.owner_id=$1 AND s.cost_usd IS NOT NULL GROUP BY s.stage, s.provider ORDER BY s.stage, s.provider`,
    [ws],
  );
  const stages = stageRows.map((r: any) => ({ ...r, projectedMonthly: callsPerDay * 30 * (r.avg_cost ?? 0) }));
  const { rows: overall } = await query(
    `SELECT AVG(total_cost_usd)::float AS avg FROM calls WHERE owner_id=$1 AND status IN ('completed','failed') AND total_cost_usd IS NOT NULL`, [ws]);

  res.json({
    callsPerDay,
    sampleSize,
    projection,
    stages,
    totalMonthlyCostUsd: callsPerDay * 30 * (overall[0]?.avg ?? 0),
    failedMonthlyCostUsd: projection.reduce((s: number, p: any) => s + p.projectedMonthlyCostUsd, 0),
  });
});
