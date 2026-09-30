import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { attachPunctuation, parseWhisperResponse } from '../../src/pipeline/stt/whisper.js';
import { diarize } from '../../src/analysis/diarize.js';
import { buildTurns } from '../../src/analysis/turns.js';
import { computeSpeechMetrics } from '../../src/analysis/speechMetrics.js';
import { framesOf, ROOT, truthSegments } from '../helpers.js';

// Real Whisper responses (word + segment timestamps) recorded by bench/capture-whisper.ts.
const raw = (id: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/whisper', `${id}.json`), 'utf8'));
const IDS = ['stress-02-middle-aged-female-hesitant-forgets-order', 'stress-04-young-female-fast-interruptions', 'stress-09-frustrated-female-multi-intent-street', 'stress-10-max-stress-train-phone-multi-issue'];

test('Whisper words are parsed with timings and a confidence taken from their segment', () => {
  for (const id of IDS) {
    const r = parseWhisperResponse(raw(id));
    assert.equal(r.provider, 'whisper');
    assert.ok(r.words.length > 40, id);
    assert.ok(r.words.every((w) => typeof w.start === 'number' && typeof w.end === 'number' && (w.end as number) >= (w.start as number)));
    assert.ok(r.words.every((w) => w.confidence >= 0 && w.confidence <= 1));
    assert.ok(r.words.every((w) => w.speaker === undefined), 'Whisper gives no speaker labels');
    assert.equal(r.rawMeta.wordCount, r.words.length);
    for (let i = 1; i < r.words.length; i += 1) assert.ok((r.words[i].start as number) >= (r.words[i - 1].start as number) - 0.05, 'in order');
  }
});

test('sentence-ending punctuation is put back on Whisper words, because turns are split on it', () => {
  const r = parseWhisperResponse(raw('stress-09-frustrated-female-multi-intent-street'));
  const ends = r.words.filter((w) => /[.?!]$/.test(w.word)).length;
  const inText = (r.transcript.match(/[.?!](\s|$)/g) ?? []).length;
  assert.ok(inText >= 4 && ends >= Math.floor(inText * 0.8), `${ends} of ${inText} sentence ends kept`);
  assert.equal(r.words.map((w) => w.word).join(' ').replace(/\s+/g, ' ').slice(0, 30), r.transcript.replace(/\s+/g, ' ').slice(0, 30), 'and the words still read like the transcript');
});

test('attachPunctuation copes with words it cannot find', () => {
  const words = [{ word: 'hello' }, { word: 'zzz' }, { word: 'world' }];
  assert.deepEqual(attachPunctuation(words, 'Hello, world.').map((w) => w.word), ['hello,', 'zzz', 'world.']);
});

test('a response without word timings degrades to no words, not an exception', () => {
  const r = parseWhisperResponse({ text: 'hello there', duration: 2, segments: [] });
  assert.deepEqual(r.words, []);
  assert.equal(r.transcript, 'hello there');
});

test('speaker separation works on Whisper output too: one voice stays one, two voices are found', () => {
  const want: Record<string, number> = { [IDS[0]]: 1, [IDS[1]]: 2, [IDS[2]]: 2, [IDS[3]]: 2 };
  for (const id of IDS) {
    const r = parseWhisperResponse(raw(id));
    const d = diarize(r.words, framesOf(id));
    assert.equal(d.speakers, want[id], `${id}: ${d.source} ${d.notes.join(' ')}`);
  }
});

test('word-level attribution on Whisper words is at least 90% on the two-voice calls', () => {
  for (const id of IDS.slice(1)) {
    const r = parseWhisperResponse(raw(id));
    const truth = truthSegments(id) as NonNullable<ReturnType<typeof truthSegments>>;
    const d = diarize(r.words, framesOf(id));
    const pairs = r.words.map((w, i) => {
      const mid = ((w.start as number) + (w.end as number)) / 2;
      const who = new Set(truth.filter((t) => mid >= t.start - 0.1 && mid <= t.end + 0.1).map((t) => t.who));
      return who.size === 1 ? [[...who][0], d.words[i].speaker] : null;
    }).filter((p): p is [string, number | null] => !!p && p[1] !== null);
    let best = 0;
    for (const role of ['agent', 'customer']) for (const l of [0, 1]) best = Math.max(best, pairs.filter((p) => (p[0] === role) === (p[1] === l)).length / pairs.length);
    assert.ok(best >= 0.9, `${id}: ${best.toFixed(3)}`);
  }
});

test('pauses, fillers and pace are available from Whisper output, so hesitation is still measured after a failover', () => {
  const id = IDS[0];
  const r = parseWhisperResponse(raw(id));
  const d = diarize(r.words, framesOf(id));
  const m = computeSpeechMetrics(r.words, 35, buildTurns(r.words, d, r.transcript), d);
  assert.ok(m.words_per_minute !== null && m.words_per_minute > 60);
  assert.ok(m.pause_count >= 3);
});
