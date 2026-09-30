// Fault-injection benchmark through the REAL pipeline: each of the 7 fault types is injected into 3 stress calls, and the
// classifier's verdict is compared with the fault that was injected. Hallucination is model-dependent (the model may not invent
// anything), so it is reported separately rather than counted as a software failure.
//   npx tsx bench/fault-benchmark.ts [--json]          API_URL defaults to http://localhost:3000
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000';
const ws = randomUUID();
const H = { 'x-workspace-id': ws, 'content-type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(API + p, { headers: H })).json() as Promise<any>;

const FAULTS: [string, object][] = [['bad_stt', {}], ['hallucination', { hallucination: { temperature: 1.5, intensity: 'aggressive' } }], ['tts_glitch', {}], ['timeout', {}], ['user_hangup', {}], ['network_drop', {}], ['exception', {}]];
const SAMPLES = ['stress-03-older-male-slow-noisy-repeats-amount.wav', 'stress-07-older-female-confused-corrections.wav', 'stress-09-frustrated-female-multi-intent-street.wav'];
const rows: any[] = [];
for (const sample of SAMPLES) {
  for (const [fault, faultParams] of FAULTS) {
    const t0 = Date.now();
    let r: Response;
    for (let attempt = 0; ; attempt += 1) {
      r = await fetch(`${API}/calls`, { method: 'POST', headers: H, body: JSON.stringify({ sampleId: sample, faultType: fault, faultParams }) });
      if (r.status !== 429 || attempt > 5) break;
      await sleep(3000);
    }
    if (!r.ok) { rows.push({ sample: sample.slice(0, 9), fault, error: `start ${r.status}` }); continue; }
    const { callId } = (await r.json()) as { callId: string };
    let d: any = null;
    for (let i = 0; i < 90; i += 1) { await sleep(1500); d = await get(`/calls/${callId}`); if (d.call.status === 'completed' || d.call.status === 'failed') break; }
    await sleep(400);
    d = await get(`/calls/${callId}`);
    const llm = d.stages.find((s: any) => s.stage === 'llm');
    rows.push({ sample: sample.slice(0, 9), fault, status: d.call.status, diagnosed: d.call.predicted_category, correct: d.call.predicted_category === fault, stages: d.stages.map((s: any) => `${s.stage}:${s.status}`).join(','), temperature: llm?.raw_meta?.temperature ?? null });
    await sleep(Math.max(0, 10500 - (Date.now() - t0)));
  }
}
console.table(rows);
const by: Record<string, { ok: number; n: number }> = {};
for (const r of rows) { const k = (by[r.fault] ??= { ok: 0, n: 0 }); k.n += 1; if (r.correct) k.ok += 1; }
console.log('\nFAULT CLASSIFICATION (injected fault vs diagnosis)');
for (const [k, v] of Object.entries(by)) console.log(`${k.padEnd(15)} ${v.ok}/${v.n}${k === 'hallucination' ? '   (model-dependent: the model may not invent anything)' : ''}`);
const deterministic = rows.filter((r) => r.fault !== 'hallucination');
const wrong = deterministic.filter((r) => !r.correct);
console.log(`\ndeterministic faults classified correctly: ${deterministic.length - wrong.length}/${deterministic.length}`);
wrong.forEach((w) => console.log('  WRONG', JSON.stringify(w)));
const hallTemps = rows.filter((r) => r.fault === 'hallucination').every((r) => r.temperature === 1.5);
console.log(`hallucination temperature reached the model in every run: ${hallTemps}`);
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/fault.json', JSON.stringify({ rows }, null, 1));
process.exitCode = wrong.length === 0 && hallTemps ? 0 : 1;
