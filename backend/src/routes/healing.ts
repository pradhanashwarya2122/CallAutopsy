import { Router } from 'express';
import { generateSuggestions, listSuggestions, HEALING_THRESHOLD } from '../healing/suggestEngine.js';
import { requireWorkspace } from '../auth/workspace.js';
import { query } from '../db/client.js';
import { rateLimited } from './calls.js';
import { ipAllows } from '../abuse.js';
import { budgetGuard } from '../cost/budget.js';

export const healingRouter = Router();
healingRouter.use('/healing-suggestions', requireWorkspace);

healingRouter.get('/healing-suggestions', async (_req, res) => {
  const ws: string = res.locals.workspaceId;
  // How close each failure type is to triggering a suggestion (same window and cause grouping the generator uses).
  const { rows } = await query(
    `SELECT predicted_category AS fault_type, COUNT(*)::int AS n FROM calls
     WHERE owner_id=$1 AND status='failed' AND predicted_category IS NOT NULL AND started_at > now() - interval '24 hours'
     GROUP BY predicted_category ORDER BY COUNT(*) DESC, predicted_category`, [ws]);
  res.json({ suggestions: await listSuggestions(ws), threshold: HEALING_THRESHOLD, recent: rows });
});

healingRouter.post('/healing-suggestions/generate', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  if (!(await budgetGuard()).ok) return res.status(402).json({ error: 'budget_cap', message: 'The demo has hit its spend cap for now.' });
  if (rateLimited('heal:' + ws, 15000)) return res.status(429).json({ error: 'rate_limited', message: 'Give it a few seconds before generating again.' });
  if (!ipAllows(req, res, 1)) return;
  const created = await generateSuggestions(ws);
  res.json({ created, threshold: HEALING_THRESHOLD });
});
