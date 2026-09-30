// Per-workspace outage flag used by the STT wrapper to force-fail Deepgram calls.
// It only affects calls owned by the workspace that switched it on, so one visitor
// "knocking Deepgram offline" cannot degrade anyone else's calls.

interface OutageState {
  enabled: boolean;
  expiresAt: number | null;
}

const states = new Map<string, OutageState>();
const MAX_SECONDS = 300;

export function enableDeepgramOutage(ownerId: string, durationSec: number) {
  if (states.size > 1000) { const now = Date.now(); for (const [k, v] of states) if (!v.expiresAt || v.expiresAt < now) states.delete(k); } // bounded memory
  states.set(ownerId, {
    enabled: true,
    expiresAt: Date.now() + Math.min(MAX_SECONDS, Math.max(1, durationSec)) * 1000,
  });
}

export function disableDeepgramOutage(ownerId: string) {
  states.delete(ownerId);
}

export function isDeepgramDown(ownerId?: string): boolean {
  if (!ownerId) return false;
  const state = states.get(ownerId);
  if (!state?.enabled) return false;
  if (state.expiresAt && Date.now() > state.expiresAt) {
    states.delete(ownerId);
    return false;
  }
  return true;
}

export function getOutageState(ownerId: string) {
  const active = isDeepgramDown(ownerId);
  const state = states.get(ownerId);
  return {
    enabled: active,
    expiresAt: active ? state?.expiresAt ?? null : null,
    secondsRemaining: active && state?.expiresAt ? Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000)) : 0,
  };
}
