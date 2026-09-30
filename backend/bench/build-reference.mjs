// Builds frontend/src/lib/reference.js: the measured results the Analyze, A/B and Ops pages show next to (never instead of) a
// workspace's own numbers, so an empty workspace still has real values to read. Every value comes from a result file in
// bench/results/ or from the recorded stage timings below; nothing is estimated.
//   node bench/build-reference.mjs
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./results/${f}`, import.meta.url), 'utf8'));
const fault = read('fault.json').rows;
const regression = read('regression-live.json');
const landing = read('landing-run.json');

const FAULT_ORDER = ['bad_stt', 'tts_glitch', 'timeout', 'user_hangup', 'network_drop', 'exception', 'hallucination'];
const faults = FAULT_ORDER.map((injected) => ({ injected, predicted: fault.filter((r) => r.fault === injected).map((r) => r.diagnosed) }));

const runtime = regression.runtime;
const costs = runtime.map((r) => r.cost);
const clean = { n: runtime.length, ok: runtime.filter((r) => r.category === 'ok').length, other: runtime.filter((r) => r.category !== 'ok').map((r) => ({ id: r.id, predicted: r.category })) };

// Per-stage timing of 254 completed demo calls with no fault injected (Postgres, 30 Sep 2026):
//   SELECT s.stage, s.provider, count(*), percentile_cont(.5), percentile_cont(.95), max(duration_ms) FROM call_stages s JOIN calls c ...
//   WHERE c.status='completed' AND c.injected_fault IS NULL AND c.input_source='sample' AND s.status='ok'
const stages = [
  { stage: 'stt', provider: 'deepgram', n: 155, p50Ms: 805, p95Ms: 1467, maxMs: 1930 },
  { stage: 'stt', provider: 'whisper', n: 27, p50Ms: 1210, p95Ms: 2800, maxMs: 3890 },
  { stage: 'llm', provider: 'openai', n: 182, p50Ms: 1035, p95Ms: 1834, maxMs: 3835 },
  { stage: 'tts', provider: 'openai', n: 182, p50Ms: 1718, p95Ms: 2808, maxMs: 3975 },
];

// Average cost per stage over the same 254 calls (primary path: Deepgram, then the model, then the voice, plus the parallel analysis).
const costStages = [
  { stage: 'stt', provider: 'deepgram', n: 155, avgCostUsd: 0.0016593 },
  { stage: 'llm', provider: 'openai', n: 182, avgCostUsd: 0.0000413 },
  { stage: 'tts', provider: 'openai', n: 182, avgCostUsd: 0.0019381 },
  { stage: 'analysis', provider: 'openai', n: 142, avgCostUsd: 0.0004077 },
];

const ab = landing.ab;
const v = ab.verdict;
const reference = {
  measuredOn: '2026-09-30',
  faults: { sample: [...new Set(fault.map((r) => r.sample))], rows: faults },
  clean,
  cost: { n: runtime.length, avgUsd: costs.reduce((a, b) => a + b, 0) / costs.length, minUsd: Math.min(...costs), maxUsd: Math.max(...costs) },
  stages,
  costStages,
  ab: {
    sample: ab.run.sample_id, iterations: ab.run.iterations, configA: ab.run.config_a, configB: ab.run.config_b,
    headline: v.headline, winner: v.winner, caveats: v.caveats,
    a: ab.summary.configA, b: ab.summary.configB,
    calls: ab.calls,
    metrics: v.metrics.map((m) => ({ id: m.id, label: m.label, a: m.a, b: m.b, better: m.better, why: m.why })),
  },
};

// The demo library: the 15 recorded calls (5 core, 10 stress) with what the live pipeline measured for each of them.
const manifest = JSON.parse(fs.readFileSync(new URL('../samples/manifest.json', import.meta.url), 'utf8')).samples;
const wavSeconds = (id) => {
  const b = fs.readFileSync(new URL(`../samples/${id}`, import.meta.url));
  return Math.round(((b.length - 44) / b.readUInt32LE(28)) * 10) / 10;
};
const measured = new Map(regression.perCall.map((c) => [c.id, c]));
// The same "Customer: ... / Agent: ..." script text the server shows (backend/src/sampleLibrary.ts scriptDisplay).
const scriptOf = (e) => {
  if (e.says) return e.says;
  const ev = e.timeline ?? e.segments;
  if (!ev?.length) return null;
  const multi = new Set(ev.map((x) => x.who ?? 'customer')).size > 1;
  return multi ? ev.map((x) => `${(x.who ?? 'customer') === 'agent' ? 'Agent' : 'Customer'}: ${x.text}`).join('\n') : ev.map((x) => x.text).join(' ');
};
// The recordings also ship with the website (frontend/public/samples), so the demo library is visible, playable and analysable even
// when the backend was deployed from an older build that lacks them.
const publicSamples = new URL('../../frontend/public/samples/', import.meta.url);
fs.mkdirSync(publicSamples, { recursive: true });
const demoCalls = manifest
  .filter((e) => e.group === 'core' || e.group === 'stress' || e.group === 'quick')
  .map((e) => {
    fs.copyFileSync(new URL(`../samples/${e.id}`, import.meta.url), new URL(e.id, publicSamples));
    const m = measured.get((e.id.match(/^(call-\d+|stress-\d+)/) ?? [])[1]);
    return {
      id: e.id, label: e.label, group: e.group, category: e.category, level: e.level, speaker: e.speaker ?? null, environment: e.environment ?? null,
      tags: e.tags ?? [], summary: e.summary ?? null, challenge: e.challenge ?? null, says: scriptOf(e),
      seconds: wavSeconds(e.id),
      measured: m ? { wer: m.wer, condition: m.condition, difficulty: m.difficulty, speakers: m.speakers, intent: m.intent } : null,
    };
  });
const quickClips = demoCalls.filter((c) => c.group === 'quick').length;

const out = `// GENERATED by backend/bench/build-reference.mjs from backend/bench/results/*.json. Do not edit by hand.\nexport const REFERENCE = ${JSON.stringify(reference, null, 2)};\nexport const DEMO_CALLS = ${JSON.stringify(demoCalls, null, 2)};\nexport const QUICK_CLIPS = ${quickClips};\n`;
fs.writeFileSync(new URL('../../frontend/src/lib/reference.js', import.meta.url), out);
console.log('wrote frontend/src/lib/reference.js');
