import { Router } from 'express';
import { enableDeepgramOutage, disableDeepgramOutage, getOutageState } from '../admin/outageFlag.js';
import { setChaos, getChaos } from '../chaos/scheduler.js';
import { requireWorkspace } from '../auth/workspace.js';
import { ipAllows } from '../abuse.js';

// Both controls only affect the calling workspace's own calls.
export const adminRouter = Router();
adminRouter.use(['/admin', '/chaos'], requireWorkspace);

adminRouter.get('/admin/deepgram-outage', (_req, res) => {
  res.json(getOutageState(res.locals.workspaceId));
});

adminRouter.post('/admin/deepgram-outage', (req, res) => {
  const { enabled, durationSec } = req.body ?? {};
  if (enabled) enableDeepgramOutage(res.locals.workspaceId, Number(durationSec) || 60);
  else disableDeepgramOutage(res.locals.workspaceId);
  res.json(getOutageState(res.locals.workspaceId));
});

adminRouter.get('/chaos', (_req, res) => {
  res.json(getChaos(res.locals.workspaceId));
});

adminRouter.post('/chaos', (req, res) => {
  const { enabled, callsPerMinute, faultMix, includeCleanRuns } = req.body ?? {};
  if (enabled === true && !getChaos(res.locals.workspaceId).enabled && !ipAllows(req, res, 1)) return; // switching it on starts paid calls (each one is charged again as it runs)
  const patch: any = {};
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof callsPerMinute === 'number') patch.callsPerMinute = callsPerMinute;
  if (Array.isArray(faultMix)) patch.faultMix = faultMix;
  if (typeof includeCleanRuns === 'boolean') patch.includeCleanRuns = includeCleanRuns;
  res.json(setChaos(res.locals.workspaceId, patch, req.ip));
});
