import { Router } from 'express';
import { streamIncidentReport } from '../pdf/exportReport.js';
import { ownsCall, workspaceId } from '../auth/workspace.js';

export const exportRouter = Router();

exportRouter.get('/calls/:id/export.pdf', async (req, res) => {
  if (!(await ownsCall(req.params.id, workspaceId(req)))) return res.status(404).json({ error: 'not_found' });
  await streamIncidentReport(req.params.id, res);
});
