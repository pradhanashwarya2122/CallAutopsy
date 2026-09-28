const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws';

async function j(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

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
  calibration: () => j('/calibration'),
  calibrationTrend: () => j('/calibration/trend'),
  calibrationMistakes: () => j('/calibration/mistakes'),
  blastRadius: (callsPerDay: number) =>
    j('/blast-radius', { method: 'POST', body: JSON.stringify({ callsPerDay }) }),
  getSla: () => j('/sla'),
  setSla: (maxFailureRatePct: number, windowMinutes: number) =>
    j('/sla', { method: 'PUT', body: JSON.stringify({ maxFailureRatePct, windowMinutes }) }),
  slaBreaches: () => j('/sla/breaches'),
  slaTestWebhook: () => j('/sla/test-webhook', { method: 'POST' }),
  runAb: (configA: any, configB: any, faultType: string | null, iterations = 3, faultParams?: any) =>
    j('/ab-tests', { method: 'POST', body: JSON.stringify({ configA, configB, faultType, iterations, faultParams }) }),
  getAb: (id: string) => j(`/ab-tests/${id}`),
  runHallucinationSuite: () => j('/hallucination-suite/run', { method: 'POST' }),
  hallucinationHistory: () => j('/hallucination-suite/history'),
  hallucinationRun: (id: string) => j(`/hallucination-suite/runs/${id}`),
  healing: () => j('/healing-suggestions'),
  generateHealing: () => j('/healing-suggestions/generate', { method: 'POST' }),
  status: () => j('/status'),
  statusActivity: () => j('/status/activity'),
  statusProviders: () => j('/status/providers'),
  pdfUrl: (id: string) => `${BASE}/calls/${id}/export.pdf`,
  audioUrl: (id: string, kind: 'input' | 'tts') => `${BASE}/calls/${id}/audio/${kind}`,
  samples: () => j('/samples'),
  hallucinationAggregate: () => j('/hallucination-suite/aggregate'),
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
    const [status, cost] = await Promise.all([j('/status'), j('/cost/summary').catch(() => ({}))]);
    const list = await j('/calls').catch(() => ({ calls: [] }));
    // Latency estimate: avg (ended_at - started_at) across recent completed calls
    let avgSec = 0;
    const done = (list.calls ?? []).filter((c: any) => c.ended_at && c.started_at);
    if (done.length) {
      const totalMs = done.reduce((s: number, c: any) =>
        s + (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()), 0);
      avgSec = totalMs / done.length / 1000;
    }
    return {
      total_calls: status.totalCalls ?? 0,
      failures: status.failedCalls ?? 0,
      failure_rate: status.failureRatePct ?? 0,
      sla_target_rate: status.sla?.threshold ?? 5,
      avg_latency_s: avgSec,
      total_cost_usd: cost.allTimeSpentUsd ?? cost.todaySpentUsd ?? 0,
    };
  },

  async listCases({ limit = 8 }: { limit?: number } = {}) {
    const r = await j('/calls');
    return (r.calls ?? []).slice(0, limit).map((c: any) => ({
      id: c.id,
      created_at: c.started_at,
      cause_of_death: c.predicted_category,
      stt_provider: c.stt_provider_used ?? '—',
      cost_usd: Number(c.total_cost_usd ?? 0),
    }));
  },

  async listSamples() {
    const r = await j('/samples');
    return (r.samples ?? []).map((s: any) => ({
      id: s.id,
      name: s.label ?? s.id,
      url: `${BASE}/samples/${s.id}`,
      duration_s: s.duration_s ?? 4,
    }));
  },

  async getCase(id: string) {
    const r = await j(`/calls/${id}`);
    const stages = (r.stages ?? []).map((s: any) => ({
      stage: s.stage,
      provider: s.provider ?? '—',
      latency_s: (s.duration_ms ?? 0) / 1000,
      cost_usd: Number(s.cost_usd ?? 0),
    }));
    return { ...r, stages };
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
