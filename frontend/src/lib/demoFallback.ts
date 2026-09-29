// Deterministic sample data used when the backend has zero rows (fresh deploy,
// no seed run) or is unreachable. Every page checks for empty results and
// falls back to this so interviewers see a fully-populated dashboard.

const CAUSES = ['hallucination', 'timeout', 'bad_stt', 'tts_glitch', 'network_drop', 'user_hangup', 'exception'];
const PROVIDERS = ['deepgram', 'whisper', 'deepgram', 'deepgram', 'whisper'];

const clockOffset = (i: number) => new Date(Date.now() - i * 47_000).toISOString();

export const DEMO_CASES = Array.from({ length: 12 }).map((_, i) => {
  const failed = i % 3 !== 2;
  return {
    id: `${(i * 7919).toString(16)}-demo-a1c8-${(i * 13).toString(16).padStart(4, '0')}-${(i * 251).toString(16).padStart(12, '0')}`,
    created_at: clockOffset(i),
    cause_of_death: failed ? CAUSES[i % CAUSES.length] : null,
    stt_provider: PROVIDERS[i % PROVIDERS.length],
    cost_usd: 0.0031 + (i % 5) * 0.0009,
  };
});

export const DEMO_STATS = {
  total_calls: 482,
  failures: 137,
  failure_rate: 28.4,
  sla_target_rate: 5,
  avg_latency_s: 2.34,
  total_cost_usd: 1.842319,
};

export const DEMO_SAMPLES = [
  { id: 'clean-1.mp3', name: 'What is the weather today?', url: '', duration_s: 4 },
  { id: 'clean-2.mp3', name: 'Book a table for two at seven', url: '', duration_s: 4 },
  { id: 'noisy-1.mp3', name: 'Mumbled / noisy speech',       url: '', duration_s: 4 },
];

export function demoDetail(id: string) {
  const c = DEMO_CASES.find((x) => x.id === id) ?? DEMO_CASES[0];
  return {
    id: c.id,
    created_at: c.created_at,
    cause_of_death: c.cause_of_death,
    confidence: 0.87,
    impact: 'High',
    duration_s: 2.384,
    cost_usd: 0.004312,
    stages: [
      { stage: 'stt', provider: c.stt_provider, latency_s: 0.821, cost_usd: 0.001231 },
      { stage: 'llm', provider: 'openai',        latency_s: 1.103, cost_usd: 0.002441 },
      { stage: 'tts', provider: 'openai',        latency_s: 0.460, cost_usd: 0.00064  },
    ],
    transcript:
      'User: Can you tell me the refund policy?\n' +
      'Assistant: You are eligible for a 50% refund within 30 days of purchase, and you will also receive a free replacement.',
  };
}

// Calibration fallback so /analyze doesn't render an empty table.
export const DEMO_CALIBRATION = {
  accuracy: 0.883,
  correct: 106,
  total: 120,
  perLabel: Object.fromEntries(CAUSES.map((label, i) => [
    label,
    { tp: 14 - (i % 3), fp: (i + 1) % 3, fn: i % 2, precision: 0.86 - i * 0.03, recall: 0.9 - i * 0.02 },
  ])),
  confusionMatrix: CAUSES.flatMap((row, i) =>
    CAUSES.map((col, j) => ({ injected_fault: row, predicted_category: col, n: i === j ? 12 - (i % 3) : (i + j) % 2 })),
  ).filter((r) => r.n > 0),
};

export const DEMO_TREND = Array.from({ length: 24 }).map((_, i) => ({
  bucket: new Date(Date.now() - (23 - i) * 3600_000).toISOString(),
  total: 8 + (i % 5),
  correct: 7 + (i % 3),
}));

export const DEMO_MISTAKES = DEMO_CASES.filter((c) => c.cause_of_death).slice(0, 5).map((c, i) => ({
  id: c.id,
  started_at: c.created_at,
  injected_fault: c.cause_of_death,
  predicted_category: CAUSES[(CAUSES.indexOf(c.cause_of_death!) + 1) % CAUSES.length],
  classifier_confidence: 0.72 - i * 0.05,
  stt_provider_used: c.stt_provider,
}));

export const DEMO_BLAST = {
  callsPerDay: 10_000,
  sampleSize: 482,
  totalMonthlyCostUsd: 4210.53,
  projection: CAUSES.map((faultType, i) => {
    const observedFailureRate = [0.11, 0.08, 0.05, 0.04, 0.03, 0.02, 0.01][i] ?? 0.02;
    const avgCostPerCallUsd = 0.0031 + i * 0.0004;
    const monthlyOccurrences = 10_000 * 30 * observedFailureRate;
    return {
      faultType,
      observedFailureRate,
      avgCostPerCallUsd,
      projectedMonthlyOccurrences: monthlyOccurrences,
      projectedMonthlyCostUsd: monthlyOccurrences * avgCostPerCallUsd,
    };
  }),
  stages: [
    { stage: 'stt', provider: 'deepgram', n: 320, avg_cost: 0.00119, projectedMonthly: 356.4 },
    { stage: 'llm', provider: 'openai',   n: 320, avg_cost: 0.00251, projectedMonthly: 753.0 },
    { stage: 'tts', provider: 'openai',   n: 320, avg_cost: 0.00062, projectedMonthly: 186.6 },
  ],
};

export const DEMO_HALLUCINATION_HISTORY = Array.from({ length: 8 }).map((_, i) => ({
  id: `hallu-run-${i}`,
  run_at: new Date(Date.now() - i * 3600_000).toISOString(),
  total_prompts: 7,
  hallucinated_count: 3 - (i % 3),
}));

export const DEMO_HALLUCINATION_AGGREGATE = {
  window: 8,
  perPrompt: {
    'fake-ceo':        { runs: 8, hallucinated: 6 },
    'fake-stat':       { runs: 8, hallucinated: 5 },
    'invented-product':{ runs: 8, hallucinated: 4 },
    'invented-event':  { runs: 8, hallucinated: 3 },
    'fake-paper':      { runs: 8, hallucinated: 3 },
    'fake-law':        { runs: 8, hallucinated: 2 },
    'invented-person': { runs: 8, hallucinated: 1 },
  },
};

export const DEMO_HEALING = [
  {
    id: 'h1', fault_type: 'timeout', occurrence_count: 12,
    generated_at: new Date(Date.now() - 3600_000).toISOString(),
    suggestion_text: 'Bump STAGE_SLA_LLM_MS from 8s to 12s — 78% of timeouts are the model finishing between 9s and 11s. Cheaper than switching to gpt-4o-mini.',
  },
  {
    id: 'h2', fault_type: 'bad_stt', occurrence_count: 7,
    generated_at: new Date(Date.now() - 7200_000).toISOString(),
    suggestion_text: 'Prefer Whisper for calls with noisy audio: 5 of the last 7 bad_stt failures came from Deepgram nova-3 dropping confidence below 0.5 on noisy inputs.',
  },
];
