import { getWorkspaceId } from './workspace';

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
  const url = fromEnv || resolveBase().replace(/^http/, 'ws') + '/ws';
  return `${url}${url.includes('?') ? '&' : '?'}ws=${WORKSPACE}`;
}

const WORKSPACE = getWorkspaceId();
export const BASE = resolveBase();
export const WS_URL = resolveWs();

// Session-scoped connectivity state so any component can render a banner.
export const connectivity = {
  online: true as boolean,
  lastError: null as string | null,
  listeners: new Set<() => void>(),
  emit() { this.listeners.forEach((fn) => fn()); },
};

// A non-2xx answer from the backend. `message` is safe to show to the user.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function j(path: string, init?: RequestInit) {
  const url = BASE + path;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': WORKSPACE, ...(init?.headers || {}) },
    });
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body?.message ?? `${res.status} ${res.statusText}`.trim());
    }
    if (!connectivity.online) {
      connectivity.online = true;
      connectivity.lastError = null;
      connectivity.emit();
    }
    return res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A 4xx means the backend answered (e.g. "not found"); only network errors and 5xx mean it is down.
    const backendAnswered = err instanceof ApiError && err.status < 500;
    if (!backendAnswered && connectivity.online) {
      connectivity.online = false;
      // Never expose the raw URL to the user — keep it as a mental model.
      connectivity.lastError = `Backend not responding (${msg.slice(0, 80)})`;
      connectivity.emit();
    }
    if (!backendAnswered) console.error('[api]', url, msg);
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
  pdfUrl: (id: string) => `${BASE}/calls/${id}/export.pdf?ws=${WORKSPACE}`,
  audioUrl: (id: string, kind: 'input' | 'tts') => `${BASE}/calls/${id}/audio/${kind}?ws=${WORKSPACE}`,
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

  // ---- Dashboard: per-workspace data. No demo fallbacks; an empty account shows an empty state. ----

  mySummary: () => j('/me/summary') as Promise<MySummary>,

  async myCalls(limit = 12): Promise<CaseRow[]> {
    const r = await j(`/calls?limit=${limit}`);
    return (r.calls ?? []).map((c: any): CaseRow => ({
      id: c.id,
      created_at: c.started_at,
      status: c.status,
      cause_of_death: c.status === 'failed' ? causeOf(c.predicted_category) ?? 'unknown' : null,
      stt_provider: c.stt_provider_used ?? null,
      failover: !!c.stt_failover_occurred,
      cost_usd: Number(c.total_cost_usd ?? 0),
      injected_fault: c.injected_fault ?? null,
      source: c.input_source,
      sample_id: c.sample_id ?? null,
    }));
  },

  async callDetail(id: string): Promise<CaseDetail> {
    const r = await j(`/calls/${id}`);
    const call = r.call ?? {};
    const stages: StageRow[] = (r.stages ?? []).map((s: any) => ({
      stage: s.stage,
      provider: s.provider ?? null,
      latency_s: (s.duration_ms ?? 0) / 1000,
      cost_usd: Number(s.cost_usd ?? 0),
      status: s.status,
    }));
    const started = call.started_at ? new Date(call.started_at).getTime() : NaN;
    const ended = call.ended_at ? new Date(call.ended_at).getTime() : NaN;
    const finished = call.status === 'completed' || call.status === 'failed' || call.status === 'aborted';
    return {
      id: call.id ?? id,
      created_at: call.started_at,
      status: call.status,
      finished,
      cause_of_death: call.status === 'failed' ? causeOf(call.predicted_category) ?? 'unknown' : null,
      confidence: call.classifier_confidence == null ? null : Number(call.classifier_confidence),
      duration_s: Number.isFinite(ended - started) ? (ended - started) / 1000 : null,
      cost_usd: call.total_cost_usd == null ? stages.reduce((n, s) => n + s.cost_usd, 0) : Number(call.total_cost_usd),
      transcript: call.redacted_transcript || null,
      stages,
      stt_provider: call.stt_provider_used ?? null,
      failover: !!call.stt_failover_occurred,
      injected_fault: call.injected_fault ?? null,
      source: call.input_source,
      sample_id: call.sample_id ?? null,
      has_reply_audio: stages.some((s) => s.stage === 'tts' && s.status === 'ok'),
      autopsy: parseAutopsy(r.autopsy?.report_text),
    };
  },

  async sampleList(): Promise<SampleRow[]> {
    const r = await j('/samples');
    return (r.samples ?? []).map((s: any) => ({
      id: s.id,
      label: s.label ?? s.id,
      says: s.says ?? null,
      duration_s: typeof s.duration_s === 'number' ? s.duration_s : null,
      url: `${BASE}/samples/${encodeURIComponent(s.id)}`,
    }));
  },

  // Start an analysis from an uploaded/recorded file or a bundled sample. Resolves to the new call id.
  async analyze(input: { file?: Blob & { name?: string }; sampleId?: string; fault?: FaultChoice }): Promise<{ callId: string }> {
    const fd = new FormData();
    if (input.file) fd.append('audio', input.file, input.file.name || 'recording.webm');
    else if (input.sampleId) fd.append('sampleId', input.sampleId);
    const f = input.fault;
    if (f && f.type !== 'none') {
      fd.append('faultType', f.type);
      fd.append('faultParams', JSON.stringify(faultParamsFor(f)));
    }
    const res = await fetch(BASE + '/calls', { method: 'POST', headers: { 'X-Workspace-Id': WORKSPACE }, body: fd });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body?.message ?? `Upload failed (${res.status}).`);
    return body;
  },
};

// ---- Dashboard types + helpers ----

export interface MySummary {
  total_calls: number; failures: number; in_flight: number; failure_rate: number;
  avg_latency_s: number; total_cost_usd: number; sla_target_rate: number;
  daily_used: number; daily_limit: number; max_upload_bytes: number;
}
export interface CaseRow {
  id: string; created_at: string; status: string; cause_of_death: string | null;
  stt_provider: string | null; failover: boolean; cost_usd: number;
  injected_fault: string | null; source: string; sample_id: string | null;
}
export interface StageRow { stage: 'stt' | 'llm' | 'tts'; provider: string | null; latency_s: number; cost_usd: number; status: string }
export interface Autopsy { cause?: string; chain?: string; factors?: string; recommendation?: string }
export interface CaseDetail extends Omit<CaseRow, 'cost_usd'> {
  finished: boolean; confidence: number | null; duration_s: number | null; cost_usd: number;
  transcript: string | null; stages: StageRow[]; has_reply_audio: boolean; autopsy: Autopsy | null;
}
export interface SampleRow { id: string; label: string; says: string | null; duration_s: number | null; url: string }
export interface FaultChoice {
  type: 'none' | 'bad_stt' | 'hallucination' | 'tts_glitch' | 'timeout' | 'user_hangup' | 'network_drop' | 'exception';
  stage?: 'stt' | 'llm' | 'tts'; corruptionPct?: number; intensity?: 'mild' | 'aggressive'; truncatePct?: number; extraDelayMs?: number;
}

function faultParamsFor(f: FaultChoice): Record<string, unknown> {
  switch (f.type) {
    case 'bad_stt': return { bad_stt: { corruptionPct: f.corruptionPct ?? 60, stride: 4 } };
    case 'hallucination': return { hallucination: { intensity: f.intensity ?? 'aggressive' } };
    case 'tts_glitch': return { tts_glitch: { truncatePct: f.truncatePct ?? 30, injectNulls: true } };
    case 'timeout': return { timeout: { stage: f.stage ?? 'llm', extraDelayMs: f.extraDelayMs ?? 3000 } };
    case 'user_hangup': return { user_hangup: { stage: f.stage ?? 'stt' } };
    case 'network_drop': return { network_drop: { stage: f.stage ?? 'stt' } };
    case 'exception': return { exception: { stage: f.stage ?? 'stt' } };
    default: return {};
  }
}

// The backend writes the postmortem as four "## Heading" sections.
function parseAutopsy(text: string | null | undefined): Autopsy | null {
  if (!text) return null;
  const out: Autopsy = {};
  for (const chunk of text.split(/^##\s+/m).map((c) => c.trim()).filter(Boolean)) {
    const [head, ...rest] = chunk.split('\n');
    const body = rest.join('\n').trim();
    const h = head.trim().toLowerCase();
    if (h.startsWith('cause')) out.cause = body;
    else if (h.startsWith('chain')) out.chain = body;
    else if (h.startsWith('contributing')) out.factors = body;
    else if (h.startsWith('recommend')) out.recommendation = body;
  }
  return Object.keys(out).length ? out : null;
}
