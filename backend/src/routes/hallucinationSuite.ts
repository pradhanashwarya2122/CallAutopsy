import { Router } from 'express';
import { runHallucinationSuite, getHistory, getRun, getAggregate } from '../hallucinationSuite/runner.js';

export const hallucinationRouter = Router();

hallucinationRouter.post('/hallucination-suite/run', async (_req, res) => {
  try {
    const result = await runHallucinationSuite();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

hallucinationRouter.get('/hallucination-suite/history', async (_req, res) => {
  const history = await getHistory();
  res.json({ history });
});

hallucinationRouter.get('/hallucination-suite/runs/:id', async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'not_found' });
  res.json({ run });
});

hallucinationRouter.get('/hallucination-suite/aggregate', async (_req, res) => {
  res.json(await getAggregate(10));
});
