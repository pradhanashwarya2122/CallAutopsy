import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSideRuns, decideAbWinner, type SideRuns } from '../../src/abTesting/verdict.js';

const side = (o: Partial<SideRuns> = {}): SideRuns => ({ n: 3, failed: 0, wer: [0.05, 0.05, 0.05], latencyS: [5, 5.1, 4.9], costUsd: [0.004, 0.004, 0.004], failovers: 0, ...o });

test('identical sides: no winner', () => {
  const v = decideAbWinner(side(), side(), true);
  assert.equal(v.winner, 'tie');
  assert.equal(v.metrics.every((m) => m.better === 'none'), true);
});

test('fewer than two runs per side: insufficient, whatever the numbers say', () => {
  assert.equal(decideAbWinner(side({ n: 1, wer: [0.5] }), side({ n: 1, wer: [0.01] }), true).winner, 'insufficient');
  assert.equal(decideAbWinner(side(), side({ n: 1 }), true).winner, 'insufficient');
});

test('a real, consistent transcript-accuracy gap wins on quality', () => {
  const v = decideAbWinner(side({ wer: [0.09, 0.09, 0.09] }), side({ wer: [0.03, 0.03, 0.03] }), true);
  assert.equal(v.winner, 'B');
  assert.match(v.headline, /quality/);
});

test('a small gap or overlapping runs is noise, not a winner', () => {
  assert.equal(decideAbWinner(side({ wer: [0.05, 0.06, 0.05] }), side({ wer: [0.06, 0.05, 0.06] }), true).winner, 'tie', 'gap below 3 points');
  const overlapping = decideAbWinner(side({ wer: [0.02, 0.12, 0.05] }), side({ wer: [0.09, 0.06, 0.1] }), true);
  assert.equal(overlapping.metrics.find((m) => m.id === 'accuracy')?.better, 'none', 'A ranges 0.02-0.12, B 0.06-0.10: the runs overlap');
});

test('one failed run out of three is not a real difference; half or more is', () => {
  assert.equal(decideAbWinner(side({ failed: 1 }), side(), true).metrics.find((m) => m.id === 'failures')?.better, 'none');
  const v = decideAbWinner(side({ n: 4, failed: 2 }), side({ n: 4 }), true);
  assert.equal(v.metrics.find((m) => m.id === 'failures')?.better, 'B');
  assert.equal(v.winner, 'B');
});

test('quality outranks speed and cost, and the trade-off is said out loud', () => {
  const v = decideAbWinner(side({ wer: [0.02, 0.02, 0.02], latencyS: [9, 9, 9], costUsd: [0.02, 0.02, 0.02] }), side({ wer: [0.08, 0.08, 0.08] }), true);
  assert.equal(v.winner, 'A');
  assert.ok(v.caveats.some((c) => /lower-priority/.test(c)));
});

test('conflicting quality measures are a trade-off, not a winner', () => {
  const v = decideAbWinner(side({ n: 4, failed: 2, wer: [0.01, 0.01, 0.01] }), side({ n: 4, wer: [0.08, 0.08, 0.08] }), true);
  assert.equal(v.winner, 'tradeoff');
});

test('speed and cost only decide when quality ties, and only with a practical gap', () => {
  const faster = decideAbWinner(side({ latencyS: [3, 3.1, 2.9] }), side({ latencyS: [6, 6.1, 5.9] }), true);
  assert.equal(faster.winner, 'A'); assert.match(faster.headline, /faster/);
  const tiny = decideAbWinner(side({ latencyS: [5.0, 5.1, 5.2] }), side({ latencyS: [5.2, 5.3, 5.4] }), true);
  assert.equal(tiny.winner, 'tie');
  const mixed = decideAbWinner(side({ latencyS: [3, 3, 3] }), side({ costUsd: [0.001, 0.001, 0.001], latencyS: [6, 6, 6] }), true);
  assert.equal(mixed.winner, 'tradeoff');
});

test('without a reference script accuracy is not compared, and the verdict says so', () => {
  const v = decideAbWinner(side(), side(), false);
  assert.equal(v.metrics.some((m) => m.id === 'accuracy'), false);
  assert.ok(v.caveats.some((c) => /no reference script/i.test(c)));
});

test('a silent provider fallback is disclosed', () => {
  const v = decideAbWinner(side({ failovers: 2 }), side(), true);
  assert.ok(v.caveats.some((c) => /fell back/.test(c)));
});

test('the same inputs always give the same verdict (reproducible)', () => {
  const a = side({ wer: [0.1, 0.11, 0.1] }); const b = side({ wer: [0.03, 0.04, 0.03] });
  assert.deepEqual(decideAbWinner(a, b, true), decideAbWinner(a, b, true));
});

test('a call that failed early does not make its side look faster or cheaper (found in review)', () => {
  const calls = [
    { id: 'a', status: 'completed', total_cost_usd: 0.004, analysis: { script_match: { wer: 0.05 } } },
    { id: 'b', status: 'failed', total_cost_usd: 0.0005, analysis: { script_match: { wer: 0.4 } } }, // stopped early: tiny time and cost
    { id: 'c', status: 'completed', total_cost_usd: 0.0042, analysis: null },
  ];
  const r = buildSideRuns(calls, new Map([['a', 5], ['b', 0.4], ['c', 5.2]]));
  assert.equal(r.n, 3); assert.equal(r.failed, 1);
  assert.deepEqual(r.latencyS, [5, 5.2]);
  assert.deepEqual(r.costUsd, [0.004, 0.0042]);
  assert.deepEqual(r.wer, [0.05, 0.4], 'transcript accuracy still counts every run that produced a transcript');
});
