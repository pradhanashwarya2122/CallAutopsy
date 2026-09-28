// In-memory outage flag used by the STT wrapper to force-fail Deepgram calls.
// This lets the failover-to-Whisper story be demonstrable live.

interface OutageState {
  enabled: boolean;
  expiresAt: number | null;
}

let state: OutageState = { enabled: false, expiresAt: null };

export function enableDeepgramOutage(durationSec: number) {
  state = {
    enabled: true,
    expiresAt: Date.now() + Math.max(1, durationSec) * 1000,
  };
}

export function disableDeepgramOutage() {
  state = { enabled: false, expiresAt: null };
}

export function isDeepgramDown(): boolean {
  if (!state.enabled) return false;
  if (state.expiresAt && Date.now() > state.expiresAt) {
    state = { enabled: false, expiresAt: null };
    return false;
  }
  return true;
}

export function getOutageState() {
  const active = isDeepgramDown();
  return {
    enabled: active,
    expiresAt: active ? state.expiresAt : null,
    secondsRemaining: active && state.expiresAt ? Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000)) : 0,
  };
}
