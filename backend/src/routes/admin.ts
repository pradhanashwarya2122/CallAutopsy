import { Router } from 'express';
import { enableDeepgramOutage, disableDeepgramOutage, getOutageState } from '../admin/outageFlag.js';
import { setChaos, getChaos } from '../chaos/scheduler.js';

export const adminRouter = Router();

adminRouter.get('/admin/deepgram-outage', (_req, res) => {
  res.json(getOutageState());
});

adminRouter.post('/admin/deepgram-outage', (req, res) => {
  const { enabled, durationSec } = req.body ?? {};
  if (enabled) {
    enableDeepgramOutage(Number(durationSec) || 60);
  } else {
    disableDeepgramOutage();
  }
  res.json(getOutageState());
});

adminRouter.get('/chaos', (_req, res) => {
  res.json(getChaos());
});

adminRouter.post('/chaos', (req, res) => {
  const { enabled, callsPerMinute, faultMix, includeCleanRuns } = req.body ?? {};
  const patch: any = {};
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof callsPerMinute === 'number') patch.callsPerMinute = callsPerMinute;
  if (Array.isArray(faultMix)) patch.faultMix = faultMix;
  if (typeof includeCleanRuns === 'boolean') patch.includeCleanRuns = includeCleanRuns;
  res.json(setChaos(patch));
});
