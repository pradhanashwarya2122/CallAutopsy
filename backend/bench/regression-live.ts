// Full regression through the REAL pipeline: every demo call is sent to a running backend (real Deepgram, real OpenAI), the stored
// result is read back from the API and scored against test/groundTruth.ts. Also checks the quick clips complete and are analysed.
//   npx tsx bench/regression-live.ts [--json]          API_URL defaults to http://localhost:3000
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TRUTH } from '../test/groundTruth.js';
import { newMatrix, printMatrix, scoreCall } from './scoring.js';

const API = process.env.API_URL ?? 'http://localhost:3000';
const ws = randomUUID();
const H = { 'x-workspace-id': ws, 'content-type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(API + p, { headers: H })).json() as Promise<any>;

const M = newMatrix();
const perCall: any[] = [];
const runtime: any[] = [];
const quick = ['refund-request', 'book-table', 'weather-today', 'noisy-line'];
for (const id of [...Object.keys(TRUTH), ...quick]) {
  const started = Date.now();
  let r: Response;
  for (let attempt = 0; ; attempt += 1) {
    r = await fetch(`${API}/calls`, { method: 'POST', headers: H, body: JSON.stringify({ sampleId: `${id}.wav` }) });
    if (r.status !== 429 || attempt > 5) break;
    await sleep(3000); // one analysis per 10 s per workspace
  }
  if (!r.ok) { console.log(id, 'START FAILED', r.status, await r.text()); continue; }
  const { callId } = (await r.json()) as { callId: string };
  let d: any = null;
  for (let i = 0; i < 90; i += 1) { await sleep(1500); d = await get(`/calls/${callId}`); if (d.call.status === 'completed' || d.call.status === 'failed') break; }
  await sleep(500);
  d = await get(`/calls/${callId}`);
  const a = d.call.analysis;
  runtime.push({ id: id.slice(0, 34), status: d.call.status, category: d.call.predicted_category, stt: d.call.stt_provider_used, failover: d.call.stt_failover_occurred, analysis: !!a, seconds: +((Date.now() - started) / 1000).toFixed(1), cost: +Number(d.call.total_cost_usd).toFixed(5) });
  if (TRUTH[id] && a) perCall.push(scoreCall(M, id, a, d.call.redacted_transcript));
  await sleep(Math.max(0, 10500 - (Date.now() - started)));
}
console.table(runtime);
console.table(perCall);
const okCalls = runtime.filter((x) => x.status === 'completed' && x.category === 'ok' && x.analysis).length;
console.log(`\ncalls completed ok with an analysis: ${okCalls}/${runtime.length}`);
printMatrix(M);
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/regression-live.json', JSON.stringify({ runtime, perCall, matrix: M }, null, 1));
process.exitCode = okCalls === runtime.length ? 0 : 1;
