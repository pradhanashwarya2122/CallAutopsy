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
}

export async function detectHallucination(userText: string, assistantResponse: string): Promise<GroundingResult> {
  if (!openai) return { hallucinated: false, reasoning: 'no openai key', auxCostUsd: 0, promptTokens: 0, completionTokens: 0 };

  const prompt = `You are auditing an AI voice assistant's response for hallucination.

USER SAID: "${userText}"

ASSISTANT REPLIED: "${assistantResponse}"

Does the assistant's reply assert any specific fact, number, name, date, statistic, or entity that is NOT present in or reasonably inferable from what the user said?

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
    return { hallucinated: false, reasoning: 'grounding check failed: ' + (e as Error).message, auxCostUsd: 0, promptTokens: 0, completionTokens: 0 };
  }
}
