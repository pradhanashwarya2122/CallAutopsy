import { Router } from 'express';
import { runHallucinationSuite, getHistory, getRun, getAggregate } from '../hallucinationSuite/runner.js';
import { requireWorkspace } from '../auth/workspace.js';
import { budgetGuard } from '../cost/budget.js';
import { rateLimited } from './calls.js';
import { ipAllows } from '../abuse.js';

export const hallucinationRouter = Router();
hallucinationRouter.use('/hallucination-suite', requireWorkspace);

hallucinationRouter.post('/hallucination-suite/run', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  // checks first, allowances last: a request that is refused must not use up the rate slot or the network's hourly units
  if (!(await budgetGuard()).ok) return res.status(402).json({ error: 'budget_cap', message: 'The demo has hit its spend cap for now.' });
  if (rateLimited('hsuite:' + ws, 20000)) return res.status(429).json({ error: 'rate_limited', message: 'Wait a few seconds between suite runs.' });
  if (!ipAllows(req, res, 5)) return;
  res.json(await runHallucinationSuite(ws));
});

hallucinationRouter.get('/hallucination-suite/history', async (_req, res) => {
  res.json({ history: await getHistory(res.locals.workspaceId) });
});

hallucinationRouter.get('/hallucination-suite/runs/:id', async (req, res) => {
  const run = await getRun(req.params.id, res.locals.workspaceId);
  if (!run) return res.status(404).json({ error: 'not_found' });
  res.json({ run });
});

hallucinationRouter.get('/hallucination-suite/aggregate', async (_req, res) => {
  res.json(await getAggregate(res.locals.workspaceId, 10));
});
