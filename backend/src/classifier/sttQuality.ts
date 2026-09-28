import type { SttOutcome } from '../pipeline/stt/index.js';

export const STT_CONFIDENCE_THRESHOLD = 0.6;

export function sttConfidenceSignal(res: SttOutcome): { avgConfidence: number; belowThreshold: boolean } {
  const avg = res.avgConfidence ?? 0;
  return {
    avgConfidence: avg,
    belowThreshold: avg > 0 && avg < STT_CONFIDENCE_THRESHOLD,
  };
}

// Secondary sanity check: transcript looks like coherent words
export function looksIncoherent(transcript: string): boolean {
  if (!transcript.trim()) return true;
  const words = transcript.trim().split(/\s+/);
  if (words.length < 2) return true;
  const alphaRatio =
    transcript.replace(/[^a-zA-Z]/g, '').length / Math.max(1, transcript.length);
  return alphaRatio < 0.5;
}
