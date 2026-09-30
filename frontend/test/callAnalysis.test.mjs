import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CallAnalysisPanels, { Findings, Turns, Understanding, voiceName } from '../src/components/CallAnalysis.jsx';

// Fixtures are real analysis objects: real speech-to-text output, the real audio, and the real language model.
const fx = (id) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', `${id}.json`), 'utf8'));
const html = (el) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const S4 = fx('stress-04-young-female-fast-interruptions');
const S9 = fx('stress-09-frustrated-female-multi-intent-street');
const S10 = fx('stress-10-max-stress-train-phone-multi-issue');
const S1 = fx('stress-01-young-male-clear-baseline');

test('the understanding panel shows intent, details, corrections and ambiguities from the analysis', () => {
  const t = text(React.createElement(Understanding, { analysis: S9 }));
  assert.match(t, /incorrect charge/);
  assert.match(t, /4917/);
  assert.match(t, /4821/); // shown as the old value of a correction
  assert.match(t, /Corrections/);
  assert.match(t, /2299/);
  assert.match(t, /\$22\.99/); // the ambiguity about the bare 4-digit amount
});

test('tone is shown as three separate readings, with confidence and the reason', () => {
  const t = text(React.createElement(Understanding, { analysis: S9 }));
  assert.match(t, /From the words/);
  assert.match(t, /From the voice/);
  assert.match(t, /Overall/);
  assert.match(t, /never averaged into one claim/);
  assert.match(t, /confidence/);
});

test('a noisy call shows that the voice reading was withheld instead of guessing', () => {
  const t = text(React.createElement(Understanding, { analysis: S10 }));
  assert.match(t, /too noisy/i);
  assert.match(t, /no clear reading/);
});

test('a value only the other voice said is shown under its own heading, not as the customer\'s detail', () => {
  const t = text(React.createElement(Understanding, { analysis: S10 }));
  assert.match(t, /Said only by the other voice/);
  const customerPart = t.split('Said only by the other voice')[0];
  assert.ok(!/Amounts\s+41/.test(customerPart), 'the agent\'s $41 is not listed as a customer detail');
  assert.match(t.split('Said only by the other voice')[1], /41/);
});

test('when who spoke cannot be verified, details are listed as "who said it is unclear"', () => {
  const a = structuredClone(S4);
  a.attribution = { ...a.attribution, reliable: false, source: 'recognizer', notes: ['Speaker labels could not be verified.'] };
  a.understanding.unverified_speaker = { ...a.understanding.entities };
  a.understanding.entities = { order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [] };
  const t = text(React.createElement(Understanding, { analysis: a }));
  assert.match(t, /who said it is unclear/);
});

test('the transcript labels voices, marks uncertain lines and shows interruption evidence', () => {
  const h = html(React.createElement(Turns, { analysis: S4 }));
  assert.match(h, /Customer|Voice 1/);
  assert.match(h, /Other voice|Voice 2/);
  assert.match(h, /interruption at [\d.]+ s · confidence \d+%/);
  const uncertain = structuredClone(S4);
  uncertain.turns[1].uncertain = true;
  assert.match(html(React.createElement(Turns, { analysis: uncertain })), /\(\?\)/);
});

test('background speech is shown apart from the conversation', () => {
  const a = structuredClone(S1);
  a.background = [{ start: 3, end: 5, text: 'next stop central station' }];
  const t = text(React.createElement(Turns, { analysis: a }));
  assert.match(t, /Background, not part of the call: “next stop central station”/);
});

test('a single voice is just "Caller": no speaker labels are invented', () => {
  assert.equal(voiceName(S1, 0), 'Caller');
  const t = text(React.createElement(Turns, { analysis: S1 }));
  assert.ok(!/Customer:|Voice 1:|Other voice/.test(t));
});

test('voice names come from the analysis: the customer is only named when identified', () => {
  assert.equal(voiceName({ attribution: { speakers: 2 }, understanding: { customer_speaker: 1 } }, 1), 'Customer');
  assert.equal(voiceName({ attribution: { speakers: 2 }, understanding: { customer_speaker: 1 } }, 0), 'Other voice');
  assert.equal(voiceName({ attribution: { speakers: 2 }, understanding: { customer_speaker: null } }, 0), 'Voice 1');
});

test('findings show the audio condition, bandwidth, per-voice measurements and the evidence for interruptions', () => {
  const t = text(React.createElement(Findings, { analysis: S4 }));
  assert.match(t, /What we noticed/);
  assert.match(t, /Difficulty:/);
  assert.match(t, /Audio condition/);
  assert.match(t, /Bandwidth/);
  assert.match(t, /Customer|Voice 1|Other voice/);
  assert.match(t, /pitch about \d+ Hz/);
  assert.match(t, /Overlapping speech may be hidden|Interruption evidence/);
});

test('a clean call says so instead of inventing findings', () => {
  const t = text(React.createElement(Findings, { analysis: S1 }));
  assert.match(t, /No audio or speech problems detected/);
  assert.match(t, /Difficulty: Easy/);
});

test('no understanding: an honest message, and nothing about intent', () => {
  const empty = text(React.createElement(Understanding, { analysis: { understanding: null, understanding_error: 'empty transcript' } }));
  assert.match(empty, /No speech was recognised/);
  const failed = text(React.createElement(Understanding, { analysis: { understanding: null, understanding_error: 'timeout' } }));
  assert.match(failed, /could not be analyzed/);
  assert.equal(html(React.createElement(CallAnalysisPanels, { analysis: null })), '');
});

test('old stored analyses (before speakers and tone existed) still render without inventing anything', () => {
  const legacy = { version: 1, turns: [{ speaker: 0, start: 0, end: 1, text: 'hello there' }], speech: { duration_s: 5, word_count: 2, words_per_minute: 100, avg_confidence: 0.9, filler_count: 0, pause_count: 0, longest_pause_s: 0, speakers: 1 }, signal: null, findings: [], difficulty: { label: 'Easy', score: 0 },
    understanding: { summary: 's', primary_intent: { label: 'other', description: '' }, secondary_intents: [], intent_confidence: 'low', entities: { order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [] }, corrections: [], sentiment: { emotion: 'calm', intensity: 'low', evidence: '' }, established_facts: [], ambiguities: [], repetitions: [], late_information: [], next_steps: [], escalate: false } };
  const t = text(React.createElement(CallAnalysisPanels, { analysis: legacy }));
  assert.match(t, /Tone was not assessed/);
  assert.ok(!/undefined|NaN|null/.test(t), t);
});

test('nothing renders "undefined", "NaN" or "null" for any real analysis', () => {
  for (const a of [S1, S4, S9, S10, fx('call-2-noisy-cafe')]) {
    const t = text(React.createElement(CallAnalysisPanels, { analysis: a })) + text(React.createElement(Turns, { analysis: a }));
    assert.ok(!/undefined|NaN|\bnull\b/.test(t), t.match(/.{30}(undefined|NaN|null).{30}/)?.[0]);
  }
});
