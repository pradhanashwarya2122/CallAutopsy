// ---------------------------------------------------------------
// API base resolution
//
// Priority:
//   1. VITE_API_BASE_URL (baked at build time by Vite)
//   2. Fallback: try the same origin the page was loaded from — this lets a
//      deploy work even if the Cloudflare build was missing the env var.
//   3. Last resort: http://localhost:3000 for dev
// ---------------------------------------------------------------
function resolveBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      console.warn(
        '[api] VITE_API_BASE_URL not set at build time — falling back to same-origin ' +
          window.location.origin +
          '. This only works if the backend is served from the same domain.',
      );
      return window.location.origin;
    }
  }
  return 'http://localhost:3000';
}

function resolveWs(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (fromEnv) return fromEnv;
  const base = resolveBase();
  return base.replace(/^http/, 'ws') + '/ws';
}

export const BASE = resolveBase();
export const WS_URL = resolveWs();

// Session-scoped connectivity state so any component can render a banner.
export const connectivity = {
  online: true as boolean,
  lastError: null as string | null,
  listeners: new Set<() => void>(),
  emit() { this.listeners.forEach((fn) => fn()); },
};

async function j(path: string, init?: RequestInit) {
  const url = BASE + path;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    clearTimeout(t);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
    }
    if (!connectivity.online) {
      connectivity.online = true;
      connectivity.lastError = null;
      connectivity.emit();
    }
    return res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (connectivity.online) {
      connectivity.online = false;
      // Never expose the raw URL to the user — keep it as a mental model.
      connectivity.lastError = `Backend not responding (${msg.slice(0, 80)})`;
      connectivity.emit();
    }
    console.error('[api]', url, msg);
    throw err;
  }
}

// Wraps an API call: if it fails OR returns an empty result, substitutes
// bundled fallback data so pages never render as blank.
export async function withFallback<T>(fetcher: () => Promise<T>, fallback: T, isEmpty?: (v: T) => boolean): Promise<T> {
  try {
    const v = await fetcher();
    if (isEmpty && isEmpty(v)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

// The classifier labels healthy calls 'ok'; the dashboard models that as "no cause of death".
const causeOf = (category: string | null | undefined) => (category && category !== 'ok' ? category : null);

export const api = {
  listCalls: (q: Record<string, string> = {}) => {
    const qs = new URLSearchParams(q).toString();
    return j(`/calls${qs ? `?${qs}` : ''}`);
  },
  getCall: (id: string) => j(`/calls/${id}`),
  startCallWithSample: (sampleId: string, faultType?: string | null, faultParams?: any) =>
    j('/calls', { method: 'POST', body: JSON.stringify({ sampleId, faultType, faultParams }) }),
  startCallWithBlob: async (blob: Blob, faultType?: string | null, faultParams?: any) => {
    const fd = new FormData();
    fd.append('audio', blob, 'recording.webm');
    if (faultType) fd.append('faultType', faultType);
    if (faultParams) fd.append('faultParams', JSON.stringify(faultParams));
    const res = await fetch(BASE + '/calls', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  seededDemo: () => j('/demo/seeded-run', { method: 'POST' }),
  calibration: async () => {
    try {
      const r = await j('/calibration');
      if (!r || r.total === 0) throw new Error('empty');
      return r;
    } catch { return (await import('./demoFallback.js')).DEMO_CALIBRATION; }
  },
  calibrationTrend: async () => {
    try {
      const r = await j('/calibration/trend');
      if (!r?.trend?.length) throw new Error('empty');
      return r;
    } catch { return { trend: (await import('./demoFallback.js')).DEMO_TREND }; }
  },
  calibrationMistakes: async () => {
    try {
      const r = await j('/calibration/mistakes');
      if (!r?.mistakes?.length) throw new Error('empty');
      return r;
    } catch { return { mistakes: (await import('./demoFallback.js')).DEMO_MISTAKES }; }
  },
  blastRadius: async (callsPerDay: number) => {
    try {
      const r = await j('/blast-radius', { method: 'POST', body: JSON.stringify({ callsPerDay }) });
      if (!r?.projection?.length) throw new Error('empty');
      return r;
    } catch {
      const { DEMO_BLAST } = await import('./demoFallback.js');
      const scale = callsPerDay / DEMO_BLAST.callsPerDay;
      return {
        ...DEMO_BLAST,
        callsPerDay,
        totalMonthlyCostUsd: DEMO_BLAST.totalMonthlyCostUsd * scale,
        projection: DEMO_BLAST.projection.map((p) => ({
          ...p,
          projectedMonthlyOccurrences: p.projectedMonthlyOccurrences * scale,
          projectedMonthlyCostUsd: p.projectedMonthlyCostUsd * scale,
        })),
        stages: DEMO_BLAST.stages.map((s) => ({ ...s, projectedMonthly: s.projectedMonthly * scale })),
      };
    }
  },
  getSla: () => j('/sla'),
  setSla: (maxFailureRatePct: number, windowMinutes: number) =>
    j('/sla', { method: 'PUT', body: JSON.stringify({ maxFailureRatePct, windowMinutes }) }),
  slaBreaches: () => j('/sla/breaches'),
  slaTestWebhook: () => j('/sla/test-webhook', { method: 'POST' }),
  runAb: (configA: any, configB: any, faultType: string | null, iterations = 3, faultParams?: any) =>
    j('/ab-tests', { method: 'POST', body: JSON.stringify({ configA, configB, faultType, iterations, faultParams }) }),
  getAb: (id: string) => j(`/ab-tests/${id}`),
  runHallucinationSuite: () => j('/hallucination-suite/run', { method: 'POST' }),
  hallucinationHistory: async () => {
    try {
      const r = await j('/hallucination-suite/history');
      if (!r?.history?.length) throw new Error('empty');
      return r;
    } catch { return { history: (await import('./demoFallback.js')).DEMO_HALLUCINATION_HISTORY }; }
  },
  hallucinationRun: (id: string) => j(`/hallucination-suite/runs/${id}`),
  healing: async () => {
    try {
      const r = await j('/healing-suggestions');
      if (!r?.suggestions?.length) throw new Error('empty');
      return r;
    } catch { return { suggestions: (await import('./demoFallback.js')).DEMO_HEALING }; }
  },
  generateHealing: () => j('/healing-suggestions/generate', { method: 'POST' }),
  status: () => j('/status'),
  statusActivity: () => j('/status/activity'),
  statusProviders: () => j('/status/providers'),
  pdfUrl: (id: string) => `${BASE}/calls/${id}/export.pdf`,
  audioUrl: (id: string, kind: 'input' | 'tts') => `${BASE}/calls/${id}/audio/${kind}`,
  samples: () => j('/samples'),
  hallucinationAggregate: async () => {
    try {
      const r = await j('/hallucination-suite/aggregate');
      if (!r || Object.keys(r.perPrompt ?? {}).length === 0) throw new Error('empty');
      return r;
    } catch { return (await import('./demoFallback.js')).DEMO_HALLUCINATION_AGGREGATE; }
  },
  outageState: () => j('/admin/deepgram-outage'),
  setOutage: (enabled: boolean, durationSec = 60) =>
    j('/admin/deepgram-outage', { method: 'POST', body: JSON.stringify({ enabled, durationSec }) }),
  chaosState: () => j('/chaos'),
  setChaos: (patch: any) => j('/chaos', { method: 'POST', body: JSON.stringify(patch) }),
  costSummary: () => j('/cost/summary'),
  queueStats: () => j('/queue/stats'),
  queueDLQ: () => j('/queue/dlq'),

  // ---- Adapters for the NEW-FRONTEND dashboard components (JSX files) ----
  // These reshape backend payloads into the shapes the JSX components expect,
  // so the components can stay as-is.

  async getDashboardStats() {
    try {
      const [status, cost] = await Promise.all([j('/status'), j('/cost/summary').catch(() => ({}))]);
      const list = await j('/calls').catch(() => ({ calls: [] }));
      let avgSec = 0;
      const done = (list.calls ?? []).filter((c: any) => c.ended_at && c.started_at);
      if (done.length) {
        const totalMs = done.reduce((s: number, c: any) =>
          s + (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()), 0);
        avgSec = totalMs / done.length / 1000;
      }
      const total = status.totalCalls ?? 0;
      // Backend empty? Show demo numbers so the dashboard doesn't render all zeros.
      if (total === 0) {
        const { DEMO_STATS } = await import('./demoFallback.js');
        return DEMO_STATS;
      }
      return {
        total_calls: total,
        failures: status.failedCalls ?? 0,
        failure_rate: status.failureRatePct ?? 0,
        sla_target_rate: status.sla?.threshold ?? 5,
        avg_latency_s: avgSec,
        total_cost_usd: cost.allTimeSpentUsd ?? cost.todaySpentUsd ?? 0,
      };
    } catch {
      const { DEMO_STATS } = await import('./demoFallback.js');
      return DEMO_STATS;
    }
  },

  async listCases({ limit = 8 }: { limit?: number } = {}) {
    try {
      const r = await j('/calls');
      const rows = (r.calls ?? []).slice(0, limit).map((c: any) => ({
        id: c.id,
        created_at: c.started_at,
        cause_of_death: causeOf(c.predicted_category),
        stt_provider: c.stt_provider_used ?? '—',
        cost_usd: Number(c.total_cost_usd ?? 0),
      }));
      if (rows.length === 0) {
        const { DEMO_CASES } = await import('./demoFallback.js');
        return DEMO_CASES.slice(0, limit);
      }
      return rows;
    } catch {
      const { DEMO_CASES } = await import('./demoFallback.js');
      return DEMO_CASES.slice(0, limit);
    }
  },

  async listSamples() {
    try {
      const r = await j('/samples');
      const rows = (r.samples ?? []).map((s: any) => ({
        id: s.id,
        name: s.label ?? s.id,
        url: `${BASE}/samples/${s.id}`,
        duration_s: s.duration_s ?? 4,
      }));
      if (rows.length === 0) {
        const { DEMO_SAMPLES } = await import('./demoFallback.js');
        return DEMO_SAMPLES;
      }
      return rows;
    } catch {
      const { DEMO_SAMPLES } = await import('./demoFallback.js');
      return DEMO_SAMPLES;
    }
  },

  async getCase(id: string) {
    try {
      const r = await j(`/calls/${id}`);
      const call = r.call ?? {};
      const stages = (r.stages ?? []).map((s: any) => ({
        stage: s.stage,
        provider: s.provider ?? '—',
        latency_s: (s.duration_ms ?? 0) / 1000,
        cost_usd: Number(s.cost_usd ?? 0),
        error: s.status && s.status !== 'ok' ? s.status : undefined,
      }));
      if (stages.length === 0) {
        const { demoDetail } = await import('./demoFallback.js');
        return demoDetail(id);
      }
      const started = call.started_at ? new Date(call.started_at).getTime() : NaN;
      const ended = call.ended_at ? new Date(call.ended_at).getTime() : NaN;
      const ttsOk = stages.some((s: any) => s.stage === 'tts' && !s.error);
      return {
        id: call.id ?? id,
        created_at: call.started_at,
        cause_of_death: causeOf(call.predicted_category),
        confidence: call.classifier_confidence == null ? undefined : Number(call.classifier_confidence),
        duration_s: Number.isFinite(ended - started) ? (ended - started) / 1000 : undefined,
        cost_usd: call.total_cost_usd == null ? undefined : Number(call.total_cost_usd),
        transcript: call.redacted_transcript ?? undefined,
        audio_url: ttsOk ? `${BASE}/calls/${id}/audio/tts` : undefined,
        stages,
      };
    } catch {
      const { demoDetail } = await import('./demoFallback.js');
      return demoDetail(id);
    }
  },

  async submitRecording(blob: Blob, fault: { fault: string; temperature?: number; corruption_pct?: number; delay_ms?: number }) {
    const fd = new FormData();
    fd.append('audio', blob, 'recording.webm');
    fd.append('faultType', fault.fault);
    const faultParams: any = {};
    if (fault.fault === 'hallucination') {
      faultParams.hallucination = { intensity: 'aggressive', temperature: fault.temperature ?? 0.9 };
    } else if (fault.fault === 'bad_stt') {
      faultParams.bad_stt = { corruptionPct: fault.corruption_pct ?? 100, stride: 4 };
    } else if (fault.fault === 'timeout') {
      faultParams.timeout = { stage: 'llm', extraDelayMs: fault.delay_ms ?? 3000 };
    } else if (fault.fault === 'tts_glitch') {
      faultParams.tts_glitch = { truncatePct: 30, injectNulls: true };
    }
    fd.append('faultParams', JSON.stringify(faultParams));
    const res = await fetch(BASE + '/calls', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
