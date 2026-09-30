import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTtsInput, TTS_MAX_CHARS } from '../../src/pipeline/tts.js';
import { ttsDurationMismatch } from '../../src/classifier/ttsQuality.js';

// Found by the live fault benchmark: a hallucinating model at temperature 1.5 wrote a reply over the API's 4096-character limit,
// the speech stage crashed, and the call was diagnosed as an unrelated "exception".
test('a normal reply is spoken as it is', () => {
  assert.deepEqual(prepareTtsInput('Sure, I can help with that.'), { input: 'Sure, I can help with that.', truncated: false });
  assert.equal(prepareTtsInput('   ').input, '.', 'an empty reply still gives the API something valid');
});

test('a runaway reply is cut below the limit, at a sentence end, and flagged', () => {
  const long = 'This is a sentence about your order. '.repeat(400);
  const r = prepareTtsInput(long);
  assert.equal(r.truncated, true);
  assert.ok(r.input.length <= TTS_MAX_CHARS && r.input.length > TTS_MAX_CHARS * 0.9);
  assert.match(r.input, /order\.$/);
  const noBreaks = prepareTtsInput('word '.repeat(2000));
  assert.ok(noBreaks.truncated && noBreaks.input.length <= TTS_MAX_CHARS);
});

test('the duration check compares a cut reply with what was actually sent, so the cut is not read as a glitch', () => {
  const sent = 4000;
  const res = { audio: Buffer.alloc(5000), bytes: 5000, approxDurationSec: sent / 15, model: 'tts-1', charCount: sent, truncated: true };
  const source = 'x'.repeat(9000);
  assert.equal(ttsDurationMismatch(res, source), true, 'against the full reply it would look like a glitch');
  assert.equal(ttsDurationMismatch(res, source.slice(0, TTS_MAX_CHARS)), false);
});
