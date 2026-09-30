import OpenAI from 'openai';
import 'dotenv/config';
import { redactPII } from '../redaction/piiRedactor.js';
import { llmCost } from '../cost/pricing.js';
import { bareAmountAmbiguities, detectSpokenCorrections, ENTITY_KEYS, groundCorrections, groundEntities, groundFragments, type Entities } from './grounding.js';
import type { Turn } from './turns.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
export const UNDERSTANDING_MODEL = 'gpt-4o-mini';

export const INTENT_LABELS = [
  'duplicate_charge', 'failed_payment', 'pending_transaction', 'missing_order', 'refund_request',
  'incorrect_charge', 'subscription_charge', 'delivery_problem', 'billing_account_issue',
  'unauthorized_transaction', 'general_inquiry', 'other', 'unclear',
] as const;
export type IntentLabel = (typeof INTENT_LABELS)[number];

export interface Intent { label: IntentLabel; description: string }
export interface LexicalTone { emotion: string; valence: 'negative' | 'neutral' | 'positive' | 'mixed' | 'unclear'; intensity: 'low' | 'medium' | 'high'; evidence: string }
export interface Understanding {
  summary: string;
  customer_speaker: number | null; // 0-based, same numbering as the turns
  primary_intent: Intent;
  secondary_intents: Intent[];
  intent_confidence: 'high' | 'medium' | 'low';
  entities: Entities; // said by the customer
  agent_stated: Entities; // said only by the other speaker
  unverified_speaker: Entities; // in the transcript, speaker cannot be established
  corrections: { field: string; original: string; corrected: string }[];
  lexical_tone: LexicalTone; // judged from the words only
  established_facts: string[];
  ambiguities: string[];
  repetitions: string[];
  late_information: string[];
  off_topic_speech: string[]; // fragments that are not part of the call (announcements, TV, other people)
  next_steps: string[];
  escalate: boolean;
  dropped_unverified: number; // extracted details that were not in the transcript and were removed
}
export interface UnderstandingResult {
  understanding: Understanding | null;
  error?: string;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
}

export const SYSTEM = `You analyze ONE customer-support phone call from a speech-to-text transcript. The transcript may contain recognition errors, filler words, restarts and speaker mix-ups. Return ONLY a JSON object.

Rules:
- Use only what was actually said. Never invent order numbers, amounts, dates, causes or outcomes. Use null or [] when something was not stated.
- Speakers are labelled "Speaker 1", "Speaker 2". The labels come from automatic voice analysis; a line marked "(speaker uncertain)" may have the wrong label, so do not rely on who said it. The customer is whoever reports the problem; set customer_speaker to that speaker's number (as shown), or null if unclear.
- Details (entities) you list must be things the CUSTOMER said. Details only the agent said do not belong there.
- If the customer corrects themselves about ANYTHING (an amount, an order number, a date, a quantity), the CORRECTED value is the final one. Put the corrected value in entities where it is a number or date, and record every change in corrections (field, original, corrected), for example a date given as "the twelfth... no, the fourteenth" or a quantity "two phone cases, sorry, three".
- established_facts: only things the customer clearly stated as fact. Do NOT put guesses or uncertain claims there.
- ambiguities: contradictions, uncertainty or unresolved states the customer expressed (for example "not sure whether the payment failed or is pending"). Say what is unclear; do not resolve it for them.
- repetitions: details the customer repeated. late_information: important details the customer only revealed late in the call.
- issues: FIRST list every distinct problem or request the customer raises, one entry each, with a label from the intent set below and a short exact quote (copied word for word) that shows it. Then choose primary_intent (the main one) and put the rest in secondary_intents.
- primary_intent.label must be one of: ${INTENT_LABELS.join(', ')}. Use "unclear" if the request cannot be determined. secondary_intents lists EVERY other distinct problem or request the customer raises (same label set), excluding the primary one. Count a problem even when the customer is unsure about it ("I think I was also charged twice" is a duplicate_charge; "an extra fee I don't recognise" is an incorrect_charge; a wish for money back is a refund_request; an order that never showed up is a missing_order) and note the uncertainty under ambiguities.
- lexical_tone: judge ONLY from the customer's words, never from how the voice sounds (you cannot hear it). emotion is one of: calm, confused, frustrated, impatient, nervous, embarrassed, rushed, distracted, relieved, angry, neutral, not_evident. Use not_evident when the wording does not show an emotion; do not guess. valence is negative, neutral, positive, mixed or unclear. evidence quotes the words that show it.
- Numbers: never merge separate numbers into one value. A correction such as "forty-nine dollars, sorry, fifty-nine dollars" or "$49 sorry, dollars 59" means the amount is 59 (record the change under corrections), not 49.59 or 4959. Keep spoken digit strings as one order/transaction number. If the amount of a charge is written as a bare 4-digit number (for example "It's 2299"), it may be a price that was spoken as "twenty-two ninety-nine" ($22.99): put it in amounts exactly as heard ("2299", not "22.99") AND add an ambiguities entry saying it may be $22.99 and should be confirmed. Two numbers side by side where one price is expected (for example "the amount was 36 70") are probably dollars and cents: list them in amounts exactly as heard ("36 70") and add an ambiguities entry saying it may be $36.70. Every number that the customer says as an amount, order number, transaction number or date belongs in entities; if the transcript looks garbled around a number (for example "sixty two hours" where a price is expected), mention the doubt under ambiguities.
- off_topic_speech: exact quotes (copied word for word) of fragments that are NOT part of this conversation, such as station announcements, a television, other people talking nearby, or noise transcribed as words. Empty if there are none. Ignore them when extracting details.
- next_steps: 2 to 4 concrete actions a support agent should take. Include clarifying questions where the facts are not established. Do not assume unverified facts.
- If the transcript is empty, unintelligible or not a support call, say so in summary and use primary_intent.label "unclear".
- escalate is true only for signs of fraud, an account takeover, a legal threat or severe distress.

JSON shape:
{"summary": string (2-3 sentences), "customer_speaker": number|null, "issues": [{"label": string, "quote": string}], "primary_intent": {"label": string, "description": string}, "secondary_intents": [{"label": string, "description": string}], "intent_confidence": "high"|"medium"|"low", "entities": {"order_ids": string[], "transaction_ids": string[], "amounts": string[], "dates": string[], "other": string[]}, "corrections": [{"field": string, "original": string, "corrected": string}], "lexical_tone": {"emotion": string, "valence": string, "intensity": "low"|"medium"|"high", "evidence": string}, "established_facts": string[], "ambiguities": string[], "repetitions": string[], "late_information": string[], "off_topic_speech": string[], "next_steps": string[], "escalate": boolean}`;

const EMOTIONS = new Set(['calm', 'confused', 'frustrated', 'impatient', 'nervous', 'embarrassed', 'rushed', 'distracted', 'relieved', 'angry', 'neutral', 'not_evident']);
const VALENCE = ['negative', 'neutral', 'positive', 'mixed', 'unclear'];

const str = (v: unknown, max = 400): string => (typeof v === 'string' ? redactPII(v.trim()).slice(0, max) : '');
const strList = (v: unknown, n = 8): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, n) : []);
const intent = (v: any): Intent => ({
  label: (INTENT_LABELS as readonly string[]).includes(v?.label) ? v.label : 'other',
  description: str(v?.description),
});
const level = (x: unknown, allowed: string[], dflt: string) => (allowed.includes(x as string) ? (x as string) : dflt);

export interface AttributionContext {
  speakers: number; // distinct voices
  reliable: boolean; // false when the speaker labels could not be verified
}

export type LlmJson = (system: string, user: string) => Promise<{ content: string; promptTokens: number; completionTokens: number; finishReason?: string }>;

const defaultLlm: LlmJson | null = openai
  ? async (system, user) => {
      const res = await openai.chat.completions.create(
        { model: UNDERSTANDING_MODEL, temperature: 0, seed: 7, max_tokens: 2000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
        { timeout: 25_000 },
      );
      return { content: res.choices[0]?.message?.content ?? '{}', promptTokens: res.usage?.prompt_tokens ?? 0, completionTokens: res.usage?.completion_tokens ?? 0, finishReason: res.choices[0]?.finish_reason };
    }
  : null;

// Secondary intents = what the model listed, plus every issue it enumerated whose quote really is in the transcript.
function mergeSecondary(raw: any, transcript: string): Intent[] {
  const primary = intent(raw?.primary_intent).label;
  const listed: Intent[] = (Array.isArray(raw?.secondary_intents) ? raw.secondary_intents : []).map(intent);
  const quotes = groundFragments((Array.isArray(raw?.issues) ? raw.issues : []).map((i: any) => str(i?.quote)), transcript);
  const fromIssues: Intent[] = (Array.isArray(raw?.issues) ? raw.issues : [])
    .filter((i: any) => quotes.includes(str(i?.quote)))
    .map((i: any) => ({ label: intent(i).label, description: str(i?.quote) }));
  const seen = new Set<string>([primary]);
  return [...listed, ...fromIssues].filter((i) => (seen.has(i.label) ? false : (seen.add(i.label), true))).slice(0, 6);
}

export function normalize(raw: any, turns: Turn[], ctx: AttributionContext): Understanding {
  const e = raw?.entities ?? {};
  const rawEntities = Object.fromEntries(ENTITY_KEYS.map((k) => [k, strList(e[k])])) as Entities;
  const declared = Number.isInteger(raw?.customer_speaker) ? (raw.customer_speaker as number) - 1 : null; // model sees 1-based labels
  const customer = ctx.speakers <= 1 ? (turns.find((t) => t.speaker !== null)?.speaker ?? 0) : declared !== null && turns.some((t) => t.speaker === declared) ? declared : null;
  const grounded = groundEntities(rawEntities, turns, customer, ctx.reliable || ctx.speakers <= 1);
  const corr = groundCorrections<Understanding['corrections'][number]>(
    (Array.isArray(raw?.corrections) ? raw.corrections : []).slice(0, 8)
      .map((c: any) => ({ field: str(c?.field, 80), original: str(c?.original, 120), corrected: str(c?.corrected, 120) }))
      .filter((c: any) => c.original || c.corrected),
    turns,
  );
  const transcript = turns.map((t) => t.text).join(' ');
  // corrections the model missed but the wording shows plainly (only from the customer's own turns when they are known)
  const customerText = customer === null ? transcript : turns.filter((t) => t.speaker === customer).map((t) => t.text).join(' ');
  const digitsOf = (x: string) => x.replace(/\D/g, '');
  const known = corr.kept.map((c) => `${digitsOf(c.original)}>${digitsOf(c.corrected)}`);
  const extra = detectSpokenCorrections(customerText).filter((c) => !known.includes(`${digitsOf(c.original)}>${digitsOf(c.corrected)}`) && !corr.kept.some((k) => digitsOf(k.corrected) === digitsOf(c.corrected)));
  const ambiguities = [...strList(raw?.ambiguities, 6), ...bareAmountAmbiguities(grounded.customer.amounts, customerText)].slice(0, 8);
  const t = raw?.lexical_tone ?? {};
  return {
    summary: str(raw?.summary, 700),
    customer_speaker: customer,
    primary_intent: intent(raw?.primary_intent),
    secondary_intents: mergeSecondary(raw, transcript),
    intent_confidence: level(raw?.intent_confidence, ['high', 'medium', 'low'], 'medium') as Understanding['intent_confidence'],
    entities: grounded.customer,
    agent_stated: grounded.agent_stated,
    unverified_speaker: grounded.unverified,
    corrections: [...corr.kept, ...extra.map((c) => ({ ...c, field: 'detail (spotted from the wording)' }))].slice(0, 8),
    lexical_tone: {
      emotion: EMOTIONS.has(t.emotion) ? t.emotion : 'not_evident',
      valence: level(t.valence, VALENCE, 'unclear') as LexicalTone['valence'],
      intensity: level(t.intensity, ['low', 'medium', 'high'], 'low') as LexicalTone['intensity'],
      evidence: str(t.evidence, 240),
    },
    established_facts: strList(raw?.established_facts, 10),
    ambiguities,
    repetitions: strList(raw?.repetitions, 5),
    late_information: strList(raw?.late_information, 5),
    off_topic_speech: groundFragments(strList(raw?.off_topic_speech, 5), transcript),
    next_steps: strList(raw?.next_steps, 5),
    escalate: raw?.escalate === true,
    dropped_unverified: grounded.dropped.length + corr.dropped,
  };
}

export function promptFor(turns: Turn[], transcript: string, uncertainWords: string[], ctx: AttributionContext, hadBackground: boolean): string {
  const labelled = turns.length
    ? turns.map((t) => `Speaker ${(t.speaker ?? 0) + 1}${t.uncertain && ctx.speakers > 1 ? ' (speaker uncertain)' : ''}: ${t.text}`).join('\n')
    : `Speaker 1: ${transcript}`;
  const hint = uncertainWords.length ? `\n\nWords the speech recognizer was unsure about (possible errors): ${uncertainWords.join(', ')}` : '';
  const bg = hadBackground ? '\n\n(Some quiet background speech was detected and left out of the transcript above.)' : '';
  const who = ctx.speakers > 1 && !ctx.reliable ? '\n\nNote: two speakers were reported but could not be verified from the audio; treat speaker labels as unreliable.' : '';
  return `TRANSCRIPT:\n${labelled}${hint}${bg}${who}`;
}

export async function understandCall(
  turns: Turn[],
  transcript: string,
  uncertainWords: string[],
  ctx: AttributionContext,
  hadBackground = false,
  llm: LlmJson | null = defaultLlm,
): Promise<UnderstandingResult> {
  const started = Date.now();
  const empty = { understanding: null, cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, duration_ms: 0 };
  if (!llm) return { ...empty, error: 'OPENAI_API_KEY not set' };
  if (!transcript.trim()) return { ...empty, error: 'empty transcript' };
  try {
    // the model only ever sees redacted text
    const safeTurns = turns.map((t) => ({ ...t, text: redactPII(t.text) }));
    const res = await llm(SYSTEM, promptFor(safeTurns, redactPII(transcript), uncertainWords.map((w) => redactPII(w)), ctx, hadBackground));
    const cost = llmCost(UNDERSTANDING_MODEL, res.promptTokens, res.completionTokens); // charged whether or not the answer is usable
    const base = { cost_usd: cost, prompt_tokens: res.promptTokens, completion_tokens: res.completionTokens, duration_ms: Date.now() - started };
    if (res.finishReason === 'length') return { ...base, understanding: null, error: 'the analysis was cut off (answer too long)' };
    let parsed: unknown;
    try { parsed = JSON.parse(res.content || '{}'); } catch { return { ...base, understanding: null, error: 'the model did not return readable JSON' }; }
    return { ...base, understanding: normalize(parsed, safeTurns, ctx) };
  } catch (e) {
    return { ...empty, error: (e as Error).message.slice(0, 200), duration_ms: Date.now() - started };
  }
}
