import { Router } from 'express';
import { startAbTest, getAbResult, AbError } from '../abTesting/runner.js';
import { requireWorkspace } from '../auth/workspace.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { rateLimited } from './calls.js';

export const abRouter = Router();
abRouter.use('/ab-tests', requireWorkspace);

abRouter.post('/ab-tests', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const { configA, configB, faultType, iterations, faultParams, sampleId } = req.body || {};
  if (!configA || !configB) return res.status(400).json({ error: 'bad_request', message: 'configA and configB are required.' });
  if (typeof sampleId !== 'string' || !sampleId) return res.status(400).json({ error: 'bad_request', message: 'Choose a demo call to run.' });
  if (faultType && !ALL_FAULTS.includes(faultType)) return res.status(400).json({ error: 'bad_fault_type', message: 'Unknown fault type.' });
  if (rateLimited('ab:' + ws, 15000)) return res.status(429).json({ error: 'rate_limited', message: 'Wait a few seconds between A/B runs.' });
  try {
    const runId = await startAbTest({ ownerId: ws, sampleId, configA, configB, faultType: (faultType ?? null) as FaultType | null, faultParams, iterations: Number(iterations) || 1 });
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
