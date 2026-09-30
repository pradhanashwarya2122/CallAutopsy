import test from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, numberAccuracy, numberTokens, strictTokens, wordErrorRate } from '../../src/analysis/wer.js';
import { sttFixture } from '../helpers.js';
import { loadManifest, scriptPlain } from '../../src/sampleLibrary.js';

test('WER: identical text is 0 and empty reference edge cases are defined', () => {
  assert.equal(wordErrorRate('hello there world', 'Hello, there world!').wer, 0);
  assert.deepEqual(wordErrorRate('', ''), { wer: 0, refWords: 0, substitutions: 0, deletions: 0, insertions: 0 });
  assert.equal(wordErrorRate('', 'anything').wer, 1);
});

test('WER: substitutions, deletions and insertions are counted exactly (hand-computed)', () => {
  // reference: a b c d
  const sub = wordErrorRate('a b c d', 'a x c d');
  assert.equal(sub.wer, 0.25); assert.equal(sub.substitutions, 1);
  const del = wordErrorRate('a b c d', 'a c d');
  assert.equal(del.wer, 0.25); assert.equal(del.deletions, 1);
  const ins = wordErrorRate('a b c d', 'a b x c d');
  assert.equal(ins.wer, 0.25); assert.equal(ins.insertions, 1);
  const mixed = wordErrorRate('the cat sat on the mat', 'the cat sit on mat today');
  assert.equal(mixed.refWords, 6);
  assert.equal(mixed.substitutions + mixed.deletions + mixed.insertions, 3); // sat->sit, the deleted, today inserted
  assert.equal(mixed.wer, 0.5);
});

test('editDistance parts always add up to the distance', () => {
  for (const [r, h] of [['a b c', 'x y'], ['one two three four', 'one four'], ['', 'a b'], ['a b', '']] as const) {
    const e = editDistance(r.split(' ').filter(Boolean), h.split(' ').filter(Boolean));
    assert.equal(e.substitutions + e.deletions + e.insertions, e.distance);
  }
});

test('strict WER keeps number formatting differences; normalized WER treats them as the same', () => {
  const ref = 'I paid forty-nine dollars sorry fifty-nine dollars';
  const hyp = 'I paid $49 sorry $59';
  assert.ok(wordErrorRate(ref, hyp, { strict: true }).wer > 0.3);
  assert.equal(wordErrorRate(ref, hyp).wer, 0);
});

test('normalization must not hide a genuinely wrong number', () => {
  assert.ok(wordErrorRate('the order is 4 8 2 1 3', 'the order is 48231').wer > 0);
  assert.ok(wordErrorRate('it costs forty-seven ninety-nine', 'it costs 4799').wer > 0); // merged digits are an error
  assert.equal(wordErrorRate('it costs forty-seven ninety-nine', 'it costs $47.99').wer, 0);
});

test('spoken numbers: "eight fifty" is 8 and 50, "twenty two ninety nine" is 22 and 99, digit-by-digit ids collapse', () => {
  assert.deepEqual(numberTokens('eight fifty'), ['8', '50']);
  assert.deepEqual(numberTokens('twenty-two ninety-nine'), ['22', '99']);
  assert.deepEqual(numberTokens('order 4 8 2 1 3'), ['48213']);
  assert.deepEqual(numberTokens('one hundred twenty-eight dollars fifty'), ['128', '50']);
});

test('digit strings spoken in separate sentences do not merge', () => {
  assert.deepEqual(numberTokens('It is 2 0 7 5 9. Two, oh, seven, five, nine.'), ['20759', '20759']);
  assert.deepEqual(numberTokens('3 8 5 2 0. No wait. 3 8 5 0 2'), ['38520', '38502']);
});

test('numberAccuracy reports expected, matched and extra numbers', () => {
  assert.deepEqual(numberAccuracy('order 4 8 2 1 3 total forty-seven ninety-nine', 'order 48213 total $47.99'), { expected: 3, matched: 3, extra: 0 });
  assert.deepEqual(numberAccuracy('it is twenty-two ninety-nine', 'it is 2299'), { expected: 2, matched: 0, extra: 1 });
});

test('strictTokens ignores case, punctuation and fillers only', () => {
  assert.deepEqual(strictTokens("Um, it's $49.50, OK?"), ["it's", '$49.50', 'ok']);
});

test('WER against the real recogniser output is reproducible and matches the recorded value', async () => {
  const manifest = await loadManifest();
  const script = (id: string) => scriptPlain(manifest.get(`${id}.wav`)) as string;
  assert.equal(wordErrorRate(script('call-1-clean-baseline'), sttFixture('call-1-clean-baseline').transcript).wer, 0);
  const s9 = 'stress-09-frustrated-female-multi-intent-street';
  const n = numberAccuracy(script(s9), sttFixture(s9).transcript);
  assert.equal(n.expected - n.matched, 2, 'the spoken "twenty-two ninety-nine" is transcribed as 2299, a real error that is not hidden');
  const again = wordErrorRate(script(s9), sttFixture(s9).transcript).wer;
  assert.equal(again, wordErrorRate(script(s9), sttFixture(s9).transcript).wer);
});
