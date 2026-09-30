import { Router } from 'express';
import { generateSuggestions, listSuggestions, HEALING_THRESHOLD } from '../healing/suggestEngine.js';
import { requireWorkspace } from '../auth/workspace.js';
import { rateLimited } from './calls.js';
import { ipAllows } from '../abuse.js';
import { budgetGuard } from '../cost/budget.js';

export const healingRouter = Router();
healingRouter.use('/healing-suggestions', requireWorkspace);

healingRouter.get('/healing-suggestions', async (_req, res) => {
  res.json({ suggestions: await listSuggestions(res.locals.workspaceId), threshold: HEALING_THRESHOLD });
});

healingRouter.post('/healing-suggestions/generate', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  if (!(await budgetGuard()).ok) return res.status(402).json({ error: 'budget_cap', message: 'The demo has hit its spend cap for now.' });
  if (rateLimited('heal:' + ws, 15000)) return res.status(429).json({ error: 'rate_limited', message: 'Give it a few seconds before generating again.' });
  if (!ipAllows(req, res, 1)) return;
  const created = await generateSuggestions(ws);
  res.json({ created, threshold: HEALING_THRESHOLD });
});
