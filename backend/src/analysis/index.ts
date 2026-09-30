import type { SttOutcome } from '../pipeline/stt/index.js';
import { analyzeWavSignal, type AudioSignal } from './audioSignal.js';
import { buildTurns, computeSpeechMetrics, type SpeechMetrics, type Turn } from './speechMetrics.js';
import { understandCall, UNDERSTANDING_MODEL, type Understanding } from './callUnderstanding.js';
import { buildFindings, rateDifficulty, type Difficulty, type Finding } from './findings.js';
import { redactPII } from '../redaction/piiRedactor.js';

export interface CallAnalysis {
  version: 1;
  turns: Turn[];
  speech: SpeechMetrics;
  signal: AudioSignal | null;
  understanding: Understanding | null;
  understanding_error?: string;
  findings: Finding[];
  difficulty: Difficulty;
  script_match?: { wer: number; ref_words: number };
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

// Best-effort: never throws, so a failed analysis can never fail the call itself.
export async function analyzeCall(stt: SttOutcome, audio: Buffer): Promise<CallAnalysis> {
  const started = Date.now();
  const turns = buildTurns(stt.words, stt.transcript);
  const speech = computeSpeechMetrics(stt.words, stt.audioDurationSec, turns);
  let signal: AudioSignal | null = null;
  try {
    signal = analyzeWavSignal(audio);
  } catch {
    signal = null;
  }
  const delivery = [
    speech.words_per_minute !== null ? `${speech.words_per_minute} words per minute` : null,
    `${speech.filler_count} filler words (um/uh)`,
    `${speech.pause_count} pauses over 0.7 s (longest ${speech.longest_pause_s} s)`,
    speech.speakers > 1 ? `${speech.speakers} voices detected` : null,
    speech.interruption_count ? `${speech.interruption_count} sentence(s) cut off by another speaker` : null,
  ].filter(Boolean).join(', ');
  const u = await understandCall(turns, stt.transcript, speech.low_confidence_words, delivery);
  const findings = buildFindings(speech, signal, u.understanding, stt.provider);
  return {
    version: 1,
    turns: turns.map((t) => ({ ...t, text: redactPII(t.text) })), // stored view is redacted like the transcript
    speech: { ...speech, low_confidence_words: speech.low_confidence_words.map((w) => redactPII(w)) },
    signal,
    understanding: u.understanding,
    ...(u.error ? { understanding_error: u.error } : {}),
    findings,
    difficulty: rateDifficulty(findings),
    model: UNDERSTANDING_MODEL,
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    cost_usd: u.cost_usd,
    duration_ms: Date.now() - started,
  };
}
