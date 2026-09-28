import { Router } from 'express';
import { generateSuggestions, listSuggestions } from '../healing/suggestEngine.js';

export const healingRouter = Router();

healingRouter.get('/healing-suggestions', async (_req, res) => {
  const suggestions = await listSuggestions();
  res.json({ suggestions });
});

healingRouter.post('/healing-suggestions/generate', async (_req, res) => {
  try {
    const created = await generateSuggestions();
    res.json({ created });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
