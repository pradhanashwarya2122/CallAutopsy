import { Router } from 'express';
import { startAbTest, getAbResult, AbError, AB_MAX_ITERATIONS } from '../abTesting/runner.js';
import { MIN_RUNS_PER_SIDE } from '../abTesting/verdict.js';
import { requireWorkspace } from '../auth/workspace.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { rateLimited } from './calls.js';
import { takeIpUnits } from '../abuse.js';

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

abRouter.get('/ab-tests/:id', async (req, res) => {
  const result = await getAbResult(req.params.id, res.locals.workspaceId);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json(result);
});
