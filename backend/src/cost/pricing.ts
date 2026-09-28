// Real, published rates as of 2026. Update if providers change them.

export const PRICING = {
  deepgram: {
    nova3_per_minute: 0.0043,
  },
  whisper: {
    per_minute: 0.006,
  },
  openai_llm: {
    'gpt-4o-mini': { input_per_1k: 0.00015, output_per_1k: 0.0006 },
    'gpt-4o': { input_per_1k: 0.0025, output_per_1k: 0.01 },
  },
  openai_tts: {
    'tts-1': { per_1k_chars: 0.015 },
  },
} as const;

export function sttCost(provider: 'deepgram' | 'whisper', durationSec: number): number {
  const minutes = durationSec / 60;
  if (provider === 'deepgram') return minutes * PRICING.deepgram.nova3_per_minute;
  return minutes * PRICING.whisper.per_minute;
}

export function llmCost(model: string, promptTokens: number, completionTokens: number): number {
  const rates = (PRICING.openai_llm as any)[model] ?? PRICING.openai_llm['gpt-4o-mini'];
  return (promptTokens / 1000) * rates.input_per_1k + (completionTokens / 1000) * rates.output_per_1k;
}

export function ttsCost(model: string, chars: number): number {
  const rates = (PRICING.openai_tts as any)[model] ?? PRICING.openai_tts['tts-1'];
  return (chars / 1000) * rates.per_1k_chars;
}
