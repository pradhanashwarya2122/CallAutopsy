import { runCall } from '../pipeline/orchestrator.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { isDeepgramDown } from '../admin/outageFlag.js';
import { budgetGuard } from '../cost/budget.js';
import { dailyUsage, DAILY_CALL_LIMIT } from '../limits.js';
import { listSampleIds, readSample } from '../sampleLibrary.js';

interface ChaosConfig {
  enabled: boolean;
  callsPerMinute: number;
  faultMix: FaultType[];
  includeCleanRuns: boolean;
  stoppedReason: string | null;
}

const MAX_RATE = 12;
const MAX_RUN_MS = 15 * 60_000;
const workspaces = new Map<string, { cfg: ChaosConfig; timer: NodeJS.Timeout | null; startedAt: number }>();

const fresh = (): ChaosConfig => ({ enabled: false, callsPerMinute: 6, faultMix: [...ALL_FAULTS], includeCleanRuns: true, stoppedReason: null });

async function tick(ownerId: string) {
  const w = workspaces.get(ownerId);
  if (!w || !w.cfg.enabled) return;
  const stop = (reason: string) => { w.cfg.enabled = false; w.cfg.stoppedReason = reason; reschedule(ownerId); };
  if (Date.now() - w.startedAt > MAX_RUN_MS) return stop('Stopped automatically after 15 minutes.');
  // Chaos calls are the workspace's own calls, so they use up its daily quota and stop when it is gone.
  if ((await dailyUsage(ownerId)) >= DAILY_CALL_LIMIT) return stop(`Daily limit of ${DAILY_CALL_LIMIT} analyses reached.`);
  if (isDeepgramDown(ownerId)) return;
  if (!(await budgetGuard()).ok) return stop('The demo hit its spend cap.');
  const ids = await listSampleIds();
  if (!ids.length) return stop('No demo calls on this server.');
  const id = ids[Math.floor(Math.random() * ids.length)];
  const sample = await readSample(id);
  if (!sample) return;
  const pool = w.cfg.includeCleanRuns ? [null, ...w.cfg.faultMix] : w.cfg.faultMix;
  const fault = pool[Math.floor(Math.random() * pool.length)] as FaultType | null;
  runCall({ audio: sample.buf, inputSource: 'sample', sampleId: id, faultType: fault, audioExt: sample.ext, ownerId })
    .catch((e) => console.error('[chaos]', (e as Error).message));
}

function reschedule(ownerId: string) {
  const w = workspaces.get(ownerId);
  if (!w) return;
  if (w.timer) clearInterval(w.timer);
  w.timer = null;
  if (!w.cfg.enabled) return;
  w.timer = setInterval(() => tick(ownerId), Math.max(4000, Math.round(60_000 / Math.max(1, w.cfg.callsPerMinute))));
}

export function setChaos(ownerId: string, patch: Partial<ChaosConfig>) {
  const w = workspaces.get(ownerId) ?? { cfg: fresh(), timer: null, startedAt: Date.now() };
  workspaces.set(ownerId, w);
  const wasOn = w.cfg.enabled;
  w.cfg = { ...w.cfg, ...patch };
  w.cfg.callsPerMinute = Math.min(MAX_RATE, Math.max(1, Math.round(w.cfg.callsPerMinute)));
  if (!w.cfg.faultMix.length) w.cfg.faultMix = [...ALL_FAULTS];
  if (w.cfg.enabled && !wasOn) { w.startedAt = Date.now(); w.cfg.stoppedReason = null; }
  reschedule(ownerId);
  return w.cfg;
}

export function getChaos(ownerId: string) {
  return workspaces.get(ownerId)?.cfg ?? fresh();
}
