import OpenAI from 'openai';
import 'dotenv/config';
import { redactPII } from '../redaction/piiRedactor.js';
import { llmCost } from '../cost/pricing.js';
import type { Turn } from './speechMetrics.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
export const UNDERSTANDING_MODEL = 'gpt-4o-mini';

export const INTENT_LABELS = [
  'duplicate_charge', 'failed_payment', 'pending_transaction', 'missing_order', 'refund_request',
  'incorrect_charge', 'subscription_charge', 'delivery_problem', 'billing_account_issue',
  'unauthorized_transaction', 'general_inquiry', 'other', 'unclear',
] as const;
export type IntentLabel = (typeof INTENT_LABELS)[number];

export interface Intent { label: IntentLabel; description: string }
export interface Understanding {
  summary: string;
  customer_speaker: number | null;
  primary_intent: Intent;
  secondary_intents: Intent[];
  intent_confidence: 'high' | 'medium' | 'low';
  entities: {
    order_ids: string[];
    transaction_ids: string[];
    amounts: string[];
    dates: string[];
    other: string[];
  };
  corrections: { field: string; original: string; corrected: string }[];
  sentiment: { emotion: string; intensity: 'low' | 'medium' | 'high'; evidence: string };
  established_facts: string[];
  ambiguities: string[];
  repetitions: string[];
  late_information: string[];
  next_steps: string[];
  escalate: boolean;
}
export interface UnderstandingResult {
  understanding: Understanding | null;
  error?: string;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
}

const SYSTEM = `You analyze ONE customer-support phone call from a speech-to-text transcript. The transcript may contain recognition errors, filler words, restarts and speaker mix-ups. Return ONLY a JSON object.

Rules:
- Use only what was actually said. Never invent order numbers, amounts, dates, causes or outcomes. Use null or [] when something was not stated.
- Speakers are labelled "Speaker 1", "Speaker 2". The customer is whoever reports the problem; set customer_speaker to that speaker's number (as shown), or null if unclear.
- If the customer corrects themselves, the CORRECTED value is the final one. Put the corrected value in entities, and record the change in corrections (field, original, corrected).
- established_facts: only things the customer clearly stated as fact. Do NOT put guesses or uncertain claims there.
- ambiguities: contradictions, uncertainty or unresolved states the customer expressed (for example "not sure whether the payment failed or is pending"). Say what is unclear; do not resolve it for them.
- repetitions: details the customer repeated (usually because they thought they were not understood). late_information: important details the customer only remembered or revealed late in the call.
- primary_intent.label must be one of: ${INTENT_LABELS.join(', ')}. Use "unclear" if the request cannot be determined. secondary_intents lists other distinct requests or problems (same label set), excluding the primary one.
- sentiment.emotion is one of: calm, confused, frustrated, impatient, nervous, embarrassed, rushed, distracted, relieved, angry, neutral. You cannot hear the voice, so judge from the WORDS and the delivery measurements you are given: many fillers, long pauses, trailing off and self-doubt suggest nervous or embarrassed; "yeah yeah", cutting people off, "can we please just" suggest impatient; a fast pace, apologising for noise or breaking off suggest rushed or distracted; repeated complaints and sharp wording suggest frustrated. Use neutral only when nothing supports a stronger label. sentiment.evidence is a short reason.
- Numbers: never merge separate numbers into one value. A correction such as "forty-nine dollars, sorry, fifty-nine dollars" or "$49 sorry, dollars 59" means the amount is 59 (record the change under corrections), not 49.59 or 4959. Keep spoken digit strings as one order/transaction number.
- Background voices, announcements or lines spoken by the support agent are not the customer; ignore them when extracting the customer's details.
- next_steps: 2 to 4 concrete actions a support agent should take. Include clarifying questions where the facts are not established. Do not assume unverified facts.
- If the transcript is empty, unintelligible or not a support call, say so in summary and use primary_intent.label "unclear".
- escalate is true only for signs of fraud, an account takeover, a legal threat or severe distress.

JSON shape:
{"summary": string (2-3 sentences), "customer_speaker": number|null, "primary_intent": {"label": string, "description": string}, "secondary_intents": [{"label": string, "description": string}], "intent_confidence": "high"|"medium"|"low", "entities": {"order_ids": string[], "transaction_ids": string[], "amounts": string[], "dates": string[], "other": string[]}, "corrections": [{"field": string, "original": string, "corrected": string}], "sentiment": {"emotion": string, "intensity": "low"|"medium"|"high", "evidence": string}, "established_facts": string[], "ambiguities": string[], "repetitions": string[], "late_information": string[], "next_steps": string[], "escalate": boolean}`;

const EMOTIONS = new Set(['calm', 'confused', 'frustrated', 'impatient', 'nervous', 'embarrassed', 'rushed', 'distracted', 'relieved', 'angry', 'neutral']);

const str = (v: unknown, max = 400): string => (typeof v === 'string' ? redactPII(v.trim()).slice(0, max) : '');
const strList = (v: unknown, n = 8): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, n) : []);
const intent = (v: any): Intent => ({
  label: (INTENT_LABELS as readonly string[]).includes(v?.label) ? v.label : 'other',
  description: str(v?.description),
});

function normalize(raw: any): Understanding {
  const e = raw?.entities ?? {};
  const level = (x: unknown, allowed: string[], dflt: string) => (allowed.includes(x as string) ? (x as string) : dflt);
  return {
    summary: str(raw?.summary, 700),
    customer_speaker: Number.isInteger(raw?.customer_speaker) ? raw.customer_speaker : null,
    primary_intent: intent(raw?.primary_intent),
    secondary_intents: (Array.isArray(raw?.secondary_intents) ? raw.secondary_intents : []).slice(0, 6).map(intent),
    intent_confidence: level(raw?.intent_confidence, ['high', 'medium', 'low'], 'medium') as Understanding['intent_confidence'],
    entities: {
      order_ids: strList(e.order_ids), transaction_ids: strList(e.transaction_ids), amounts: strList(e.amounts),
      dates: strList(e.dates), other: strList(e.other),
    },
    corrections: (Array.isArray(raw?.corrections) ? raw.corrections : []).slice(0, 8)
      .map((c: any) => ({ field: str(c?.field, 80), original: str(c?.original, 120), corrected: str(c?.corrected, 120) }))
      .filter((c: any) => c.original || c.corrected),
    sentiment: {
      emotion: EMOTIONS.has(raw?.sentiment?.emotion) ? raw.sentiment.emotion : 'neutral',
      intensity: level(raw?.sentiment?.intensity, ['low', 'medium', 'high'], 'low') as 'low' | 'medium' | 'high',
      evidence: str(raw?.sentiment?.evidence, 240),
    },
    established_facts: strList(raw?.established_facts, 10),
    ambiguities: strList(raw?.ambiguities, 6),
    repetitions: strList(raw?.repetitions, 5),
    late_information: strList(raw?.late_information, 5),
    next_steps: strList(raw?.next_steps, 5),
    escalate: raw?.escalate === true,
  };
}

export async function understandCall(turns: Turn[], transcript: string, uncertainWords: string[], delivery: string): Promise<UnderstandingResult> {
  const started = Date.now();
  const empty = { understanding: null, cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, duration_ms: 0 };
  if (!openai) return { ...empty, error: 'OPENAI_API_KEY not set' };
  if (!transcript.trim()) return { ...empty, error: 'empty transcript' };

  const labelled = turns.length
    ? turns.map((t) => `Speaker ${t.speaker + 1}: ${t.text}`).join('\n')
    : `Speaker 1: ${transcript}`;
  const hint = uncertainWords.length
    ? `\n\nWords the speech recognizer was unsure about (possible errors): ${uncertainWords.join(', ')}`
    : '';

  try {
    const res = await openai.chat.completions.create(
      {
        model: UNDERSTANDING_MODEL,
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `TRANSCRIPT:\n${labelled}${hint}\n\nDelivery measurements: ${delivery}` },
        ],
      },
      { timeout: 25_000 },
    );
    const pt = res.usage?.prompt_tokens ?? 0;
    const ct = res.usage?.completion_tokens ?? 0;
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    return {
      understanding: normalize(parsed),
      cost_usd: llmCost(UNDERSTANDING_MODEL, pt, ct),
      prompt_tokens: pt,
      completion_tokens: ct,
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    return { ...empty, error: (e as Error).message.slice(0, 200), duration_ms: Date.now() - started };
  }
}
