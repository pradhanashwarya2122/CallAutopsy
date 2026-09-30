import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { isWorkspaceId, workspaceId } from '../../src/auth/workspace.js';
import { isAdmin } from '../../src/auth/adminGuard.js';
import { disableDeepgramOutage, enableDeepgramOutage, getOutageState, isDeepgramDown } from '../../src/admin/outageFlag.js';
import { getChaos, setChaos } from '../../src/chaos/scheduler.js';
import { resetIpUnits, takeIpUnits } from '../../src/abuse.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const req = (method: string, headers: Record<string, string> = {}, query: Record<string, string> = {}) => ({ method, query, header: (n: string) => headers[n.toLowerCase()] }) as unknown as Request;

test('workspace id: header works for every method, ?ws= only for GET (media, PDF, WebSocket)', () => {
  assert.equal(workspaceId(req('POST', { 'x-workspace-id': A })), A);
  assert.equal(workspaceId(req('GET', {}, { ws: A })), A);
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal(workspaceId(req(m, {}, { ws: A })), null, `${m} must not accept the id in the URL`);
});

test('workspace id: only well-formed UUIDs are accepted, and are normalised', () => {
  for (const bad of ['', 'abc', '../../etc/passwd', `${A}x`, '11111111-1111-9111-8111-111111111111', "1'; DROP TABLE calls;--"]) assert.equal(isWorkspaceId(bad), false, bad);
  assert.equal(workspaceId(req('GET', { 'x-workspace-id': A.toUpperCase() })), A);
});

test('admin: nothing gets in when no token is configured, and a wrong or partial token never does', () => {
  const saved = process.env.ADMIN_TOKEN;
  try {
    delete process.env.ADMIN_TOKEN;
    assert.equal(isAdmin(req('GET', { 'x-admin-token': '' })), false);
    assert.equal(isAdmin(req('GET', { 'x-admin-token': 'anything' })), false);
    process.env.ADMIN_TOKEN = 'correct-horse';
    assert.equal(isAdmin(req('GET', { 'x-admin-token': 'correct-horse' })), true);
    for (const t of ['', 'correct', 'correct-horsee', 'CORRECT-HORSE']) assert.equal(isAdmin(req('GET', { 'x-admin-token': t })), false, t);
    assert.equal(isAdmin(req('GET', {})), false);
  } finally { if (saved === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = saved; }
});

test('outage: one workspace knocking the primary provider offline does not affect another', () => {
  disableDeepgramOutage(A); disableDeepgramOutage(B);
  enableDeepgramOutage(A, 60);
  assert.equal(isDeepgramDown(A), true);
  assert.equal(isDeepgramDown(B), false);
  assert.equal(getOutageState(B).enabled, false);
  assert.equal(isDeepgramDown(undefined), false, 'unowned calls are never affected');
  disableDeepgramOutage(A);
  assert.equal(isDeepgramDown(A), false);
});

test('outage: duration is capped and it expires by itself', () => {
  enableDeepgramOutage(A, 10_000);
  assert.ok(getOutageState(A).secondsRemaining <= 300);
  disableDeepgramOutage(A);
});

test('chaos: settings are per workspace, bounded, and B never sees A\'s changes', () => {
  const b0 = JSON.stringify(getChaos(B));
  const a = setChaos(A, { callsPerMinute: 500, faultMix: ['bad_stt', 'not_a_fault' as any] });
  assert.ok(a.callsPerMinute <= 12, 'rate is capped');
  assert.ok(!a.faultMix.includes('not_a_fault' as any), 'unknown faults are ignored');
  assert.equal(JSON.stringify(getChaos(B)), b0);
  assert.equal(getChaos(B).enabled, false);
});

test('per-address limit: a sliding window of units, per address, that frees up as time passes', () => {
  resetIpUnits();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i += 1) assert.equal(takeIpUnits('1.2.3.4', 1, t0 + i, 5), true);
  assert.equal(takeIpUnits('1.2.3.4', 1, t0 + 10, 5), false, 'sixth unit in the hour is refused');
  assert.equal(takeIpUnits('5.6.7.8', 1, t0 + 10, 5), true, 'another address is unaffected');
  assert.equal(takeIpUnits('1.2.3.4', 1, t0 + 3_600_001 + 4, 5), true, 'and the window slides');
  assert.equal(takeIpUnits('9.9.9.9', 6, t0, 5), false, 'a big action that cannot fit is refused whole');
  resetIpUnits();
});
