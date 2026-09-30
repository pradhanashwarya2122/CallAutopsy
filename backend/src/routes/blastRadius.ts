import { Router } from 'express';
import { query } from '../db/client.js';
import { requireWorkspace } from '../auth/workspace.js';

export const blastRadiusRouter = Router();

// Measured on 19 real demo calls through the live pipeline (backend/bench/results/regression-live.json, 30 Sep 2026). Used only
// until a workspace has finished calls of its own, and labelled as a reference in the response.
export const REFERENCE_COST = { n: 19, avgCallUsd: 0.00408, minCallUsd: 0.00151, maxCallUsd: 0.00674 };

const num = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

// What a failure rate would cost at a given daily volume. The failure rate is the caller's assumption: a workspace's own calls are
// mostly demo calls with failures injected on purpose, so their failure share says nothing about real traffic. What IS measured
// from the workspace is what a call costs, what a failed call costs, and where the money goes.
blastRadiusRouter.post('/blast-radius', requireWorkspace, async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const callsPerDay = Number(req.body?.callsPerDay);
  const failureRatePct = req.body?.failureRatePct === undefined ? 5 : Number(req.body.failureRatePct);
  if (!Number.isFinite(callsPerDay) || callsPerDay <= 0 || callsPerDay > 10_000_000) {
    return res.status(400).json({ error: 'bad_volume', message: 'Enter a daily call volume between 1 and 10,000,000.' });
  }
  if (!Number.isFinite(failureRatePct) || failureRatePct < 0 || failureRatePct > 100) {
    return res.status(400).json({ error: 'bad_rate', message: 'Enter a failure rate between 0 and 100 percent.' });
  }

  const { rows: [t] } = await query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE status='failed')::int AS failed,
            COUNT(*) FILTER (WHERE injected_fault IS NOT NULL)::int AS injected,
            AVG(total_cost_usd) FILTER (WHERE status='completed' AND injected_fault IS NULL AND total_cost_usd IS NOT NULL) AS avg_ok,
            AVG(total_cost_usd) FILTER (WHERE status='failed' AND total_cost_usd IS NOT NULL) AS avg_failed
     FROM calls WHERE owner_id=$1 AND status IN ('completed','failed')`, [ws]);
  const sampleSize: number = t?.n ?? 0;

  const { rows: byFaultRows } = await query(
    `SELECT predicted_category AS fault_type, COUNT(*)::int AS n, AVG(total_cost_usd)::float AS avg_cost_usd,
            MIN(total_cost_usd)::float AS min_cost_usd, MAX(total_cost_usd)::float AS max_cost_usd
     FROM calls WHERE owner_id=$1 AND status='failed' AND total_cost_usd IS NOT NULL AND predicted_category IS NOT NULL
     GROUP BY predicted_category ORDER BY COUNT(*) DESC, predicted_category`, [ws]);

  const { rows: stageRows } = await query(
    `SELECT s.stage, s.provider, COUNT(*)::int AS n, AVG(s.cost_usd)::float AS avg_cost
     FROM call_stages s JOIN calls c ON c.id = s.call_id
     WHERE c.owner_id=$1 AND c.injected_fault IS NULL AND s.cost_usd IS NOT NULL AND c.status IN ('completed','failed') AND s.provider IS NOT NULL
     GROUP BY s.stage, s.provider ORDER BY s.stage, s.provider`, [ws]);

  // What a call costs is measured on healthy calls only: a call with a failure injected stops early and would drag the average down.
  const measured = num(t.avg_ok) !== null;
  const avgCallUsd = measured ? num(t.avg_ok)! : REFERENCE_COST.avgCallUsd;
  const avgHealthyUsd = avgCallUsd;
  // A failed call still spent what its finished stages cost; with no failed calls of its own the workspace falls back to the
  // average call, which is what a call that failed late would have spent.
  const avgFailedUsd = num(t.avg_failed) ?? avgCallUsd;

  const monthlyCalls = callsPerDay * 30;
  const monthlyFailures = monthlyCalls * (failureRatePct / 100);
  const wastedUsd = monthlyFailures * avgFailedUsd;
  const retryUsd = monthlyFailures * avgHealthyUsd;
  const perCallStages = stageRows.map((r: any) => ({ stage: r.stage, provider: r.provider, n: r.n, avgCostUsd: r.avg_cost as number }));
  const stageTotal = perCallStages.reduce((s, r) => s + (r.avgCostUsd ?? 0), 0);

  res.json({
    callsPerDay,
    failureRatePct,
    basis: measured ? 'your_calls' : 'reference',
    sampleSize,
    failedInSample: t?.failed ?? 0,
    injectedInSample: t?.injected ?? 0,
    reference: measured ? null : REFERENCE_COST,
    avgCallUsd,
    avgFailedCallUsd: avgFailedUsd,
    monthlyCalls,
    monthlyFailures,
    monthlySpendUsd: monthlyCalls * avgCallUsd,
    wastedOnFailuresUsd: wastedUsd,
    retryCostUsd: retryUsd,
    monthlyImpactUsd: wastedUsd + retryUsd,
    byFault: byFaultRows.map((r: any) => ({ faultType: r.fault_type, n: r.n, avgCostUsd: r.avg_cost_usd, minCostUsd: r.min_cost_usd, maxCostUsd: r.max_cost_usd })),
    stages: perCallStages.map((r) => ({ ...r, share: stageTotal ? (r.avgCostUsd ?? 0) / stageTotal : 0, monthlyUsd: monthlyCalls * (r.avgCostUsd ?? 0) })),
  });
});
