import { Router } from 'express';
import { query } from '../db/client.js';

export const blastRadiusRouter = Router();

blastRadiusRouter.post('/blast-radius', async (req, res) => {
  const callsPerDay = Number(req.body?.callsPerDay);
  if (!callsPerDay || callsPerDay <= 0) {
    return res.status(400).json({ error: 'callsPerDay required' });
  }

  const { rows } = await query(`
    SELECT injected_fault,
           COUNT(*)::int AS n,
           AVG(total_cost_usd)::float AS avg_cost_usd,
           MIN(total_cost_usd)::float AS min_cost_usd,
           MAX(total_cost_usd)::float AS max_cost_usd
    FROM calls
    WHERE injected_fault IS NOT NULL AND total_cost_usd IS NOT NULL
    GROUP BY injected_fault
  `);
  const totalCalls = rows.reduce((s: number, r: any) => s + r.n, 0);
  const projection = rows.map((r: any) => {
    const failureRate = totalCalls ? r.n / totalCalls : 0;
    const monthlyOccurrences = callsPerDay * 30 * failureRate;
    return {
      faultType: r.injected_fault,
      observedFailureRate: failureRate,
      avgCostPerCallUsd: r.avg_cost_usd,
      minCostUsd: r.min_cost_usd,
      maxCostUsd: r.max_cost_usd,
      projectedMonthlyOccurrences: monthlyOccurrences,
      projectedMonthlyCostUsd: monthlyOccurrences * (r.avg_cost_usd ?? 0),
    };
  });

  const { rows: stageBreakdown } = await query(`
    SELECT stage, provider,
           COUNT(*)::int AS n,
           AVG(cost_usd)::float AS avg_cost,
           SUM(cost_usd)::float AS sum_cost
    FROM call_stages
    WHERE cost_usd IS NOT NULL
    GROUP BY stage, provider
    ORDER BY stage, provider
  `);

  const stages = stageBreakdown.map((r: any) => ({
    ...r,
    projectedMonthly: callsPerDay * 30 * (r.avg_cost ?? 0),
  }));

  const totalMonthly = projection.reduce((s: number, p: any) => s + p.projectedMonthlyCostUsd, 0);

  res.json({ callsPerDay, sampleSize: totalCalls, projection, stages, totalMonthlyCostUsd: totalMonthly });
});
