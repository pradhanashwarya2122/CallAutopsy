import test from 'node:test';
import assert from 'node:assert/strict';
import { bareAmountAmbiguities, detectSpokenCorrections, groundCorrections, groundEntities, groundFragments, valueInText, type Entities } from '../../src/analysis/grounding.js';
import { normalize } from '../../src/analysis/callUnderstanding.js';
import type { Turn } from '../../src/analysis/turns.js';

const E = (o: Partial<Entities>): Entities => ({ order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [], ...o });
const T = (speaker: number, text: string, uncertain = false): Turn => ({ speaker, start: 0, end: 1, text, confidence: uncertain ? 0.4 : 0.95, uncertain });

test('valueInText: digits, decimals, spoken numbers, ordinals and words', () => {
  assert.ok(valueInText('$59', 'I paid $49 sorry $59 and'));
  assert.ok(valueInText('46.80', 'It was $46.80. That is right'));
  assert.ok(valueInText('4917', 'the current order is 4917, and'));
  assert.ok(valueInText('14', 'no, the fourteenth. Yes'), 'a date said in words');
  assert.ok(valueInText('March 12th', 'charged on the March 12. Oh'));
  assert.ok(valueInText('twenty-nine', 'it is for 29 dollars'));
  assert.equal(valueInText('49.59', 'I paid $49 sorry $59'), false, 'merged numbers are not in the transcript');
  assert.equal(valueInText('4821', 'the order is 4917'), false);
  assert.ok(valueInText('last Friday', 'Oh, it was on, let me think, last Friday I believe.'));
  assert.equal(valueInText('', 'x'), false);
});

test('valueInText: a price written as two numbers matches, but not numbers that are far apart or only part-present', () => {
  assert.ok(valueInText('36 70', 'It is order 6 6 0 3 7 and the amount was 36 70'));
  assert.ok(valueInText('$36.70', 'and the amount was 36 70'));
  assert.equal(valueInText('36 70', 'the order is 36 and the ref is 4970'), false, 'the numbers are not next to each other');
  assert.equal(valueInText('36 75', 'the amount was 36 70'), false);
});

test('valueInText: a date needs its words as well as its digits (found in review)', () => {
  assert.equal(valueInText('March 5th', 'I waited 5 minutes for order 5'), false, 'a stray 5 does not make a date');
  assert.ok(valueInText('March 5th', 'it was on the march 5. I think'));
  assert.ok(valueInText('$59', 'I paid $59'), 'plain amounts are unaffected');
  assert.ok(valueInText('ORD-4917', 'my order id is ord 4917'));
});

test('groundEntities drops values that are not in the transcript', () => {
  const g = groundEntities(E({ amounts: ['$59', '$49.59'], order_ids: ['84160', '99999'] }), [T(0, 'order 84160 I paid $49 sorry $59')], 0, true);
  assert.deepEqual(g.customer.amounts, ['$59']);
  assert.deepEqual(g.customer.order_ids, ['84160']);
  assert.deepEqual(g.dropped.sort(), ['$49.59', '99999'].sort());
});

test('groundEntities attributes values to the speaker whose turn contains them', () => {
  const turns = [T(0, 'my order is 38502'), T(1, 'I can see a payment of forty-one dollars'), T(0, 'and I got charged twice')];
  const g = groundEntities(E({ order_ids: ['38502'], amounts: ['41'] }), turns, 0, true);
  assert.deepEqual(g.customer.order_ids, ['38502']);
  assert.deepEqual(g.agent_stated.amounts, ['41'], 'a value only the other speaker said is not credited to the customer');
  assert.deepEqual(g.customer.amounts, []);
});

test('groundEntities: a value said by both speakers stays with the customer', () => {
  const turns = [T(0, 'the order is 4917'), T(1, 'so that is order 4917')];
  assert.deepEqual(groundEntities(E({ order_ids: ['4917'] }), turns, 0, true).customer.order_ids, ['4917']);
});

test('groundEntities does not claim attribution it cannot support', () => {
  const turns = [T(0, 'order 4917')];
  assert.deepEqual(groundEntities(E({ order_ids: ['4917'] }), turns, null, true).unverified.order_ids, ['4917']);
  assert.deepEqual(groundEntities(E({ order_ids: ['4917'] }), turns, 0, false).unverified.order_ids, ['4917']);
  assert.deepEqual(groundEntities(E({ order_ids: ['4917'] }), [T(0, 'order 4917', true)], 0, true).unverified.order_ids, ['4917']);
});

test('corrections are kept only when both values were said', () => {
  const turns = [T(0, 'It was $48. No. Sorry. $46.80.')];
  const r = groundCorrections([{ original: '$48', corrected: '$46.80' }, { original: '$50', corrected: '$46.80' }], turns);
  assert.equal(r.kept.length, 1); assert.equal(r.dropped, 1);
});

test('fragments the model calls off-topic must be quoted verbatim from the transcript', () => {
  const t = 'I need help. Next stop is central station. My order is 4917.';
  assert.deepEqual(groundFragments(['Next stop is central station', 'invented announcement'], t), ['Next stop is central station']);
});

test('a bare 4-digit amount is always flagged for confirmation, a written one is not', () => {
  assert.equal(bareAmountAmbiguities(['2299'], "It's 2299. It came out on Monday.").length, 1);
  assert.match(bareAmountAmbiguities(['2299'], "It's 2299.")[0], /\$22\.99/);
  assert.equal(bareAmountAmbiguities(['2299'], 'It was $2299 in total').length, 0);
  assert.equal(bareAmountAmbiguities(['1500'], 'about 1500 dollars').length, 0);
  assert.deepEqual(bareAmountAmbiguities(['59'], 'it was 59'), [], 'only 4-digit bare amounts are ambiguous');
  assert.match(bareAmountAmbiguities(['36 70'], 'the amount was 36 70')[0], /\$36\.70/, 'dollars and cents written as two numbers');
});

test('spoken corrections are found from the wording, without inventing any', () => {
  assert.deepEqual(detectSpokenCorrections('It says 40... No. 48 something, I believe.').map((c) => [c.original, c.corrected]), [['40', '48']]);
  assert.deepEqual(detectSpokenCorrections('I paid $49, sorry, $59, and it still says pending.').map((c) => [c.original, c.corrected]), [['$49', '$59']]);
  assert.equal(detectSpokenCorrections('Call me at 5 no thanks, my order is 4821 and the total is 30').length, 0, 'different magnitudes are not a correction');
  assert.equal(detectSpokenCorrections('order 4821 and then 4917 later').length, 0, 'no correction word, no correction');
});

test('normalize: an invented merged amount is removed and reported, real corrections survive', () => {
  const turns = [T(0, 'order 84160, I paid $49 sorry $59, and it still says pending')];
  const u = normalize({
    summary: 's', customer_speaker: 1, primary_intent: { label: 'pending_transaction' }, entities: { order_ids: ['84160'], amounts: ['$49.59'] },
    corrections: [{ field: 'amount', original: '$49', corrected: '$59' }], lexical_tone: { emotion: 'nervous' },
  }, turns, { speakers: 1, reliable: true });
  assert.deepEqual(u.entities.amounts, []);
  assert.equal(u.dropped_unverified, 1);
  assert.equal(u.corrections.length, 1);
});

test('normalize: model tone defaults to "not evident", never to a guessed emotion', () => {
  const u = normalize({ summary: 's', primary_intent: { label: 'other' }, lexical_tone: { emotion: 'ecstatic' } }, [T(0, 'hello')], { speakers: 1, reliable: true });
  assert.equal(u.lexical_tone.emotion, 'not_evident');
});

test('normalize: the customer is only chosen when the model named a real speaker; two voices with none named stay unattributed', () => {
  const turns = [T(0, 'order 4917'), T(1, 'thanks')];
  const u = normalize({ summary: 's', customer_speaker: 7, primary_intent: { label: 'other' }, entities: { order_ids: ['4917'] } }, turns, { speakers: 2, reliable: true });
  assert.equal(u.customer_speaker, null);
  assert.deepEqual(u.unverified_speaker.order_ids, ['4917']);
  assert.deepEqual(u.entities.order_ids, []);
});

test('normalize: issues enumerated with a real quote become further intents; invented quotes do not', () => {
  const turns = [T(0, 'I was charged for something I did not order. I think I was also charged twice for it.')];
  const u = normalize({ summary: 's', primary_intent: { label: 'incorrect_charge' }, issues: [{ label: 'incorrect_charge', quote: 'charged for something I did not order' }, { label: 'duplicate_charge', quote: 'also charged twice' }, { label: 'missing_order', quote: 'never arrived at all' }] }, turns, { speakers: 1, reliable: true });
  assert.deepEqual(u.secondary_intents.map((i) => i.label), ['duplicate_charge']);
});
