import { Router } from 'express';
import { startAbTest, getAbResult, AbError, AB_MAX_ITERATIONS } from '../abTesting/runner.js';
import { MIN_RUNS_PER_SIDE } from '../abTesting/verdict.js';
import { requireWorkspace } from '../auth/workspace.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { rateLimited } from './calls.js';
import { takeIpUnits } from '../abuse.js';
import { query } from '../db/client.js';

export const abRouter = Router();
abRouter.use('/ab-tests', requireWorkspace);

abRouter.post('/ab-tests', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const { configA, configB, faultType, iterations, faultParams, sampleId } = req.body || {};
  if (!configA || !configB) return res.status(400).json({ error: 'bad_request', message: 'configA and configB are required.' });
  if (typeof sampleId !== 'string' || !sampleId) return res.status(400).json({ error: 'bad_request', message: 'Choose a demo call to run.' });
  if (faultType && !ALL_FAULTS.includes(faultType)) return res.status(400).json({ error: 'bad_fault_type', message: 'Unknown fault type.' });
  const runs = iterations === undefined ? 2 : Number(iterations);
  if (!Number.isInteger(runs) || runs < MIN_RUNS_PER_SIDE || runs > AB_MAX_ITERATIONS) return res.status(400).json({ error: 'bad_iterations', message: `Runs per side must be a whole number from ${MIN_RUNS_PER_SIDE} to ${AB_MAX_ITERATIONS}: fewer than ${MIN_RUNS_PER_SIDE} cannot give a verdict.` });
  try {
    const runId = await startAbTest({
      ownerId: ws, sampleId, configA, configB, faultType: (faultType ?? null) as FaultType | null, faultParams, iterations: runs,
      // allowances are used only after every check has passed, so a refused request costs nothing
      charge: () => (rateLimited('ab:' + ws, 15000) ? new AbError(429, 'rate_limited', 'Wait a few seconds between A/B runs.') : takeIpUnits(req.ip, 2 * runs) ? null : new AbError(429, 'ip_limit', 'Too many analyses from this network in the last hour. Try again later.')),
    });
    res.json({ runId });
  } catch (e) {
    if (e instanceof AbError) return res.status(e.status).json({ error: e.code, message: e.message });
    throw e;
  }
});

// The workspace's most recent comparisons with their verdicts, so the page has something to show before a new run is started.
abRouter.get('/ab-tests', async (_req, res) => {
  const ws: string = res.locals.workspaceId;
  const { rows } = await query('SELECT id FROM ab_runs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 8', [ws]);
  const runs = [];
  for (const r of rows as { id: string }[]) {
    const d = await getAbResult(r.id, ws);
    if (!d) continue;
    runs.push({
      id: d.run.id, created_at: d.run.created_at, sample_id: d.run.sample_id, fault_type: d.run.fault_type, iterations: d.run.iterations,
      config_a: d.run.config_a, config_b: d.run.config_b, status: d.status, winner: d.verdict?.winner ?? null, headline: d.verdict?.headline ?? null,
      a: { failed: d.summary.configA.failed, n: d.summary.configA.n, cost: d.summary.configA.avgCostUsd, latency: d.summary.configA.avgLatencyS },
      b: { failed: d.summary.configB.failed, n: d.summary.configB.n, cost: d.summary.configB.avgCostUsd, latency: d.summary.configB.avgLatencyS },
    });
  }
  res.json({ runs });
});

abRouter.get('/ab-tests/:id', async (req, res) => {
  const result = await getAbResult(req.params.id, res.locals.workspaceId);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json(result);
});
