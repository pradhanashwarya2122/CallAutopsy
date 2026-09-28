import type { TtsResult } from '../pipeline/tts.js';

export function ttsDurationMismatch(res: TtsResult | null, sourceText: string): boolean {
  if (!res) return true;
  if (res.bytes < 1000) return true; // suspiciously small
  const expected = sourceText.length / 15;
  const actual = res.approxDurationSec;
  if (expected === 0) return false;
  const ratio = actual / expected;
  return ratio < 0.5 || ratio > 2.5;
}
