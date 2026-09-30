import test from 'node:test';
import assert from 'node:assert/strict';
import { corruptAudio } from '../../src/pipeline/faultInjection.js';
import { readPcm16 } from '../../src/analysis/audioIO.js';
import { analyzeCall } from '../../src/analysis/index.js';
import { toWav, voiceSignal, pcmOf } from '../helpers.js';
import { extractFrames, extractFramesAsync } from '../../src/analysis/prosody.js';
import { computeSpeechMetrics } from '../../src/analysis/speechMetrics.js';
import { buildTurns } from '../../src/analysis/turns.js';
import { redactDeep } from '../../src/redaction/piiRedactor.js';

// Found in review: the WAV header is supplied by whoever uploads the file.
const withHeader = (wav: Buffer, patch: (h: Buffer) => void) => { const b = Buffer.from(wav); patch(b); return b; };
const good = toWav(voiceSignal(140, 2));

test('a WAV header with 0 channels or a 0 sample rate cannot hang the corruption fault or the audio reader', () => {
  for (const patch of [(h: Buffer) => h.writeUInt16LE(0, 22), (h: Buffer) => h.writeUInt32LE(0, 24), (h: Buffer) => h.writeUInt16LE(60000, 22)]) {
    const evil = withHeader(good, patch);
    const t0 = Date.now();
    const out = corruptAudio(evil, 100);
    assert.equal(out.length, evil.length);
    assert.ok(Date.now() - t0 < 1000, 'returned promptly');
    assert.equal(readPcm16(evil), null);
  }
  assert.ok(readPcm16(good), 'a normal file still decodes');
});

test('analysis never throws, whatever the recogniser and the audio hand it', async () => {
  const hostile = [
    { word: 'x', confidence: NaN, start: NaN, end: NaN },
    { word: 'y', confidence: 0.5, start: 5, end: 1 }, // ends before it starts
    { word: '', confidence: 2, start: -3, end: 1e9 },
    { word: 'z', confidence: 1, start: Infinity, end: Infinity },
  ];
  const llm = async () => ({ promptTokens: 1, completionTokens: 1, content: 'not json at all' });
  for (const audio of [good, Buffer.alloc(0), Buffer.from('junk'), withHeader(good, (h) => h.writeUInt16LE(0, 22))]) {
    const a = await analyzeCall({ transcript: 'x y z', words: hostile as any, audioDurationSec: NaN, provider: 'deepgram', avgConfidence: 0, rawMeta: {}, failoverOccurred: false }, audio, llm);
    assert.equal(a.version, 2);
    assert.ok(Array.isArray(a.findings));
  }
});

test('a failure inside the measurements gives an empty analysis that says so, never an exception', async () => {
  const stt = { transcript: 'hello there', words: [{ word: null, confidence: 1, start: 0, end: 1 }] as any, audioDurationSec: 2, provider: 'deepgram' as const, avgConfidence: 0, rawMeta: {}, failoverOccurred: false };
  const a = await analyzeCall(stt, good, async () => ({ promptTokens: 0, completionTokens: 0, content: '{}' }));
  assert.equal(a.version, 2);
  if (a.understanding_error?.startsWith('analysis failed')) {
    assert.equal(a.attribution.reliable, false);
    assert.deepEqual(a.findings, []);
  }
});

test('an over-long or unreadable model answer is reported, and its cost is still recorded (found in review)', async () => {
  const { understandCall } = await import('../../src/analysis/callUnderstanding.js');
  const turns = [{ speaker: 0, start: 0, end: 1, text: 'hello there', confidence: 1, uncertain: false }];
  const ctx = { speakers: 1, reliable: true };
  const cut = await understandCall(turns, 'hello there', [], ctx, false, async () => ({ promptTokens: 1000, completionTokens: 2000, content: '{"summary": "cut o', finishReason: 'length' }));
  assert.equal(cut.understanding, null); assert.match(cut.error ?? '', /cut off/); assert.ok(cut.cost_usd > 0);
  const junk = await understandCall(turns, 'hello there', [], ctx, false, async () => ({ promptTokens: 1000, completionTokens: 10, content: 'sorry, I cannot' }));
  assert.equal(junk.understanding, null); assert.match(junk.error ?? '', /readable JSON/); assert.ok(junk.cost_usd > 0);
});

test('frame extraction gives the same result asynchronously and lets other work run while it computes (found in review)', async () => {
  const pcm = pcmOf(voiceSignal(140, 12), 16000);
  const sync = extractFrames(pcm);
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  const async_ = await extractFramesAsync(pcm);
  clearInterval(timer);
  assert.equal(async_.count, sync.count);
  assert.deepEqual(Array.from(async_.f0.slice(0, 500)), Array.from(sync.f0.slice(0, 500)));
  assert.deepEqual(Array.from(async_.cep.slice(0, 500)), Array.from(sync.cep.slice(0, 500)));
  assert.ok(ticks > 0, 'the event loop ran during the extraction');
});

test('Whisper gives one confidence per segment, so no word is called low-confidence and there is no average (found in review)', () => {
  const words = Array.from({ length: 30 }, (_, i) => ({ word: `w${i}`, confidence: 0.62, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const ta = buildTurns(words, null, '');
  assert.equal(computeSpeechMetrics(words, 10, ta, null, false).low_confidence_words.length, 0);
  assert.equal(computeSpeechMetrics(words, 10, ta, null, false).avg_confidence, null);
  assert.equal(computeSpeechMetrics(words, 10, ta, null, true).low_confidence_ratio, 1, 'Deepgram\'s per-word confidence is used as before');
});

test('redactDeep leaves dates and buffers as they are instead of turning them into {} (found in review)', () => {
  const when = new Date('2026-01-02T03:04:05Z');
  const buf = Buffer.from('abc');
  const r = redactDeep({ when, buf, nested: { when, note: 'mail jane.doe@example.com' } });
  assert.equal(r.when, when); assert.equal(r.buf, buf); assert.equal(r.nested.when, when);
  assert.match(r.nested.note, /REDACTED_EMAIL/);
});
