import type { SttOutcome } from '../pipeline/stt/index.js';

export const STT_CONFIDENCE_THRESHOLD = 0.6;
// Deepgram reports real per-word confidence. Measured on the demo calls: clean speech >= 0.99, a moderately noisy
// cafe call ~0.92, audio garbled at 60% ~0.64-0.73. 0.85 separates degraded audio from usable speech.
// Whisper's confidence is only an estimate derived from avg_logprob, so it keeps the looser default.
export const DEEPGRAM_CONFIDENCE_THRESHOLD = 0.85;

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
