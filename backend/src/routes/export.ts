import { Router } from 'express';
import { streamIncidentReport } from '../pdf/exportReport.js';

export const exportRouter = Router();

exportRouter.get('/calls/:id/export.pdf', async (req, res) => {
  await streamIncidentReport(req.params.id, res);
});
