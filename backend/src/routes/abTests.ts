import { Router } from 'express';
import { runAbTest, getAbResult } from '../abTesting/runner.js';

export const abRouter = Router();

abRouter.post('/ab-tests', async (req, res) => {
  const { configA, configB, faultType, iterations, faultParams } = req.body || {};
  if (!configA || !configB) return res.status(400).json({ error: 'configA and configB required' });
  try {
    const runId = await runAbTest(configA, configB, faultType ?? null, iterations ?? 3, faultParams);
    res.json({ runId });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

abRouter.get('/ab-tests/:id', async (req, res) => {
  const result = await getAbResult(req.params.id);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json(result);
});
