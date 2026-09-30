import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings, rateDifficulty } from '../../src/analysis/findings.js';
import { analyzeCall } from '../../src/analysis/index.js';
import type { LlmJson } from '../../src/analysis/callUnderstanding.js';
import { sttOutcome, wavBuffer } from '../helpers.js';

const fakeLlm = (extra: object = {}): LlmJson => async () => ({ promptTokens: 100, completionTokens: 50, content: JSON.stringify({
  summary: 'x', customer_speaker: 1, issues: [], primary_intent: { label: 'other', description: '' }, secondary_intents: [], intent_confidence: 'high',
  entities: { order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [] }, corrections: [], lexical_tone: { emotion: 'not_evident', valence: 'unclear', intensity: 'low', evidence: '' },
  established_facts: [], ambiguities: [], repetitions: [], late_information: [], off_topic_speech: [], next_steps: [], escalate: false, ...extra,
}) });

test('the clean baseline call has no findings and is Easy', async () => {
  const a = await analyzeCall(sttOutcome('stress-01-young-male-clear-baseline'), wavBuffer('stress-01-young-male-clear-baseline'), fakeLlm());
  assert.deepEqual(a.findings.map((f) => f.id), []);
  assert.equal(a.difficulty.label, 'Easy');
});

test('the phone-static call reports its own audio problems with the numbers behind them', async () => {
  const a = await analyzeCall(sttOutcome('stress-05-middle-aged-male-phone-static'), wavBuffer('stress-05-middle-aged-male-phone-static'), fakeLlm());
  const ids = a.findings.map((f) => f.id);
  assert.ok(ids.includes('band_limited') && ids.includes('noise'));
  assert.match(a.findings.find((f) => f.id === 'band_limited')?.detail ?? '', /dB/);
});

test('two-voice calls report the speakers, how they were found and the mono-recording limit', async () => {
  const id = 'stress-04-young-female-fast-interruptions';
  const a = await analyzeCall(sttOutcome(id), wavBuffer(id), fakeLlm());
  const f = new Map(a.findings.map((x) => [x.id, x]));
  assert.ok(f.has('speakers') && f.get('speakers')?.detail.includes('Hz'));
  assert.ok(f.has('overlap_limited'));
  assert.equal(a.attribution.reliable, true);
  assert.equal(a.attribution.speakers, 2);
});

test('the analysis object carries attribution, boundaries, voices and the three tone readings', async () => {
  const id = 'stress-09-frustrated-female-multi-intent-street';
  const a = await analyzeCall(sttOutcome(id), wavBuffer(id), fakeLlm({ lexical_tone: { emotion: 'frustrated', valence: 'negative', intensity: 'medium', evidence: "I'm pretty fed up" } }));
  assert.equal(a.version, 2);
  assert.equal(a.attribution.source, 'acoustic');
  assert.ok(a.turns.some((t) => t.speaker === 1));
  assert.equal(a.voices.length, 2);
  assert.equal(a.tone.lexical?.emotion, 'frustrated');
  assert.ok(a.tone.vocal);
  assert.ok(a.tone.overall.basis);
});

test('without decodable audio the analysis says speaker labels are unverified and attributes no entities', async () => {
  const id = 'stress-03-older-male-slow-noisy-repeats-amount';
  const a = await analyzeCall({ ...sttOutcome(id), words: sttOutcome(id).words.map((w, i) => ({ ...w, speaker: i % 40 < 20 ? 0 : 1 })) }, Buffer.from('mp3 bytes, not a wav'), fakeLlm({ entities: { order_ids: [], transaction_ids: [], amounts: ['29.95'], dates: [], other: [] } }));
  assert.equal(a.signal, null);
  assert.equal(a.attribution.reliable, false);
  assert.ok(a.findings.some((f) => f.id === 'attribution_uncertain'));
  assert.deepEqual(a.understanding?.entities.amounts, [], 'not credited to the customer when who said it cannot be verified');
});

test('a model failure never fails the analysis: measurements survive and the error is recorded', async () => {
  const boom: LlmJson = async () => { throw new Error('rate limited'); };
  const a = await analyzeCall(sttOutcome('call-1-clean-baseline'), wavBuffer('call-1-clean-baseline'), boom);
  assert.equal(a.understanding, null);
  assert.match(a.understanding_error ?? '', /rate limited/);
  assert.ok(a.speech.word_count > 0);
  assert.ok(a.signal);
});

test('difficulty follows the weight of the findings', () => {
  assert.equal(rateDifficulty([]).label, 'Easy');
  assert.equal(rateDifficulty([{ id: 'a', severity: 'warn', area: 'audio', title: '', detail: '' }, { id: 'b', severity: 'warn', area: 'audio', title: '', detail: '' }, { id: 'c', severity: 'info', area: 'audio', title: '', detail: '' }]).label, 'Moderate');
  const many = Array.from({ length: 5 }, (_, i) => ({ id: String(i), severity: 'issue' as const, area: 'audio' as const, title: '', detail: '' }));
  assert.equal(rateDifficulty(many).label, 'Severe');
});

test('off-topic speech and dropped details become findings', () => {
  const f = buildFindings({
    speech: { duration_s: 10, word_count: 20, words_per_minute: 150, avg_confidence: 0.97, low_confidence_words: [], low_confidence_ratio: 0, filler_count: 0, pause_count: 0, long_pause_count: 0, longest_pause_s: 0, speakers: 1, turn_count: 1, overlap_count: 0, overlap_s: 0, interruption_count: 0, backchannel_count: 0 },
    signal: null, sttProvider: 'deepgram', diarization: null, turns: { turns: [], background: [{ start: 1, end: 2, text: 'next stop central' }], boundaries: [], overlap_visibility: 'not_applicable' }, customerVoice: null, attributionReliable: true,
    understanding: { off_topic_speech: ['mind the gap'], dropped_unverified: 2, corrections: [], ambiguities: [], secondary_intents: [], repetitions: [], late_information: [], intent_confidence: 'high', primary_intent: { label: 'other', description: '' } } as any,
  });
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('background_speech') && ids.includes('ungrounded'));
});

test('two voices, customer not identified, only one voice measured: that voice is not assumed to be the customer (found in review)', async () => {
  const { scene } = await import('../helpers.js');
  const s = scene([
    { f0: 110, start: 0.2, seconds: 6, text: 'thank you for calling how can I help you today. I see your order is on its way.' },
    { f0: 230, start: 6.4, seconds: 1.2, text: 'ok thanks.' },
    { f0: 110, start: 8, seconds: 4, text: 'is there anything else I can do for you today sir.' },
  ]);
  const stt = { transcript: 'x', words: s.words, audioDurationSec: s.total, provider: 'deepgram' as const, avgConfidence: 0.9, rawMeta: {}, failoverOccurred: false };
  const a = await analyzeCall(stt, (await import('../helpers.js')).toWav(s.pcm.samples), fakeLlm({ customer_speaker: null }));
  if (a.attribution.speakers === 2) {
    assert.equal(a.tone.vocal, null, 'no voice reading is attributed to an unidentified customer');
    assert.ok(!a.findings.some((f) => /customer's voice/.test(f.detail)));
  }
});
