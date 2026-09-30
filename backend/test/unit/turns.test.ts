import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTurns } from '../../src/analysis/turns.js';
import { diarize, type Diarization } from '../../src/analysis/diarize.js';
import { DEMO_IDS, framesOf, sttFixture, truthSegments } from '../helpers.js';

const W = (word: string, start: number, end: number) => ({ word, confidence: 0.95, start, end });
const D = (speakers: number[], conf = 0.9): Diarization => ({ speakers: 2, source: 'acoustic', pitch_gap_semitones: 10, voice_pitch_hz: [110, 220], recognizer_speakers: 1, agreement: null, notes: [], words: speakers.map((s) => ({ speaker: s, confidence: conf, background: false })) });

test('a normal hand-over after a finished sentence is a transition', () => {
  const words = [W('Thank', 0, 0.3), W('you', 0.3, 0.5), W('for', 0.5, 0.7), W('calling.', 0.7, 1.2), W('Hi', 1.6, 1.8), W('there.', 1.8, 2.2)];
  const t = buildTurns(words, D([0, 0, 0, 0, 1, 1]), '');
  assert.equal(t.boundaries.length, 1);
  assert.equal(t.boundaries[0].kind, 'transition');
});

test('a sentence that stops without an ending, taken over at once, is an interruption with evidence and confidence', () => {
  const words = [W('And', 0, 0.2), W('can', 0.2, 0.4), W('you', 0.4, 0.6), W('confirm', 0.6, 1.0), W('the', 1.0, 1.1), W('Sorry.', 1.15, 1.6), W('Go', 1.6, 1.8), W('ahead.', 1.8, 2.2)];
  const t = buildTurns(words, D([0, 0, 0, 0, 0, 1, 1, 1]), '');
  const b = t.boundaries[0];
  assert.equal(b.kind, 'interruption');
  assert.ok(b.confidence >= 0.6 && b.confidence <= 0.9);
  assert.ok(b.evidence.length >= 2 && b.evidence.some((e) => /stops without an ending/.test(e)));
});

test('word timestamps that overlap between speakers are simultaneous speech, with high confidence', () => {
  const words = [W('So', 0, 0.3), W('the', 0.3, 0.5), W('order', 0.5, 1.2), W('Yeah', 1.0, 1.5), W('sorry', 1.5, 2.0)];
  const t = buildTurns(words, D([0, 0, 0, 1, 1]), '');
  assert.equal(t.boundaries[0].kind, 'simultaneous');
  assert.equal(t.boundaries[0].overlap_s, 0.2);
  assert.ok(t.boundaries[0].confidence >= 0.9);
  assert.equal(t.overlap_visibility, 'timestamps');
});

test('a short acknowledgement while the other person carries on is a backchannel', () => {
  const words = [W('I', 0, 0.1), W('paid', 0.1, 0.4), W('for', 0.4, 0.6), W('it', 0.6, 0.8), W('yesterday', 0.8, 1.4), W('Okay.', 1.5, 1.8), W('and', 1.9, 2.0), W('then', 2.0, 2.2), W('it', 2.2, 2.3), W('failed.', 2.3, 2.8)];
  const t = buildTurns(words, D([0, 0, 0, 0, 0, 1, 0, 0, 0, 0]), '');
  assert.ok(t.boundaries.some((b) => b.kind === 'backchannel'));
});

test('uncertain attribution caps confidence and is stated in the evidence', () => {
  const words = [W('And', 0, 0.2), W('can', 0.2, 0.4), W('you', 0.4, 0.6), W('confirm', 0.6, 1.0), W('the', 1.0, 1.1), W('Sorry.', 1.15, 1.6)];
  const t = buildTurns(words, D([0, 0, 0, 0, 0, 1], 0.3), '');
  assert.ok(t.boundaries[0].confidence <= 0.4);
  assert.ok(t.boundaries[0].evidence.some((e) => /uncertain/.test(e)));
  assert.ok(t.turns.every((x) => x.uncertain));
});

test('mono, two voices, no overlap seen: visibility is "limited" and one voice is "not applicable"', () => {
  const words = [W('Hi.', 0, 0.3), W('Hello.', 0.6, 1)];
  assert.equal(buildTurns(words, D([0, 1]), '').overlap_visibility, 'limited');
  assert.equal(buildTurns(words, { ...D([0, 0]), speakers: 1 }, '').overlap_visibility, 'not_applicable');
});

test('background words are kept out of the conversation and reported separately', () => {
  const words = [W('Hi', 0, 0.3), W('next', 0.4, 0.6), W('stop', 0.6, 0.9), W('there', 1.0, 1.3)];
  const d = D([0, 0, 0, 0]);
  d.words[1] = { speaker: null, confidence: 0, background: true };
  d.words[2] = { speaker: null, confidence: 0, background: true };
  const t = buildTurns(words, d, '');
  assert.equal(t.turns.map((x) => x.text).join(' '), 'Hi there');
  assert.equal(t.background[0].text, 'next stop');
});

test('empty input gives no turns; text without timings becomes one uncertain-free turn', () => {
  assert.deepEqual(buildTurns([], null, '').turns, []);
  assert.equal(buildTurns([], null, 'just text').turns[0].text, 'just text');
});

// ---- the recorded benchmark: precision must stay perfect and recall must not fall below what was measured
test('interruption benchmark on the scripted calls: no false alarms, and at least 3 of the 10 scripted events are found', () => {
  let tp = 0; let fp = 0; let events = 0;
  for (const id of DEMO_IDS.filter((x) => truthSegments(x))) {
    const truth = truthSegments(id) as NonNullable<ReturnType<typeof truthSegments>>;
    const stt = sttFixture(id);
    const ta = buildTurns(stt.words, diarize(stt.words, framesOf(id)), stt.transcript);
    const ev: number[] = [];
    truth.forEach((t, i) => {
      if (i > 0 && t.who !== truth[i - 1].who && t.start < truth[i - 1].end - 0.05) ev.push(t.start);
      if (i < truth.length - 1 && /[—-]$/.test(t.text.trim()) && truth[i + 1].who !== t.who) ev.push(truth[i + 1].start);
    });
    events += ev.length;
    const det = ta.boundaries.filter((b) => b.kind === 'simultaneous' || b.kind === 'interruption');
    const used = new Set<number>();
    for (const e of ev) { const j = det.findIndex((b, k) => !used.has(k) && Math.abs(b.at - e) <= 1.5); if (j >= 0) { used.add(j); tp += 1; } }
    fp += det.length - used.size;
  }
  assert.equal(events, 10);
  assert.equal(fp, 0, 'false alarms');
  assert.ok(tp >= 3, `found ${tp} of ${events}`);
});
