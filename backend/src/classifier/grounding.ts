import OpenAI from 'openai';
import 'dotenv/config';
import { llmCost } from '../cost/pricing.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface GroundingResult {
  hallucinated: boolean;
  reasoning: string;
  auxCostUsd: number;
  promptTokens: number;
  completionTokens: number;
  error?: boolean; // the judge itself could not run, so `hallucinated: false` is an absence of a verdict, not a verdict
}

const DECLINE = /\b(i['’]?m sorry|i am sorry|i can['’]?t|i cannot|i can not|i don['’]?t (?:have|know)|i do not (?:have|know)|i['’]?m not (?:able|sure)|unable to|not able to|no (?:record|information) (?:of|about|on))\b/i;

// A reply that declines or says it does not know asserts nothing, so it cannot be a hallucination. The judge model mislabelled such
// replies now and then (it once flagged "I can't provide details about events from 2017" for "inventing" the year that the caller
// had just said), so a plain decline is settled here, without asking it. Numbers in the reply must all come from the question.
export function isPlainDecline(userText: string, reply: string): boolean {
  if (!DECLINE.test(reply)) return false;
  const said = new Set(userText.match(/\d+/g) ?? []);
  return (reply.match(/\d+/g) ?? []).every((n) => said.has(n));
}

export async function detectHallucination(userText: string, assistantResponse: string): Promise<GroundingResult> {
  if (isPlainDecline(userText, assistantResponse)) {
    return { hallucinated: false, reasoning: 'The reply declines or says it does not know, so it states nothing that could be invented.', auxCostUsd: 0, promptTokens: 0, completionTokens: 0 };
  }
  if (!openai) return { hallucinated: false, reasoning: 'no openai key', auxCostUsd: 0, promptTokens: 0, completionTokens: 0, error: true };

  const prompt = `You are auditing an AI voice assistant's response for hallucination.

USER SAID: "${userText}"

ASSISTANT REPLIED: "${assistantResponse}"

Does the assistant's reply assert any specific fact, number, name, date, statistic, or entity that is NOT present in or reasonably inferable from what the user said?

A reply that declines, asks a question or says it does not know is NOT a hallucination.

Answer JSON only: {"hallucinated": true|false, "reasoning": "one short sentence"}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    const pt = res.usage?.prompt_tokens ?? 0;
    const ct = res.usage?.completion_tokens ?? 0;
    return {
      hallucinated: !!parsed.hallucinated,
      reasoning: parsed.reasoning ?? '',
      auxCostUsd: llmCost('gpt-4o-mini', pt, ct),
      promptTokens: pt,
      completionTokens: ct,
    };
  } catch (e) {
    return { hallucinated: false, reasoning: 'grounding check failed: ' + (e as Error).message, auxCostUsd: 0, promptTokens: 0, completionTokens: 0, error: true };
  }
}
