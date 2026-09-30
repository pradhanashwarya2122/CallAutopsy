// API tests against the real Express app, Postgres and Redis (no mocks). Needs the same services the backend needs:
//   DATABASE_URL (default postgres://ca:ca@127.0.0.1:5432/callautopsy) and REDIS_URL (default redis://127.0.0.1:6379).
// No test here calls a paid provider: calls are inserted straight into the database.
process.env.DATABASE_URL ??= 'postgres://ca:ca@127.0.0.1:5432/callautopsy';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.MAX_ANALYSES_PER_IP_PER_HOUR = '10';
process.env.OPENAI_API_KEY ??= 'test-key-not-used';

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { pdfText } from '../pdfText.js';

const { createServer } = await import('../../src/server.js');
const { attachWebSocket, broadcast } = await import('../../src/websocket/broadcaster.js');
const { query, pool } = await import('../../src/db/client.js');
const { migrate } = await import('../../src/db/migrate.js');

const A = randomUUID();
const B = randomUUID();
let base = '';
let server: http.Server;
const H = (ws?: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', ...(ws ? { 'x-workspace-id': ws } : {}), ...extra });
const call = async (method: string, url: string, opts: { ws?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const r = await fetch(base + url, { method, headers: H(opts.ws, opts.headers), body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString('utf8');
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, buf };
};

const SECRETS = ['jane.doe@example.com', '4111 1111 1111 1111', '415-555-0132'];
const createdCalls: string[] = [];
const createdAbRuns: string[] = [];

async function insertCall(owner: string | null, fields: { transcript?: string; analysis?: unknown; sample?: string } = {}) {
  const id = randomUUID();
  await query(
    `INSERT INTO calls (id, started_at, ended_at, status, input_source, sample_id, owner_id, redacted_transcript, predicted_category, analysis, total_cost_usd)
     VALUES ($1, now(), now(), 'completed', 'sample', $2, $3, $4, 'ok', $5, 0.001)`,
    [id, fields.sample ?? null, owner, fields.transcript ?? 'hello', fields.analysis ? JSON.stringify(fields.analysis) : null],
  );
  createdCalls.push(id);
  return id;
}

before(async () => {
  // fail fast, with a clear message, when the services the tests need are not running
  await Promise.race([query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error(`Postgres is not reachable at ${process.env.DATABASE_URL}`)), 5000))]);
  await migrate();
  const app = createServer();
  server = http.createServer(app);
  attachWebSocket(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  if (createdCalls.length) await query('DELETE FROM call_stages WHERE call_id = ANY($1)', [createdCalls]).catch(() => {});
  await query('DELETE FROM autopsy_reports WHERE call_id = ANY($1)', [createdCalls]).catch(() => {});
  await query('DELETE FROM calls WHERE id = ANY($1)', [createdCalls]).catch(() => {});
  await query('DELETE FROM ab_runs WHERE owner_id = ANY($1) OR id = ANY($2)', [[A, B], createdAbRuns]).catch(() => {});
  await query('DELETE FROM workspace_sla WHERE owner_id = ANY($1)', [[A, B]]).catch(() => {});
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end().catch(() => {});
});

// ------------------------------------------------------------------ every state-changing route is workspace-protected
test('every state-changing route refuses a request that carries no workspace (and ?ws= in the URL does not count)', async () => {
  const dir = path.resolve(import.meta.dirname, '../../src/routes');
  const routes: { method: string; url: string }[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/Router\.(post|put|delete|patch)\(\s*'([^']+)'/g)) {
      routes.push({ method: m[1].toUpperCase(), url: m[2].replace(/:\w+/g, randomUUID()) });
    }
  }
  assert.ok(routes.length >= 9, `found only ${routes.length} mutating routes`);
  for (const r of routes) {
    const bare = await call(r.method, r.url);
    assert.ok(bare.status === 400 || bare.status === 403, `${r.method} ${r.url} without a workspace answered ${bare.status}`);
    const viaQuery = await call(r.method, `${r.url}?ws=${A}`);
    assert.ok(viaQuery.status === 400 || viaQuery.status === 403, `${r.method} ${r.url}?ws= answered ${viaQuery.status}`);
  }
});

test('read routes that return a workspace\'s data also demand a workspace', async () => {
  for (const url of ['/me/summary', '/sla', '/sla/breaches', '/calibration', '/healing-suggestions', '/hallucination-suite/history', '/admin/deepgram-outage', '/chaos']) {
    const r = await call('GET', url);
    assert.equal(r.status, 400, `${url} answered ${r.status}`);
  }
});

// ------------------------------------------------------------------ isolation between workspaces
test('workspace B cannot read, hear, download or list workspace A\'s call; A can', async () => {
  const id = await insertCall(A, { transcript: 'private call of A' });
  assert.equal((await call('GET', `/calls/${id}`, { ws: A })).status, 200);
  for (const url of [`/calls/${id}`, `/calls/${id}/audio/input`, `/calls/${id}/export.pdf`]) {
    assert.equal((await call('GET', url, { ws: B })).status, 404, `B got ${url}`);
    assert.equal((await call('GET', url)).status, 404, `nobody got ${url}`);
    assert.equal((await call('GET', `${url}?ws=${B}`)).status, 404, `B via ?ws= got ${url}`);
  }
  const listB = await call('GET', '/calls?limit=100', { ws: B });
  assert.equal(listB.json.calls.some((c: any) => c.id === id), false);
  assert.equal((await call('GET', '/calls?limit=100', { ws: A })).json.calls.some((c: any) => c.id === id), true);
});

test('a brand-new workspace has no calls and no fabricated numbers anywhere', async () => {
  const fresh = randomUUID();
  const list = await call('GET', '/calls', { ws: fresh });
  assert.deepEqual(list.json.calls, []);
  const sum = (await call('GET', '/me/summary', { ws: fresh })).json;
  assert.equal(sum.total_calls, 0); assert.equal(sum.failures, 0); assert.equal(sum.total_cost_usd, 0); assert.equal(sum.avg_latency_s, 0);
  const cal = (await call('GET', '/calibration', { ws: fresh })).json;
  assert.equal(cal.total, 0); assert.equal(cal.accuracy, null === cal.accuracy ? null : cal.accuracy);
  assert.deepEqual(cal.confusionMatrix ?? [], []);
  const blast = await call('POST', '/blast-radius', { ws: fresh, body: { callsPerDay: 1000 } });
  assert.equal(blast.status, 200);
  assert.equal(blast.json.sampleSize, 0);
  assert.equal(blast.json.basis, 'reference'); // no calls of its own: the costs are the measured reference, and the response says so
  assert.deepEqual(blast.json.byFault, []);
  assert.deepEqual(blast.json.stages, []);
  assert.deepEqual((await call('GET', '/hallucination-suite/history', { ws: fresh })).json.history, []);
  assert.deepEqual((await call('GET', '/sla/breaches', { ws: fresh })).json.breaches, []);
});

test('A/B runs belong to their workspace and validate their input', async () => {
  const id = randomUUID();
  await query('INSERT INTO ab_runs (id, config_a, config_b, owner_id, sample_id, iterations) VALUES ($1,$2,$3,$4,$5,$6)', [id, {}, {}, A, 'call-1-clean-baseline.wav', 2]);
  assert.equal((await call('GET', `/ab-tests/${id}`, { ws: A })).status, 200);
  assert.equal((await call('GET', `/ab-tests/${id}`, { ws: B })).status, 404);
  assert.equal((await call('POST', '/ab-tests', { ws: A, body: { configA: {}, configB: {} } })).status, 400, 'sampleId is required');
  assert.equal((await call('POST', '/ab-tests', { ws: A, body: { sampleId: 'no-such-call.wav', configA: {}, configB: {}, iterations: 2 } })).status, 404);
  for (const bad of [1, 0, 6, 2.5, 'x', -3]) assert.equal((await call('POST', '/ab-tests', { ws: A, body: { sampleId: 'call-1-clean-baseline.wav', configA: {}, configB: {}, iterations: bad } })).status, 400, `iterations ${bad}`);
});

// ------------------------------------------------------------------ Ops controls are per workspace and enforced on the server
test('outage and chaos controls change only the caller\'s own workspace', async () => {
  await call('POST', '/admin/deepgram-outage', { ws: A, body: { enabled: false } });
  const on = await call('POST', '/admin/deepgram-outage', { ws: A, body: { enabled: true, durationSec: 30 } });
  assert.equal(on.json.enabled, true);
  assert.equal((await call('GET', '/admin/deepgram-outage', { ws: A })).json.enabled, true);
  assert.equal((await call('GET', '/admin/deepgram-outage', { ws: B })).json.enabled, false, 'B is untouched');
  const c = await call('POST', '/chaos', { ws: A, body: { callsPerMinute: 999, faultMix: ['bad_stt', 'drop table'] } });
  assert.ok(c.json.callsPerMinute <= 12); assert.deepEqual(c.json.faultMix, ['bad_stt']);
  assert.equal((await call('GET', '/chaos', { ws: B })).json.enabled, false);
  assert.deepEqual((await call('GET', '/chaos', { ws: B })).json.faultMix.includes('bad_stt'), true, 'B keeps its own default mix');
  await call('POST', '/admin/deepgram-outage', { ws: A, body: { enabled: false } });
});

test('a forged or malformed workspace id is refused', async () => {
  for (const bad of ['not-a-uuid', '../etc/passwd', `${A};drop`, '00000000-0000-0000-0000-000000000000']) {
    const r = await call('POST', '/admin/deepgram-outage', { headers: { 'x-workspace-id': bad }, body: { enabled: true } });
    assert.equal(r.status, 400, bad);
  }
});

test('SLA thresholds are stored per workspace and validated', async () => {
  const set = await call('PUT', '/sla', { ws: A, body: { maxFailureRatePct: 1, windowMinutes: 30 } });
  assert.equal(set.status, 200);
  const a = (await call('GET', '/sla', { ws: A })).json;
  const b = (await call('GET', '/sla', { ws: B })).json;
  assert.equal(a.config.max_failure_rate_pct, 1); assert.equal(a.config.window_minutes, 30);
  assert.equal(b.config.max_failure_rate_pct, 5, 'B keeps the default');
  for (const bad of [{ maxFailureRatePct: -1, windowMinutes: 30 }, { maxFailureRatePct: 101, windowMinutes: 30 }, { maxFailureRatePct: 5, windowMinutes: 0 }, { maxFailureRatePct: 5, windowMinutes: 100000 }, { maxFailureRatePct: 'x', windowMinutes: 30 }]) {
    assert.equal((await call('PUT', '/sla', { ws: A, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('GET', '/me/summary', { ws: A })).json.sla_target_rate, 1, 'the dashboard reads the same per-workspace value');
});

test('operator-only endpoints need the admin token, not just a workspace', async () => {
  for (const [method, url] of [['GET', '/queue/dlq'], ['GET', '/budget'], ['POST', '/sla/test-webhook']] as const) {
    assert.equal((await call(method, url, { ws: A })).status, 403, `${url} with only a workspace`);
    assert.equal((await call(method, url, { ws: A, headers: { 'x-admin-token': 'wrong' } })).status, 403, `${url} with a wrong token`);
    assert.equal((await call(method, url, { ws: A, headers: { 'x-admin-token': 'test-admin-token' } })).status, url === '/sla/test-webhook' ? 200 : 200, `${url} with the token`);
  }
});

test('the shared queue statistics are counts only and reveal nothing about other workspaces', async () => {
  const r = await call('GET', '/queue/stats', { ws: A });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['call_queue', 'dlq']);
  assert.deepEqual(Object.keys(r.json.dlq), ['size']);
});

// ------------------------------------------------------------------ redaction on the way out
test('rows that hold raw personal details are redacted in the call detail, the stage list, the report and the PDF', async () => {
  const raw = `my email ${SECRETS[0]} card ${SECRETS[1]} phone ${SECRETS[2]}`;
  const analysis = { version: 2, turns: [{ speaker: 0, start: 0, end: 1, text: raw, confidence: 1, uncertain: false }], understanding: { summary: raw, primary_intent: { label: 'other', description: raw }, entities: { order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [] }, secondary_intents: [], corrections: [], ambiguities: [raw], next_steps: [raw], lexical_tone: { emotion: 'calm', evidence: raw } }, findings: [{ id: 'x', severity: 'info', area: 'audio', title: 't', detail: raw }], difficulty: { label: 'Easy', score: 0 }, attribution: { speakers: 1, source: 'single_voice', reliable: true, notes: [raw] } };
  const id = await insertCall(A, { transcript: raw, analysis });
  await query(`INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd) VALUES ($1,'stt','deepgram',now(),now(),5,'ok',$2,0)`, [id, JSON.stringify({ error: raw })]);
  await query('INSERT INTO autopsy_reports (call_id, report_text) VALUES ($1,$2)', [id, `## Cause\n${raw}`]);
  const d = await call('GET', `/calls/${id}`, { ws: A });
  assert.equal(d.status, 200);
  for (const s of SECRETS) assert.ok(!d.text.includes(s), `call detail leaks ${s}`);
  const pdf = await call('GET', `/calls/${id}/export.pdf`, { ws: A });
  assert.equal(pdf.status, 200);
  const text = pdfText(pdf.buf);
  assert.ok(text.length > 200, 'the PDF text could be read');
  for (const s of SECRETS) assert.ok(!text.includes(s) && !text.replace(/\s/g, '').includes(s.replace(/\s/g, '')), `PDF leaks ${s}`);
  assert.ok(text.replace(/\s/g, '').includes('REDACTED'), `and it shows that something was redacted: ${text.slice(0, 300)}`);
});

// ------------------------------------------------------------------ real-time events
test('WebSocket events go only to the workspace that owns them', async () => {
  const open = (ws: string) => new Promise<{ sock: WebSocket; got: any[] }>((resolve, reject) => {
    const sock = new WebSocket(`${base.replace('http', 'ws')}/ws?ws=${ws}`);
    const got: any[] = [];
    sock.on('message', (m) => got.push(JSON.parse(String(m))));
    sock.on('open', () => resolve({ sock, got }));
    sock.on('error', reject);
  });
  const a = await open(A);
  const b = await open(B);
  await new Promise((r) => setTimeout(r, 150));
  broadcast({ type: 'call.completed', callId: 'only-for-a' }, A);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(a.got.some((e) => e.callId === 'only-for-a'), 'A receives its own event');
  assert.ok(!b.got.some((e) => e.callId === 'only-for-a'), 'B does not');
  a.sock.close(); b.sock.close();
});

// ------------------------------------------------------------------ the demo library
test('the demo library lists 5 core, 10 stress and 4 quick calls with the documented fields', async () => {
  const r = await call('GET', '/samples', { ws: A });
  assert.equal(r.status, 200);
  const by = (g: string) => r.json.samples.filter((s: any) => s.group === g);
  assert.equal(by('core').length, 5); assert.equal(by('stress').length, 10); assert.equal(by('quick').length, 4);
  for (const s of by('stress')) { assert.ok(s.speaker && s.environment && s.tags.length && s.challenge && s.duration_s > 5, s.id); }
  assert.equal(new Set(r.json.samples.map((s: any) => s.id)).size, 19);
});

// ------------------------------------------------------------------ minting workspace ids does not buy more allowance
test('one network address cannot get around the limits by minting new workspace ids', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 14; i += 1) statuses.push((await call('POST', '/healing-suggestions/generate', { ws: randomUUID() })).status);
  assert.ok(statuses.includes(200), 'the first requests go through');
  const limited = await call('POST', '/healing-suggestions/generate', { ws: randomUUID() });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error, 'ip_limit');
});

// ------------------------------------------------------------------ calibration only scores calls whose truth is known
test('calibration ignores unlabelled real calls, and counts injected faults and control calls', async () => {
  const ws = randomUUID();
  const mk = async (fault: string | null, label: string | null, predicted: string) => {
    const id = randomUUID();
    await query(`INSERT INTO calls (id, started_at, ended_at, status, input_source, owner_id, injected_fault, label_source, predicted_category) VALUES ($1, now(), now(), $2, 'sample', $3, $4, $5, $6)`, [id, predicted === 'ok' ? 'completed' : 'failed', ws, fault, label, predicted]);
    createdCalls.push(id);
  };
  await mk('timeout', null, 'timeout');   // injected fault, diagnosed right
  await mk('bad_stt', null, 'timeout');   // injected fault, diagnosed wrong
  await mk(null, 'control', 'ok');        // control call, diagnosed right
  await mk(null, null, 'bad_stt');        // a real noisy upload that failed: NOT a classifier mistake
  await mk(null, null, 'ok');             // an ordinary call: no ground truth
  const cal = (await call('GET', '/calibration', { ws })).json;
  assert.equal(cal.total, 3);
  assert.equal(cal.correct, 2);
  assert.equal(cal.cleanRuns, 1);
  assert.equal(cal.faultRuns, 2);
  const mistakes = (await call('GET', '/calibration/mistakes', { ws })).json.mistakes;
  assert.deepEqual(mistakes.map((m: any) => m.injected_fault), ['bad_stt']);
});

test('a calibration run cannot be started twice at once', async () => {
  const ws = randomUUID();
  const [a, b] = await Promise.all([1, 2].map(() => call('POST', '/calibration/run', { ws, body: { sampleId: 'no-such-call.wav' } })));
  assert.deepEqual([a.status, b.status].sort(), [404, 404]); // both rejected for the unknown call, and neither left the workspace marked as running
  assert.equal((await call('GET', '/calibration', { ws })).json.running, false);
});

test('requests that are refused before anything runs do not use up the network\'s hourly allowance (found in review)', async () => {
  const ws = randomUUID();
  for (let i = 0; i < 16; i += 1) {
    const r = await call('POST', '/ab-tests', { ws: randomUUID(), body: { sampleId: 'no-such-call.wav', configA: {}, configB: {}, iterations: 5 } });
    assert.equal(r.status, 404, `refused request ${i} answered ${r.status}`);
  }
  const { resetIpUnits } = await import('../../src/abuse.js');
  resetIpUnits(); // start the next check from an empty hour, whatever the earlier tests used
  for (let i = 0; i < 12; i += 1) assert.notEqual((await call('POST', '/ab-tests', { ws: randomUUID(), body: { sampleId: 'no-such-call.wav', configA: {}, configB: {}, iterations: 5 } })).status, 429);
  assert.equal((await call('POST', '/healing-suggestions/generate', { ws })).status, 200, 'a real request still goes through afterwards');
});

// ------------------------------------------------------------------ blast radius, stage health, A/B list, calibration limits
async function insertMeasured(owner: string, o: { status: 'completed' | 'failed'; cost: number; injected?: string | null; category?: string; stages?: [string, string, number, number][] }) {
  const id = randomUUID();
  await query(
    `INSERT INTO calls (id, started_at, ended_at, status, input_source, owner_id, injected_fault, predicted_category, total_cost_usd)
     VALUES ($1, now(), now(), $2, 'sample', $3, $4, $5, $6)`,
    [id, o.status, owner, o.injected ?? null, o.category ?? (o.status === 'failed' ? 'timeout' : 'ok'), o.cost],
  );
  for (const [stage, provider, ms, cost] of o.stages ?? []) {
    await query(`INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, cost_usd) VALUES ($1,$2,$3,now(),now(),$4,'ok',$5)`, [id, stage, provider, ms, cost]);
  }
  createdCalls.push(id);
  return id;
}

test('blast radius: cost per call comes from healthy calls, the failure rate is the caller\'s, and the arithmetic is exact', async () => {
  const ws = randomUUID();
  await insertMeasured(ws, { status: 'completed', cost: 0.004 });
  await insertMeasured(ws, { status: 'completed', cost: 0.006 });
  // failures injected on purpose must not lower the cost of a call or set the failure rate
  for (let i = 0; i < 6; i += 1) await insertMeasured(ws, { status: 'failed', cost: 0.001, injected: 'network_drop', category: 'network_drop' });
  const r = (await call('POST', '/blast-radius', { ws, body: { callsPerDay: 1000, failureRatePct: 10 } })).json;
  assert.equal(r.basis, 'your_calls');
  assert.equal(r.sampleSize, 8);
  assert.equal(r.injectedInSample, 6);
  assert.ok(Math.abs(r.avgCallUsd - 0.005) < 1e-9, `avg healthy call ${r.avgCallUsd}`);
  assert.equal(r.monthlyCalls, 30000);
  assert.equal(r.monthlyFailures, 3000);
  assert.ok(Math.abs(r.monthlySpendUsd - 150) < 1e-6);
  assert.ok(Math.abs(r.wastedOnFailuresUsd - 3000 * 0.001) < 1e-6, `wasted ${r.wastedOnFailuresUsd}`); // what the failed calls actually cost
  assert.ok(Math.abs(r.retryCostUsd - 3000 * 0.005) < 1e-6);
  assert.deepEqual(r.byFault.map((f: any) => [f.faultType, f.n]), [['network_drop', 6]]);
  const higher = (await call('POST', '/blast-radius', { ws, body: { callsPerDay: 1000, failureRatePct: 20 } })).json;
  assert.equal(higher.monthlyFailures, 6000); // the rate is what the caller says, not what the workspace's injected calls suggest
  assert.equal((await call('POST', '/blast-radius', { ws, body: { callsPerDay: 1000, failureRatePct: 101 } })).status, 400);
  assert.equal((await call('POST', '/blast-radius', { ws, body: { callsPerDay: 0 } })).status, 400);
});

test('stage health leaves injected failures out and reports each stage against its limit', async () => {
  const ws = randomUUID();
  await insertMeasured(ws, { status: 'completed', cost: 0.004, stages: [['stt', 'deepgram', 800, 0.001], ['llm', 'openai', 1200, 0.00003], ['tts', 'openai', 1600, 0.002]] });
  await insertMeasured(ws, { status: 'completed', cost: 0.004, stages: [['stt', 'deepgram', 1000, 0.001], ['llm', 'openai', 1400, 0.00003], ['tts', 'openai', 1800, 0.002]] });
  await insertMeasured(ws, { status: 'failed', cost: 0.01, injected: 'timeout', stages: [['llm', 'openai', 13000, 0.00003]] }); // an injected delay must not distort the latency
  const { stages } = (await call('GET', '/sla/stages', { ws })).json;
  const llm = stages.find((x: any) => x.stage === 'llm');
  assert.equal(llm.n, 2);
  assert.equal(llm.maxMs, 1400);
  assert.equal(llm.limitMs, 8000);
  assert.equal(stages.find((x: any) => x.stage === 'stt').p50Ms, 900);
  const empty = (await call('GET', '/sla/stages', { ws: randomUUID() })).json.stages;
  assert.deepEqual(empty.map((x: any) => x.n), [0, 0, 0]);
});

test('the A/B list shows only the workspace\'s own comparisons, with their verdicts', async () => {
  const ws = randomUUID();
  const other = randomUUID();
  const mkRun = async (owner: string) => {
    const { rows } = await query(`INSERT INTO ab_runs (config_a, config_b, owner_id, sample_id, iterations) VALUES ('{}', '{}', $1, 'call-1-clean-baseline.wav', 2) RETURNING id`, [owner]);
    createdAbRuns.push(rows[0].id);
    return rows[0].id as string;
  };
  const mine = await mkRun(ws);
  await mkRun(other);
  for (const side of ['A', 'A', 'B', 'B']) {
    const id = await insertMeasured(ws, { status: 'completed', cost: side === 'A' ? 0.003 : 0.006 });
    await query('UPDATE calls SET ab_run_id=$1, ab_side=$2 WHERE id=$3', [mine, side, id]);
  }
  const { runs } = (await call('GET', '/ab-tests', { ws })).json;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, mine);
  assert.equal(runs[0].status, 'done');
  assert.ok(runs[0].headline);
  assert.deepEqual((await call('GET', '/ab-tests', { ws: randomUUID() })).json.runs, []);
});

test('calibration never reports 0% for a label it could not measure, and limits a run to three calls', async () => {
  const ws = randomUUID();
  await insertMeasured(ws, { status: 'failed', cost: 0.001, injected: 'timeout', category: 'timeout' });
  const cal = (await call('GET', '/calibration', { ws })).json;
  assert.equal(cal.perLabel.timeout.precision, 1);
  assert.equal(cal.perLabel.timeout.recall, 1);
  await insertMeasured(ws, { status: 'failed', cost: 0.001, injected: 'bad_stt', category: 'timeout' });
  const after = (await call('GET', '/calibration', { ws })).json;
  assert.equal(after.perLabel.bad_stt.precision, null); // never predicted: no precision, not "0%"
  assert.equal(after.perLabel.bad_stt.recall, 0);
  assert.equal((await call('POST', '/calibration/run', { ws, body: { sampleIds: [] } })).status, 400);
  assert.equal((await call('POST', '/calibration/run', { ws, body: { sampleIds: ['a.wav', 'b.wav', 'c.wav', 'd.wav'] } })).status, 400);
});
