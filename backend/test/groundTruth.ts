// What is actually in each bundled demo call, written from the scripts in samples/manifest.json (the exact words that were
// synthesised). The analysis benchmark scores the pipeline's output against this. Numbers are compared as digit strings.
//
// `emotion` and `vocal` describe the delivery each voice was INSTRUCTED to use when the speech was synthesised (see
// manifest voice.instructions). They test whether the measurements follow a known delivery style; they are not real human emotion.
import type { IntentLabel } from '../src/analysis/callUnderstanding.js';

export interface CallTruth {
  speakers: 1 | 2;
  intent: IntentLabel[]; // acceptable primary intents
  secondary?: IntentLabel[]; // every one of these must appear as an intent (primary or secondary)
  secondaryAnyOf?: IntentLabel[]; // at least one of these must appear
  customerNumbers: string[]; // numbers the customer said and that stand at the end of the call (digits only; 22.99 -> 2299)
  agentOnlyNumbers?: string[]; // numbers only the agent said: must never be reported as the customer's
  corrections?: { from: string; to: string }[];
  ambiguity?: boolean; // the customer left something unresolved
  emotion?: string[]; // acceptable lexical/overall emotions (styled delivery)
  vocalArousal?: 'high' | 'low'; // only where the styled delivery is unambiguous
  findings: string[]; // finding ids that must be present
  notFindings?: string[]; // finding ids that must be absent
}

const digits = (s: string) => s.replace(/\D/g, '');
void digits;

export const TRUTH: Record<string, CallTruth> = {
  'call-1-clean-baseline': { speakers: 1, intent: ['duplicate_charge'], customerNumbers: ['48213', '4799'], findings: [], notFindings: ['noise', 'noise_heavy', 'band_limited', 'overlap'] },
  'call-2-noisy-cafe': { speakers: 1, intent: ['pending_transaction', 'missing_order'], customerNumbers: ['73905', '62'], findings: ['noise_heavy'] },
  'call-3-mumbled-unsure': { speakers: 1, intent: ['duplicate_charge', 'unclear', 'other'], customerNumbers: ['48'], corrections: [{ from: '40', to: '48' }], ambiguity: true, findings: ['ambiguity'] },
  'call-4-long-multi-detail': { speakers: 1, intent: ['duplicate_charge'], secondary: ['missing_order'], customerNumbers: ['61824', '5340'], corrections: [{ from: '61842', to: '61824' }, { from: '4350', to: '5340' }], findings: ['corrections', 'band_limited'] },
  'call-5-failure-heavy-multi-intent': { speakers: 1, intent: ['duplicate_charge', 'failed_payment'], customerNumbers: ['92671', '850'], ambiguity: true, findings: ['multi_intent', 'ambiguity', 'band_limited'] },
  'stress-01-young-male-clear-baseline': { speakers: 1, intent: ['refund_request', 'subscription_charge'], customerNumbers: ['31074', '1999'], emotion: ['calm', 'neutral', 'not_evident'], findings: [], notFindings: ['noise', 'noise_heavy', 'band_limited', 'hesitation', 'overlap'] },
  'stress-02-middle-aged-female-hesitant-forgets-order': { speakers: 1, intent: ['missing_order', 'delivery_problem'], customerNumbers: ['52918'], corrections: [{ from: 'tuesday', to: 'wednesday' }], emotion: ['embarrassed', 'nervous', 'confused', 'not_evident'], findings: ['hesitation'] },
  'stress-03-older-male-slow-noisy-repeats-amount': { speakers: 2, intent: ['unauthorized_transaction', 'incorrect_charge', 'general_inquiry'], customerNumbers: ['2995'], emotion: ['confused', 'nervous', 'not_evident', 'calm'], findings: ['speakers'] },
  'stress-04-young-female-fast-interruptions': { speakers: 2, intent: ['pending_transaction', 'failed_payment'], customerNumbers: ['84160', '59'], corrections: [{ from: '49', to: '59' }], emotion: ['impatient', 'rushed', 'frustrated'], vocalArousal: 'high', findings: ['speakers', 'corrections'] },
  'stress-05-middle-aged-male-phone-static': { speakers: 1, intent: ['incorrect_charge'], customerNumbers: ['774021', '12850', '82'], emotion: ['calm', 'neutral', 'not_evident'], vocalArousal: 'low', findings: ['band_limited'] },
  'stress-06-young-female-busy-cafe-repeats': { speakers: 1, intent: ['pending_transaction', 'missing_order'], customerNumbers: ['66037', '3670'], emotion: ['rushed', 'distracted', 'impatient'], findings: ['noise'] },
  'stress-07-older-female-confused-corrections': { speakers: 1, intent: ['incorrect_charge', 'billing_account_issue'], customerNumbers: ['20759', '4680'], corrections: [{ from: '12', to: '14' }, { from: '48', to: '4680' }], emotion: ['confused', 'calm'], findings: ['corrections'] },
  'stress-08-nervous-male-long-pauses-ambiguous': { speakers: 1, intent: ['pending_transaction', 'failed_payment'], customerNumbers: [], ambiguity: true, emotion: ['nervous', 'confused', 'embarrassed'], findings: ['ambiguity', 'long_pauses'] },
  'stress-09-frustrated-female-multi-intent-street': { speakers: 2, intent: ['incorrect_charge', 'unauthorized_transaction'], secondary: ['duplicate_charge', 'missing_order'], customerNumbers: ['4917', '2299'], corrections: [{ from: '4821', to: '4917' }], emotion: ['frustrated', 'angry', 'impatient'], vocalArousal: 'high', findings: ['multi_intent', 'speakers', 'band_limited'] },
  'stress-10-max-stress-train-phone-multi-issue': { speakers: 2, intent: ['missing_order', 'delivery_problem'], secondaryAnyOf: ['duplicate_charge', 'failed_payment', 'refund_request'], customerNumbers: ['38502'], agentOnlyNumbers: ['41'], corrections: [{ from: '38520', to: '38502' }], ambiguity: true, emotion: ['frustrated', 'rushed', 'nervous', 'impatient', 'confused'], findings: ['noise_heavy', 'speakers', 'multi_intent'] },
};
