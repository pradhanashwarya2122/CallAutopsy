import test from 'node:test';
import assert from 'node:assert/strict';
import { redactDeep, redactPII } from '../../src/redaction/piiRedactor.js';
import { analyzeCall } from '../../src/analysis/index.js';
import { normalize, promptFor } from '../../src/analysis/callUnderstanding.js';
import { buildTurns } from '../../src/analysis/turns.js';
import type { LlmJson } from '../../src/analysis/callUnderstanding.js';
import { scene, toWav } from '../helpers.js';

const SECRETS = ['jane.doe@example.com', '4111 1111 1111 1111', '415-555-0132', '123-45-6789', 'four one five five five five zero one three two'];

test('redactPII removes e-mail, card, SSN, phone and long spoken digit runs', () => {
  const text = `mail jane.doe@example.com card 4111 1111 1111 1111 phone 415-555-0132 ssn 123-45-6789 spoken ${SECRETS[4]} done`;
  const out = redactPII(text);
  for (const s of SECRETS) assert.ok(!out.toLowerCase().includes(s), `still contains ${s}`);
  assert.match(out, /\[REDACTED_EMAIL\]/); assert.match(out, /\[REDACTED_CARD\]/); assert.match(out, /\[REDACTED_SSN\]/); assert.match(out, /\[REDACTED_PHONE\]/); assert.match(out, /\[REDACTED_NUMBER\]/);
});

test('redactPII leaves order numbers, amounts and short digit strings alone', () => {
  const t = 'order 84160 total $47.99 reference 3 1 0 7 4 on 2026-09-30 and 1234567';
  assert.equal(redactPII(t), t);
});

test('regression: an order number said twice is not a phone number (it was redacted away in the live run of stress call 07)', () => {
  for (const t of ["Yes. It's 20759. 20759. That's the one.", "It's 2 0 7 5 9. 2 0 7 5 9. Right.", 'order 84160. 84160 again, and 31074, 31074', 'reference 3 8 5 2 0. 3 8 5 2 0. No wait. 3 8 5 0 2', 'It is two oh seven five nine. Two oh seven five nine.', 'order 84160 31074 4799 refund']) {
    assert.equal(redactPII(t), t, t);
  }
});

test('real phone numbers and cards are still redacted in every usual form, including at the end of a sentence', () => {
  for (const t of ['call 415-555-0132.', 'call (415) 555 0132 please', 'call +1 415 555 0132', 'it is 415.555.0132 thanks', 'card 4111111111111111 ok', 'card 4111 1111 1111 1111.', 'card 5500-0000-0000-0004', 'my number is four one five five five five zero one three two, thanks']) {
    assert.match(redactPII(t), /\[REDACTED_(PHONE|CARD|NUMBER)\]/, t);
    assert.ok(!/4\d{2}[- .)]*5\d{2}|4111|5500/.test(redactPII(t)), redactPII(t));
  }
});

test('international and bracketed phone formats are redacted whatever the group sizes (found in review)', () => {
  for (const n of ['+91 98765 43210', '+44 7911123456', '+1 4155550132', '(415) 5550132', '0171 12345678', '415 5550132']) {
    assert.equal(redactPII(`call ${n} please`), 'call [REDACTED_PHONE] please', n);
  }
});

test('redactDeep reaches every string in nested objects and arrays and does not touch keys or numbers', () => {
  const o = { a: 'x jane.doe@example.com', n: 5, list: ['415-555-0132', { deep: 'card 4111 1111 1111 1111' }], keep: null };
  const r = redactDeep(o);
  assert.equal(JSON.stringify(r).includes('example.com'), false);
  assert.equal(JSON.stringify(r).includes('555-0132'), false);
  assert.equal(JSON.stringify(r).includes('4111'), false);
  assert.equal(r.n, 5); assert.equal(r.keep, null);
  assert.equal(redactPII(redactPII(SECRETS[1])), redactPII(SECRETS[1]), 'idempotent');
});

// The regression that matters: whichever path the text takes through the analysis, raw sensitive content never comes out.
test('analysis output never contains raw PII, even when the language model echoes it back', async () => {
  const line = `my email is ${SECRETS[0]} and my card is ${SECRETS[1]} and call me on ${SECRETS[2]} thanks`;
  const s = scene([{ f0: 130, start: 0.2, seconds: 8, text: line }]);
  let prompt = '';
  const llm: LlmJson = async (_sys, user) => {
    prompt = user;
    return { promptTokens: 10, completionTokens: 10, content: JSON.stringify({
      summary: `The customer gave ${SECRETS[0]} and ${SECRETS[1]}.`, customer_speaker: 1, issues: [{ label: 'other', quote: SECRETS[2] }],
      primary_intent: { label: 'other', description: `Call back on ${SECRETS[2]}` }, secondary_intents: [], intent_confidence: 'low',
      entities: { order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [SECRETS[3], SECRETS[0]] }, corrections: [], lexical_tone: { emotion: 'not_evident', valence: 'unclear', intensity: 'low', evidence: SECRETS[0] },
      established_facts: [`Card ${SECRETS[1]}`], ambiguities: [], repetitions: [], late_information: [], off_topic_speech: [], next_steps: [`Phone ${SECRETS[2]}`], escalate: false,
    }) };
  };
  const stt = { transcript: line, words: s.words, audioDurationSec: s.total, provider: 'deepgram' as const, avgConfidence: 0.95, rawMeta: {}, failoverOccurred: false };
  const a = await analyzeCall(stt, toWav(s.pcm.samples), llm);
  const json = JSON.stringify(a).toLowerCase();
  for (const secret of SECRETS.slice(0, 4)) assert.ok(!json.includes(secret.toLowerCase()), `stored analysis leaks ${secret}`);
  for (const secret of SECRETS.slice(0, 4)) assert.ok(!prompt.toLowerCase().includes(secret.toLowerCase()), `the language model was sent ${secret}`);
});

test('the prompt built for the model is made from already redacted turns', () => {
  const ta = buildTurns([{ word: 'card', confidence: 1, start: 0, end: 0.3 }, { word: 'x', confidence: 1, start: 0.3, end: 0.6 }], null, '');
  const p = promptFor(ta.turns.map((t) => ({ ...t, text: redactPII('card 4111 1111 1111 1111') })), 'card 4111 1111 1111 1111', [], { speakers: 1, reliable: true }, false);
  assert.ok(!p.includes('4111'));
});

test('normalize redacts every free-text field the model returns', () => {
  const turns = [{ speaker: 0, start: 0, end: 1, text: 'hello', confidence: 1, uncertain: false }];
  const u = normalize({ summary: SECRETS[0], primary_intent: { label: 'other', description: SECRETS[2] }, ambiguities: [SECRETS[1]], next_steps: [SECRETS[3]], lexical_tone: { emotion: 'calm', evidence: SECRETS[0] } }, turns, { speakers: 1, reliable: true });
  const json = JSON.stringify(u);
  for (const s of SECRETS.slice(0, 4)) assert.ok(!json.includes(s));
});
