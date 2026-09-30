// Captures the two real runs and the A/B comparison shown on the landing page, so frontend/src/lib/landingData.js can be refreshed
// from live measurements instead of edited by hand.   node bench/capture-landing.mjs   (API_URL defaults to http://localhost:3000)
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000';
const ws = randomUUID();
const H = { 'x-workspace-id': ws, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(API + p, { headers: H })).json();
const SAMPLE = 'call-1-clean-baseline.wav';

const out = { capturedAt: new Date().toISOString(), runs: {}, ab: null };
for (const [key, body] of [['timeout', { sampleId: SAMPLE, faultType: 'timeout' }], ['clean', { sampleId: SAMPLE }]]) {
  const r = await fetch(`${API}/calls`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${key}: ${r.status} ${JSON.stringify(j)}`);
  let d;
  for (let i = 0; i < 60; i += 1) { await sleep(1500); d = await get(`/calls/${j.callId}`); if (['completed', 'failed'].includes(d.call.status)) break; }
  await sleep(1500);
  out.runs[key] = await get(`/calls/${j.callId}`);
}

const ab = await fetch(`${API}/ab-tests`, { method: 'POST', headers: H, body: JSON.stringify({ sampleId: SAMPLE, iterations: 3, configA: { preferredSttProvider: 'deepgram', llmModel: 'gpt-4o-mini' }, configB: { preferredSttProvider: 'whisper', llmModel: 'gpt-4o' } }) });
const { runId } = await ab.json();
for (let i = 0; i < 120; i += 1) { await sleep(3000); const d = await get(`/ab-tests/${runId}`); if (d.status === 'done') break; }
await sleep(2000);
out.ab = await get(`/ab-tests/${runId}`);

fs.mkdirSync('bench/results', { recursive: true });
fs.writeFileSync('bench/results/landing-run.json', JSON.stringify(out, null, 1));
console.log('wrote bench/results/landing-run.json');
