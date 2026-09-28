import fs from 'node:fs/promises';
import path from 'node:path';
import { runCall } from '../pipeline/orchestrator.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { isDeepgramDown } from '../admin/outageFlag.js';
import { budgetGuard } from '../cost/budget.js';

interface ChaosConfig {
  enabled: boolean;
  callsPerMinute: number;
  faultMix: FaultType[];
  includeCleanRuns: boolean;
}

let state: ChaosConfig = {
  enabled: false,
  callsPerMinute: 6,
  faultMix: [...ALL_FAULTS],
  includeCleanRuns: true,
};
let timer: NodeJS.Timeout | null = null;

async function pickSampleAudio(): Promise<{ buf: Buffer; ext: string; id: string } | null> {
  const dir = path.resolve(process.cwd(), 'samples');
  try {
    const files = (await fs.readdir(dir)).filter((f) => /\.(wav|mp3|ogg)$/i.test(f));
    if (!files.length) return null;
    const pick = files[Math.floor(Math.random() * files.length)];
    return {
      buf: await fs.readFile(path.join(dir, pick)),
      ext: pick.split('.').pop() ?? 'bin',
      id: pick,
    };
  } catch {
    return null;
  }
}

async function tick() {
  if (!state.enabled) return;
  // Pause during Deepgram outage — otherwise every chaos tick eats Whisper cost
  // for a fault that the operator is already demonstrating.
  if (isDeepgramDown()) return;
  // Respect budget caps so chaos can't blow past them silently.
  const b = await budgetGuard();
  if (!b.ok) return;
  const sample = await pickSampleAudio();
  if (!sample) return;
  const pool = state.includeCleanRuns ? [null, ...state.faultMix] : state.faultMix;
  const fault = pool[Math.floor(Math.random() * pool.length)] as FaultType | null;
  runCall({
    audio: sample.buf,
    inputSource: 'sample',
    sampleId: sample.id,
    faultType: fault,
    audioExt: sample.ext,
  }).catch((e) => console.error('[chaos]', (e as Error).message));
}

function reschedule() {
  if (timer) clearInterval(timer);
  timer = null;
  if (!state.enabled) return;
  const intervalMs = Math.max(2000, Math.round(60_000 / Math.max(1, state.callsPerMinute)));
  timer = setInterval(tick, intervalMs);
}

export function setChaos(patch: Partial<ChaosConfig>) {
  state = { ...state, ...patch };
  if (patch.faultMix && !patch.faultMix.length) state.faultMix = [...ALL_FAULTS];
  reschedule();
  return state;
}

export function getChaos() {
  return state;
}
