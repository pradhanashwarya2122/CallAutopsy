import { sttCost, llmCost, ttsCost } from './pricing.js';

export interface StageCostInput {
  stage: 'stt' | 'llm' | 'tts';
  provider?: string;
  rawMeta: any;
}

export function costForStage(input: StageCostInput): number {
  if (input.stage === 'stt') {
    const dur = input.rawMeta?.duration ?? 0;
    return sttCost((input.provider as any) === 'whisper' ? 'whisper' : 'deepgram', dur);
  }
  if (input.stage === 'llm') {
    const m = input.rawMeta;
    return llmCost(m?.model ?? 'gpt-4o-mini', m?.prompt_tokens ?? 0, m?.completion_tokens ?? 0);
  }
  if (input.stage === 'tts') {
    return ttsCost(input.rawMeta?.model ?? 'tts-1', input.rawMeta?.charCount ?? 0);
  }
  return 0;
}
