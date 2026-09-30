// Browser end-to-end test against the REAL app: real backend, Postgres, Redis, Deepgram and OpenAI (a full run costs a few
// cents). Every check that involves a call reads the result back from the API and compares it with what the page shows, so a page
// that merely renders is not enough to pass.
//
//   backend:   cd backend && npm run dev            (needs DEEPGRAM_API_KEY and OPENAI_API_KEY)
//   frontend:  cd frontend && npm run build && npx vite preview --port 5173
//   run:       node e2e/app.e2e.mjs                 (API_URL, E2E_URL and PLAYWRIGHT_DIR override the defaults)
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';

const require = createRequire(`${process.env.PLAYWRIGHT_DIR ?? '/opt/node22/lib/node_modules'}/`);
const { chromium } = require('playwright');
const API = process.env.API_URL ?? 'http://localhost:3000';
const APP = process.env.E2E_URL ?? 'http://localhost:5173';
const SAMPLES = path.resolve(import.meta.dirname, '../../backend/samples');
const MIC_WAV = path.join(SAMPLES, 'stress-01-young-male-clear-baseline.wav');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1; else { fail += 1; failures.push(`${name} -> ${String(extra).slice(0, 300)}`); }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${String(extra).slice(0, 300)}`}`);
};
const waitFor = async (fn, ms = 90000, step = 500) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* keep waiting */ } await sleep(step); } return null; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC_WAV}`, '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function newUser({ collectErrors = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  if (collectErrors) page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  if (collectErrors) page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|ERR_/.test(m.text())) errors.push(`CONSOLE ${m.text().slice(0, 200)}`); });
  return { ctx, page };
}
// innerText reflects CSS text-transform (headings are upper-case), so all comparisons are made case-insensitively
const txt = async (page, sel = 'body') => (await page.evaluate((s) => document.querySelector(s)?.innerText ?? '', sel)).replace(/\s+/g, ' ');
const has = (t, x) => t.toLowerCase().includes(String(x).toLowerCase());
const wsOf = (page) => page.evaluate(() => localStorage.getItem('callautopsy.workspace'));
const api = async (ws, pth, opts = {}) => { const r = await fetch(API + pth, { ...opts, headers: { 'x-workspace-id': ws, 'content-type': 'application/json', ...(opts.headers ?? {}) } }); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ } return { status: r.status, json, buf }; };
const pretty = (s) => String(s).replace(/_/g, ' ');

const A = await newUser();
const B = await newUser();
const pa = A.page;

// One analysis per 10 s per workspace, so calls in the same workspace are spaced out.
let lastStart = 0;
async function startAndWait(page, ws, trigger, label) {
  const gap = 10600 - (Date.now() - lastStart);
  if (gap > 0) await sleep(gap);
  const before = (await api(ws, '/calls?limit=100')).json.calls.map((c) => c.id);
  await trigger();
  lastStart = Date.now();
  const call = await waitFor(async () => {
    const list = (await api(ws, '/calls?limit=100')).json.calls;
    const fresh = list.find((c) => !before.includes(c.id));
    return fresh && (fresh.status === 'completed' || fresh.status === 'failed') ? fresh : null;
  }, 120000);
  ok(`${label}: the call finishes`, !!call, 'timed out');
  if (!call) return null;
  await waitFor(async () => (await api(ws, `/calls/${call.id}`)).json?.call?.analysis || (await api(ws, `/calls/${call.id}`)).json?.call?.status === 'failed', 60000);
  await sleep(800);
  return (await api(ws, `/calls/${call.id}`)).json;
}
const selectSample = async (page, id) => { await page.selectOption('select[aria-label="Demo call"]', `${id}.wav`); await sleep(200); };
const runSample = (page) => page.click('button:has-text("Analyze this call")');

// ================================================================== 1. first visit
await pa.goto(`${APP}/app`, { waitUntil: 'networkidle' });
await pa.waitForSelector('.ap-root');
await sleep(800);
const wsA = await wsOf(pa);
ok('first visit: the dashboard renders and a workspace id exists', !!wsA && (await txt(pa)).length > 300);
let t = await txt(pa, '.ap-root');
ok('first visit: empty, not fabricated (no calls, zero counts, no stray demo numbers)', /No calls yet/i.test(t) && /Calls\s*0/i.test(t) && !/\b482\b|28\.4%|1\.84/i.test(t), t.slice(0, 200));
const groups = await pa.$$eval('select[aria-label="Demo call"] optgroup', (gs) => gs.map((g) => [g.label.replace(/\s*\(\d+\)/, ''), g.children.length]));
ok('demo calls are grouped: 5 core, 10 stress, 4 quick', JSON.stringify(groups) === JSON.stringify([['Core scenarios', 5], ['Stress tests', 10], ['Quick clips', 4]]), JSON.stringify(groups));
ok('WebSocket connects (Live)', !!(await waitFor(async () => pa.$('.ap-live.on'), 8000)));

// ================================================================== 2. a two-voice stress call: what the page shows must equal what the API stored
await selectSample(pa, 'stress-04-young-female-fast-interruptions');
t = await txt(pa, '.ap-demo');
ok('the picker describes the call (speaker, recording, what it stresses)', /Speaker:/i.test(t) && /Recording:/i.test(t) && /Designed to stress/i.test(t), t.slice(0, 200));
const s4 = await startAndWait(pa, wsA, () => runSample(pa), 'stress-04');
if (s4) {
  const an = s4.call.analysis;
  ok('stress-04: the API stored a v2 analysis with two voices found from the audio', an?.version === 2 && an.attribution.speakers === 2 && an.attribution.reliable === true && an.attribution.source !== 'single_voice', JSON.stringify(an?.attribution));
  ok('stress-04: understanding and tone readings are stored', !!an.understanding && !!an.tone?.overall && 'lexical' in an.tone && 'vocal' in an.tone);
  ok('stress-04: stage rows include speech-to-text, reply, speech and analysis', ['stt', 'llm', 'tts', 'analysis'].every((s) => s4.stages.some((x) => x.stage === s)), s4.stages.map((x) => x.stage).join());
  await pa.waitForSelector('text=What the call was about', { timeout: 30000 }).catch(() => {});
  t = await txt(pa, '.ap-root');
  ok('stress-04: the page shows the stored intent', has(t, pretty(an.understanding.primary_intent.label)), an.understanding.primary_intent.label);
  ok('stress-04: the page shows the three tone readings', /From the words/i.test(t) && /From the voice/i.test(t) && /Overall/i.test(t));
  ok('stress-04: the recent-calls list shows the intent and difficulty', has(t, pretty(an.understanding.primary_intent.label)) && t.includes(an.difficulty.label));
  await pa.click('[role=tab]:has-text("Transcript")');
  t = await txt(pa, '.ap-transcript');
  ok('stress-04: the transcript labels the voices and shows what the script said', /Customer|Voice 1/i.test(t) && /Other voice|Voice 2/i.test(t) && /What was actually said/i.test(t), t.slice(0, 200));
  ok('stress-04: the script match on the page is the stored one', new RegExp(`${Math.round((1 - an.script_match.wer) * 100)}% of words match`, 'i').test(t), JSON.stringify(an.script_match));
  const pdf = await api(wsA, `/calls/${s4.call.id}/export.pdf`);
  ok('stress-04: the PDF report downloads', pdf.status === 200 && pdf.buf.subarray(0, 4).toString() === '%PDF', pdf.status);
}

// ================================================================== 3. fault injection: the chosen fault must reach the pipeline
await pa.click('summary:has-text("Simulate")');
const clipIdx = 'refund-request';
for (const fault of ['timeout', 'bad_stt']) {
  await selectSample(pa, clipIdx);
  await pa.selectOption('select[aria-label="Failure to simulate"]', fault);
  const r = await startAndWait(pa, wsA, () => runSample(pa), `fault ${fault}`);
  if (r) {
    ok(`fault ${fault}: injected_fault is stored`, r.call.injected_fault === fault, r.call.injected_fault);
    ok(`fault ${fault}: it is diagnosed as ${fault}`, r.call.predicted_category === fault && r.call.status === 'failed', `${r.call.predicted_category} ${r.call.status}`);
    t = await txt(pa, '.ap-root');
    ok(`fault ${fault}: the page shows a failed verdict`, /failed|broke|went wrong|Cause/i.test(t), t.slice(0, 160));
  }
}
await selectSample(pa, clipIdx);
await pa.selectOption('select[aria-label="Failure to simulate"]', 'hallucination');
await pa.$eval('label.ap-slider:has-text("Temperature") input', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '1.4'); el.dispatchEvent(new Event('input', { bubbles: true })); });
const hall = await startAndWait(pa, wsA, () => runSample(pa), 'fault hallucination');
if (hall) {
  const llm = hall.stages.find((s) => s.stage === 'llm');
  ok('hallucination: the temperature slider value reached the model', llm?.raw_meta?.temperature === 1.4, JSON.stringify(llm?.raw_meta));
  ok('hallucination: injected_fault stored', hall.call.injected_fault === 'hallucination');
}

// ================================================================== 4. the user's own microphone
await pa.selectOption('select[aria-label="Failure to simulate"]', 'none');
const mic = await startAndWait(pa, wsA, async () => { await pa.click('button[aria-label="Start recording"]'); await sleep(14000); await pa.click('button[aria-label="Stop recording and analyze"]'); }, 'microphone recording');
if (mic) {
  ok('microphone: stored as a recording, with a transcript and a full analysis', mic.call.input_source === 'recording' && mic.call.redacted_transcript.length > 40 && !!mic.call.analysis?.understanding && mic.call.analysis.signal !== null, `${mic.call.input_source} ${mic.call.redacted_transcript.length}`);
  ok('microphone: the analysis understood the content (the fake microphone plays a refund request)', ['refund_request', 'subscription_charge', 'billing_account_issue', 'incorrect_charge'].includes(mic.call.analysis.understanding.primary_intent.label), mic.call.analysis.understanding.primary_intent.label);
  ok('microphone: audio quality was measured from the recording', typeof mic.call.analysis.signal.snr_db === 'number' && typeof mic.call.analysis.signal.condition.label === 'string');
  await waitFor(async () => /What the call was about/i.test(await txt(pa, '.ap-root')) && /Where the time and money went/i.test(await txt(pa, '.ap-root')), 30000, 500);
  t = await txt(pa, '.ap-root');
  ok('microphone: the page shows the full report (intent, tone, findings, cost breakdown)', /What the call was about/i.test(t) && /What we noticed/i.test(t) && /Where the time and money went/i.test(t));
}

// ================================================================== 5. file upload
const up = await startAndWait(pa, wsA, () => pa.setInputFiles('input[type=file]', path.join(SAMPLES, 'weather-today.wav')), 'file upload');
ok('upload: stored as an uploaded file, with a transcript', !!up && up.call.input_source === 'upload' && up.call.redacted_transcript.length > 5, up && up.call.input_source);

// A compressed upload (mp3) is converted to WAV in the browser so it gets the same audio analysis and speaker check
let mp3 = null;
try { mp3 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'clip.mp3'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(SAMPLES, 'book-table.wav'), '-b:a', '64k', mp3]); } catch { mp3 = null; }
if (mp3) {
  const up2 = await startAndWait(pa, wsA, () => pa.setInputFiles('input[type=file]', mp3), 'mp3 upload');
  ok('mp3 upload: converted to WAV in the browser, so the server measured the audio and checked the speakers itself', !!up2 && up2.call.analysis?.signal !== null && up2.call.analysis?.attribution?.source !== 'recognizer' && up2.call.analysis?.attribution?.source !== 'unavailable', up2 && JSON.stringify(up2.call.analysis?.attribution));
} else {
  console.log('SKIP  mp3 upload (ffmpeg not available)');
}

// ================================================================== 6. isolation between two browsers
await B.page.goto(`${APP}/app`, { waitUntil: 'networkidle' });
await sleep(800);
const wsB = await wsOf(B.page);
t = await txt(B.page, '.ap-root');
ok('workspace B starts empty and does not see A\'s calls', wsB !== wsA && /No calls yet/i.test(t), t.slice(0, 150));
if (s4) {
  await B.page.goto(`${APP}/calls/${s4.call.id}`, { waitUntil: 'networkidle' });
  await sleep(1200);
  t = await txt(B.page);
  ok('workspace B cannot open A\'s call by its URL', !/What the call was about|Customer|Jordan/i.test(t) && /not found|couldn't|could not|unavailable|error/i.test(t), t.slice(0, 200));
  ok('and the API agrees', (await api(wsB, `/calls/${s4.call.id}`)).status === 404);
}

// ================================================================== 7. Analyze: shows the workspace's own results, and errors honestly
await pa.goto(`${APP}/analyze`, { waitUntil: 'networkidle' });
await sleep(1500);
const cal = (await api(wsA, '/calibration')).json;
t = await txt(pa);
ok('analyze: calibration reflects this workspace\'s labelled calls (injected faults)', cal.total >= 3 && new RegExp(`\\b${cal.total}\\b`, 'i').test(t), `${cal.total} :: ${t.slice(0, 200)}`);
await B.page.goto(`${APP}/analyze`, { waitUntil: 'networkidle' });
await sleep(1500);
t = await txt(B.page);
ok('analyze: an empty workspace shows an empty state, not numbers', /no scored calls yet/i.test(t) && /Overall accuracy\s*—/i.test(t), t.slice(0, 250));
const C = await newUser({ collectErrors: false }); // its request is aborted on purpose, so its console errors are expected
await C.page.route('**/calibration', (r) => r.abort());
await C.page.goto(`${APP}/analyze`, { waitUntil: 'networkidle' });
await sleep(1500);
t = await txt(C.page);
ok('analyze: when the server cannot be reached it says so instead of showing zeros', /couldn't|could not|unavailable|error|unreachable|try again/i.test(t) && !/Accuracy\s*0%/i.test(t), t.slice(0, 250));
await C.ctx.close();

// Blast radius and the hallucination suite: what the page shows must be what the API computed from this workspace's calls
await pa.goto(`${APP}/analyze?tab=blast-radius`, { waitUntil: 'networkidle' });
await sleep(800);
const volume = Number(await pa.$eval('input[type=number]', (el) => el.value));
const blast = (await api(wsA, '/blast-radius', { method: 'POST', body: JSON.stringify({ callsPerDay: volume }) })).json;
await pa.click('button:has-text("Project")');
await waitFor(async () => has(await txt(pa), 'Sample size') || has(await txt(pa), 'no finished calls') || has(await txt(pa), 'None of your'), 15000);
t = await txt(pa);
if (blast.projection.length) {
  ok('blast radius: sample size and every per-fault observed rate equal the API values', has(t, `Sample size ${blast.sampleSize}`) && blast.projection.every((p) => has(t, p.faultType) && t.includes(`${(p.observedFailureRate * 100).toFixed(1)}%`)), t.slice(0, 300));
} else {
  ok('blast radius: says plainly that there is no failure cost to project', /None of your|no finished calls/i.test(t), t.slice(0, 200));
}
await pa.goto(`${APP}/analyze?tab=hallucination`, { waitUntil: 'networkidle' });
await sleep(800);
t = await txt(pa);
ok('hallucination suite: before any run it shows dashes and "no runs yet", not 0%', /no runs yet/i.test(t) && !/Latest rate\s*0\.0%/i.test(t), t.slice(0, 200));
await pa.click('button:has-text("Run suite")');
const suite = await waitFor(async () => { const h = (await api(wsA, '/hallucination-suite/history')).json.history; return h.length ? h[0] : null; }, 150000, 2000);
ok('hallucination suite: the run is stored with 7 prompts', !!suite && suite.total_prompts === 7, JSON.stringify(suite));
if (suite) {
  await waitFor(async () => has(await txt(pa), `${suite.hallucinated_count} / ${suite.total_prompts}`), 20000, 500);
  ok('hallucination suite: the page shows the stored count', has(await txt(pa), `${suite.hallucinated_count} / ${suite.total_prompts}`));
}

// ================================================================== 8. A/B: reproducible verdict from real measurements
await pa.goto(`${APP}/ab`, { waitUntil: 'networkidle' });
await sleep(800);
await pa.selectOption('select[aria-label="Call to test"]', 'refund-request.wav');
await pa.$eval('input[aria-label="Runs per side"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(10600 - (Date.now() - lastStart) > 0 ? 10600 - (Date.now() - lastStart) : 0);
const [started] = await Promise.all([
  pa.waitForResponse((r) => r.url().endsWith('/ab-tests') && r.request().method() === 'POST'),
  pa.click('button:has-text("Run 4 calls")'),
]);
const runId = (await started.json()).runId;
ok('A/B: the run starts and returns a run id', !!runId);
// the words "verdict" and "pipeline time" are on the page from the start, so completion is read from the API
const done = await waitFor(async () => { const r = (await api(wsA, `/ab-tests/${runId}`)).json; return r?.status === 'done' ? r : null; }, 240000, 2000);
ok('A/B: the run finishes in the background', !!done);
const ab = done ?? (await api(wsA, `/ab-tests/${runId}`)).json;
const headlineShown = await waitFor(async () => has(await txt(pa), ab.verdict?.headline ?? '\u0000'), 20000, 500);
ok('A/B: the page shows the verdict when the run finishes', !!headlineShown, ab.verdict?.headline);
ok('A/B: the API result is done with two finished runs per side and a verdict', ab.status === 'done' && ab.summary.configA.n === 2 && ab.summary.configB.n === 2 && !!ab.verdict, JSON.stringify(ab.progress));
ok('A/B: the two sides really ran different speech-to-text providers', ab.calls.filter((c) => c.side === 'A').every((c) => c.stt_provider_used === 'deepgram') && ab.calls.filter((c) => c.side === 'B').every((c) => c.stt_provider_used === 'whisper'), JSON.stringify(ab.calls.map((c) => [c.side, c.stt_provider_used])));
ok('A/B: the verdict follows the rules (a winner only for a real, consistent gap)', !!ab.verdict && ['A', 'B', 'tie', 'tradeoff'].includes(ab.verdict.winner) && (ab.verdict.winner === 'tie' ? ab.verdict.metrics.every((m) => m.better === 'none') : ab.verdict.metrics.some((m) => m.better !== 'none')), JSON.stringify(ab.verdict).slice(0, 300));
t = await txt(pa);
ok('A/B: the page shows the same headline the API computed', !!ab.verdict && has(t, ab.verdict.headline), ab.verdict?.headline);
ok('A/B: the page shows the per-measure table and the per-call rows', /Failed calls/i.test(t) && /Cost per call/i.test(t) && (await pa.$$eval('table.pc-table tbody tr', (r) => r.length)) >= 4);

// ================================================================== 9. Ops: everything is per workspace
await pa.goto(`${APP}/ops?tab=sla`, { waitUntil: 'networkidle' });
await sleep(1200);
await pa.$eval('input[aria-label="Max failure rate percent"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '7'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await pa.$eval('input[aria-label="Window in minutes"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '45'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await pa.click('button:has-text("Save")');
await sleep(800);
const slaA = (await api(wsA, '/sla')).json;
ok('ops: saving the SLA stores exactly the chosen values', slaA.config.max_failure_rate_pct === 7 && slaA.config.window_minutes === 45, JSON.stringify(slaA.config));
t = await txt(pa);
ok('ops: the SLA status shows the real counts of this workspace, not a default', new RegExp(`${slaA.status.failed} of ${slaA.status.total} calls failed`, 'i').test(t) || slaA.status.total === 0, t.slice(0, 300));
const slaB = (await api(wsB, '/sla')).json;
ok('ops: another workspace keeps the default SLA', slaB.config.max_failure_rate_pct === 5 && slaB.config.window_minutes === 60, JSON.stringify(slaB.config));
await pa.goto(`${APP}/ops?tab=queue`, { waitUntil: 'networkidle' });
await sleep(1200);
await pa.click('button:has-text("Knock offline")');
await sleep(800);
ok('ops: knocking the provider offline affects this workspace only', (await api(wsA, '/admin/deepgram-outage')).json.enabled === true && (await api(wsB, '/admin/deepgram-outage')).json.enabled === false);
await pa.click('button:has-text("Recover")');
await sleep(600);
ok('ops: recovering restores it', (await api(wsA, '/admin/deepgram-outage')).json.enabled === false);
await pa.click('.pc-chip:has-text("OFF")');
await sleep(600);
ok('ops: chaos mode switches on for this workspace only', (await api(wsA, '/chaos')).json.enabled === true && (await api(wsB, '/chaos')).json.enabled === false);
await pa.click('.pc-chip:has-text("ON")');
await sleep(600);
ok('ops: and off again', (await api(wsA, '/chaos')).json.enabled === false);
t = await txt(pa);
ok('ops: the queue panel says it is server-wide', /whole server|server-wide/i.test(t));

// ================================================================== 10. the daily allowance is counted from real calls
await pa.goto(`${APP}/app`, { waitUntil: 'networkidle' });
await sleep(1000);
const used = (await api(wsA, '/me/summary')).json;
t = await txt(pa, '.ap-root');
ok('dashboard: the quota text is computed from the stored calls', new RegExp(`${used.daily_limit - used.daily_used} of ${used.daily_limit} analyses left`, 'i').test(t), `${used.daily_used}/${used.daily_limit} :: ${t.slice(0, 160)}`);
ok('dashboard: the counters equal the stored numbers', new RegExp(`Calls\\s*${used.total_calls}`, 'i').test(t) && new RegExp(`Failed\\s*${used.failures}`, 'i').test(t), t.slice(0, 200));

// ================================================================== 11. no crashes
ok('no page errors or console errors during the whole run', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log(' -', f)); }
process.exit(fail ? 1 : 0);
