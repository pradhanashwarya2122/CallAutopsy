import OpenAI from 'openai';
import 'dotenv/config';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface LlmResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  rawMeta: any;
}

const DEFAULT_SYSTEM =
  'You are a helpful voice assistant. Respond in one or two short sentences, plain spoken English.';

export async function llmTurn(
  userText: string,
  opts: { model?: string; systemPrompt?: string } = {},
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
    temperature: 0.7,
  });

  return {
    text: res.choices[0]?.message?.content ?? '',
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    model,
    rawMeta: res.usage ?? {},
  };
}
