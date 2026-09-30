import test from 'node:test';
import assert from 'node:assert/strict';
import { diarize, MIN_PITCH_DELTA_ST } from '../../src/analysis/diarize.js';
import { extractFrames } from '../../src/analysis/prosody.js';
import { DEMO_IDS, framesOf, scene, sttFixture, truthSegments } from '../helpers.js';

const TWO_VOICE = ['stress-03-older-male-slow-noisy-repeats-amount', 'stress-04-young-female-fast-interruptions', 'stress-09-frustrated-female-multi-intent-street', 'stress-10-max-stress-train-phone-multi-issue'];

// ---- real calls, real recogniser output, exact scripted speaker timeline
test('every one of the 19 demo calls gets the right number of voices (the recogniser alone gets 16)', () => {
  let ours = 0;
  let recogniser = 0;
  for (const id of DEMO_IDS) {
    const stt = sttFixture(id);
    const want = TWO_VOICE.includes(id) ? 2 : 1;
    const d = diarize(stt.words, framesOf(id));
    if (d.speakers === want) ours += 1; else assert.fail(`${id}: expected ${want} voices, got ${d.speakers} (${d.source})`);
    if (d.recognizer_speakers === want) recogniser += 1;
  }
  assert.equal(ours, 19);
  assert.ok(recogniser < ours, 'the acoustic check must add something over the recogniser');
});

test('word-level attribution on the two-voice calls is at least 95% and beats the recogniser', () => {
  for (const id of TWO_VOICE) {
    const stt = sttFixture(id);
    const truth = truthSegments(id) as NonNullable<ReturnType<typeof truthSegments>>;
    const d = diarize(stt.words, framesOf(id));
    const score = (labels: (number | null)[]) => {
      const pairs = stt.words.map((w, i) => {
        const mid = (w.start + w.end) / 2;
        const who = new Set(truth.filter((t) => mid >= t.start - 0.05 && mid <= t.end + 0.05).map((t) => t.who));
        return who.size === 1 ? [[...who][0], labels[i]] : null;
      }).filter((p): p is [string, number | null] => !!p && p[1] !== null);
      let best = 0;
      for (const r of ['agent', 'customer']) for (const l of [0, 1]) best = Math.max(best, pairs.filter((p) => (p[0] === r) === (p[1] === l)).length / pairs.length);
      return best;
    };
    const ours = score(d.words.map((w) => w.speaker));
    const theirs = score(stt.words.map((w) => (typeof w.speaker === 'number' ? w.speaker : null)));
    assert.ok(ours >= 0.95, `${id}: ${ours.toFixed(3)}`);
    assert.ok(ours >= theirs, `${id}: ours ${ours.toFixed(3)} vs recogniser ${theirs.toFixed(3)}`);
  }
});

test('voices are numbered in order of first appearance and typical pitch is reported', () => {
  const id = 'stress-09-frustrated-female-multi-intent-street';
  const d = diarize(sttFixture(id).words, framesOf(id));
  assert.equal(d.words[0].speaker, 0, 'the customer speaks first here');
  assert.equal(d.voice_pitch_hz.length, 2);
  assert.ok(d.voice_pitch_hz[0] > d.voice_pitch_hz[1] * 1.5, 'customer is the higher voice, the agent the lower one');
  assert.ok((d.pitch_gap_semitones ?? 0) >= MIN_PITCH_DELTA_ST);
});

test('no two-voice claim on any single-speaker call, including noisy, phone-band and expressive ones', () => {
  for (const id of DEMO_IDS.filter((x) => !TWO_VOICE.includes(x))) {
    const d = diarize(sttFixture(id).words, framesOf(id));
    assert.equal(d.speakers, 1, id);
    assert.equal(d.source, 'single_voice', id);
  }
});

// ---- synthetic scenes: the decision logic itself
test('two clearly different pitches are two voices, labelled by first appearance, even when the recogniser said one', () => {
  const s = scene([
    { f0: 110, start: 0.2, seconds: 3, text: 'thank you for calling how can I help' },
    { f0: 220, start: 3.5, seconds: 3, text: 'my order has not arrived yet at all' },
    { f0: 110, start: 7, seconds: 3, text: 'let me check that for you now sir' },
    { f0: 220, start: 10.5, seconds: 3, text: 'yes please the number is four nine one seven' },
  ]);
  const d = diarize(s.words.map((w) => ({ ...w, speaker: 0 })), extractFrames(s.pcm));
  assert.equal(d.speakers, 2);
  assert.equal(d.source, 'acoustic');
  assert.equal(d.recognizer_speakers, 1);
  const by = (from: number, to: number) => new Set(s.words.map((w, i) => (w.start >= from && w.end <= to ? d.words[i].speaker : -1)).filter((x) => x !== -1));
  assert.deepEqual([...by(0, 3.3)], [0]); assert.deepEqual([...by(3.5, 6.6)], [1]); assert.deepEqual([...by(7, 10.1)], [0]); assert.deepEqual([...by(10.5, 13.6)], [1]);
  assert.ok(d.notes.some((n) => /one speaker/.test(n)));
});

test('one voice whose pitch moves a little stays one voice', () => {
  const s = scene([
    { f0: 118, start: 0.2, seconds: 3, text: 'hello I am calling about my payment' },
    { f0: 132, start: 3.5, seconds: 3, text: 'it says pending in my banking app' },
    { f0: 124, start: 7, seconds: 3, text: 'the order number is nine two six seven one' },
  ]);
  assert.equal(diarize(s.words, extractFrames(s.pcm)).speakers, 1);
});

test('two voices with the SAME pitch cannot be separated: the result is one voice, and it says so when the recogniser found two', () => {
  const s = scene([
    { f0: 140, start: 0.2, seconds: 3, text: 'thank you for calling how can I help', speaker: 0 },
    { f0: 142, start: 3.5, seconds: 3, text: 'my order has not arrived yet at all', speaker: 1 },
    { f0: 140, start: 7, seconds: 3, text: 'let me check that for you now sir', speaker: 0 },
  ]);
  const d = diarize(s.words, extractFrames(s.pcm));
  assert.equal(d.source, 'recognizer', 'the recogniser labels are kept, not invented or overruled');
  assert.equal(d.speakers, 2);
  assert.ok(d.words.every((w) => w.confidence <= 0.5), 'and every label is marked low confidence');
  assert.ok(d.notes[0].includes('similar pitch'));
});

test('no decodable audio: only the recogniser labels are used, flagged as unverified', () => {
  const words = [{ word: 'hi', confidence: 1, start: 0, end: 0.3, speaker: 0 }, { word: 'there', confidence: 1, start: 0.3, end: 0.6, speaker: 1 }];
  const d = diarize(words, null);
  assert.equal(d.source, 'recognizer');
  assert.ok(d.notes[0].includes('not verified'));
  assert.equal(diarize([], null).speakers, 0);
});

test('a very quiet third source is marked background, not attributed to a speaker', () => {
  // recognisers give one word stream, so the announcement sits between the two people, not on top of them
  const s = scene([
    { f0: 110, start: 0.2, seconds: 3, text: 'thank you for calling how can I help', amp: 0.3 },
    { f0: 300, start: 3.6, seconds: 2, text: 'next stop central station.', amp: 0.012 },
    { f0: 220, start: 5.9, seconds: 3, text: 'my order has not arrived yet at all', amp: 0.3 },
    { f0: 110, start: 9, seconds: 3, text: 'let me check that for you now sir', amp: 0.3 },
    { f0: 220, start: 12.4, seconds: 3, text: 'yes please the number is four nine', amp: 0.3 },
  ]);
  const d = diarize(s.words, extractFrames(s.pcm));
  const announcement = ['next', 'stop', 'central', 'station.'];
  const bg = s.words.map((w, i) => (announcement.includes(w.word) ? d.words[i].background : null)).filter((x) => x !== null);
  assert.equal(bg.length, 4);
  assert.ok(bg.every(Boolean), 'the quiet announcement is background');
  assert.equal(d.words.filter((w, i) => !announcement.includes(s.words[i].word) && w.background).length, 0, 'no real word is flagged as background');
  assert.equal(new Set(d.words.filter((w) => !w.background).map((w) => w.speaker)).size, 2, 'the two people are still told apart');
});

test('a quiet line from a real voice (same pitch, lower level) is not treated as background', () => {
  const s = scene([
    { f0: 110, start: 0.2, seconds: 3, text: 'thank you for calling how can I help.', amp: 0.3 },
    { f0: 220, start: 3.6, seconds: 3, text: 'my order has not arrived yet at all.', amp: 0.3 },
    { f0: 110, start: 7, seconds: 3, text: 'let me check that for you now sir.', amp: 0.02 },
    { f0: 220, start: 10.4, seconds: 3, text: 'yes please the number is four nine.', amp: 0.3 },
    { f0: 110, start: 14, seconds: 3, text: 'I can see it here on the screen.', amp: 0.3 },
  ]);
  const d = diarize(s.words, extractFrames(s.pcm));
  assert.equal(d.words.filter((w) => w.background).length, 0);
});

test('too little clear speech: nothing is called background just because there is no reference level (found in review)', () => {
  // every phrase is short (under 0.3 s of pitch), so there is no reliable reference; the words must stay in the conversation
  const s = scene([
    { f0: 130, start: 0.2, seconds: 0.5, text: 'yes ok.', amp: 0.05 },
    { f0: 130, start: 1.2, seconds: 0.5, text: 'right sure.', amp: 0.05 },
    { f0: 130, start: 2.2, seconds: 0.5, text: 'thanks bye.', amp: 0.05 },
  ]);
  const d = diarize(s.words, extractFrames(s.pcm));
  assert.equal(d.words.filter((w) => w.background).length, 0);
});

test('every one-word pitch glitch in a long two-voice call is corrected, not only the first few (found in review)', () => {
  const lines: Parameters<typeof scene>[0] = [];
  let t = 0.2;
  for (let i = 0; i < 8; i += 1) {
    lines.push({ f0: 110, start: t, seconds: 1.4, text: 'let me look at' });
    t += 1.45;
    lines.push({ f0: 230, start: t, seconds: 0.3, text: 'that' }); // a glitch inside the sentence: this word sounds like the other voice
    t += 0.35;
    lines.push({ f0: 110, start: t, seconds: 1.2, text: 'for you now.' });
    t += 1.2 + 0.6;
    lines.push({ f0: 220, start: t, seconds: 2.4, text: 'yes that is the order I meant thanks.' });
    t += 2.4 + 0.6;
  }
  const s = scene(lines);
  const d = diarize(s.words, extractFrames(s.pcm));
  assert.equal(d.speakers, 2);
  const glitch = s.words.map((w, i) => (w.word === 'that' && i > 0 && s.words[i - 1].word === 'at' ? d.words[i].speaker : null)).filter((x) => x !== null);
  assert.equal(glitch.length, 8);
  assert.ok(glitch.every((x) => x === 0), `glitch words attributed to the other voice: ${glitch.join('')}`);
});
