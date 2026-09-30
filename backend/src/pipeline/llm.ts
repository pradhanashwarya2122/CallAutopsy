import OpenAI from 'openai';
import 'dotenv/config';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface LlmResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  temperature: number;
  rawMeta: any;
}

const DEFAULT_SYSTEM =
  'You are a customer-support voice assistant on a phone call. Reply in one or two short spoken sentences. ' +
  'Acknowledge what the customer wants, and do not state facts, amounts or order details the customer did not give you. ' +
  'If the request is unclear or the customer sounds unsure, ask one short clarifying question instead of guessing.';

export async function llmTurn(
  userText: string,
  opts: { model?: string; systemPrompt?: string; temperature?: number } = {},
): Promise<LlmResult> {
  if (!openai) throw new Error('OPENAI_API_KEY not set');
  const model = opts.model ?? 'gpt-4o-mini';
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM;

  const res = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: 600, // a spoken reply is a sentence or two; this bounds a runaway answer
  });

  return {
    text: res.choices[0]?.message?.content ?? '',
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    model,
    temperature: opts.temperature ?? 0.7,
    rawMeta: res.usage ?? {},
  };
}
