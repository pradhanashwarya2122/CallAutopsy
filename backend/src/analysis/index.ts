import type { SttOutcome } from '../pipeline/stt/index.js';
import { readPcm16, type Pcm } from './audioIO.js';
import { analyzePcmSignal, type AudioSignal } from './audioSignal.js';
import { extractFramesAsync, type Frames } from './prosody.js';
import { diarize, type Diarization } from './diarize.js';
import { buildTurns, type Boundary, type BackgroundSpeech, type Turn, type TurnAnalysis } from './turns.js';
import { computeSpeechMetrics, type SpeechMetrics } from './speechMetrics.js';
import { composeTone, measureVoices, type SpeakerVoice, type Tone } from './vocal.js';
import { understandCall, UNDERSTANDING_MODEL, type LlmJson, type Understanding } from './callUnderstanding.js';
import { buildFindings, rateDifficulty, type Difficulty, type Finding } from './findings.js';
import { redactDeep } from '../redaction/piiRedactor.js';

export interface Attribution {
  speakers: number;
  source: Diarization['source'];
  reliable: boolean; // false = who said what could not be verified, so details are not attributed to a speaker
  pitch_gap_semitones: number | null;
  voice_pitch_hz: number[];
  recognizer_speakers: number;
  agreement: number | null;
  notes: string[];
}

export interface CallAnalysis {
  version: 2;
  attribution: Attribution;
  turns: Turn[];
  background: BackgroundSpeech[];
  boundaries: Boundary[];
  overlap_visibility: TurnAnalysis['overlap_visibility'];
  speech: SpeechMetrics;
  voices: SpeakerVoice[];
  tone: Tone;
  signal: AudioSignal | null;
  understanding: Understanding | null;
  understanding_error?: string;
  findings: Finding[];
  difficulty: Difficulty;
  script_match?: { wer: number; wer_strict: number; ref_words: number; numbers_expected: number; numbers_matched: number };
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

// Speaker labels are trustworthy when the audio itself supports them (or there is only one voice).
const RELIABLE_SOURCES = new Set<Diarization['source']>(['acoustic', 'recognizer+acoustic', 'single_voice']);

// The analysis object when something in the measurements themselves failed: valid, empty, and it says why.
function failedAnalysis(message: string, started: number): CallAnalysis {
  const speech: SpeechMetrics = { duration_s: 0, word_count: 0, words_per_minute: null, avg_confidence: null, low_confidence_words: [], low_confidence_ratio: 0, filler_count: 0, pause_count: 0, long_pause_count: 0, longest_pause_s: 0, speakers: 0, turn_count: 0, overlap_count: 0, overlap_s: 0, interruption_count: 0, backchannel_count: 0 };
  return {
    version: 2,
    attribution: { speakers: 0, source: 'unavailable', reliable: false, pitch_gap_semitones: null, voice_pitch_hz: [], recognizer_speakers: 0, agreement: null, notes: ['The analysis could not be completed.'] },
    turns: [], background: [], boundaries: [], overlap_visibility: 'not_applicable', speech, voices: [],
    tone: { lexical: null, vocal: null, overall: { label: 'not evident', confidence: 'low', agreement: 'insufficient', basis: 'The analysis could not be completed.' } },
    signal: null, understanding: null, understanding_error: `analysis failed: ${message.slice(0, 160)}`,
    findings: [], difficulty: { score: 0, label: 'Easy' }, model: UNDERSTANDING_MODEL, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started,
  };
}

// Best-effort: never throws, so a failed analysis can never fail the call itself (or leave it stuck in progress). `llm` is
// injectable for tests.
export async function analyzeCall(stt: SttOutcome, audio: Buffer, llm?: LlmJson | null): Promise<CallAnalysis> {
  const started = Date.now();
  try {
    return await analyzeCallUnsafe(stt, audio, llm, started);
  } catch (e) {
    return failedAnalysis((e as Error)?.message ?? String(e), started);
  }
}

async function analyzeCallUnsafe(stt: SttOutcome, audio: Buffer, llm: LlmJson | null | undefined, started: number): Promise<CallAnalysis> {
  let pcm: Pcm | null = null;
  let frames: Frames | null = null;
  let signal: AudioSignal | null = null;
  try {
    pcm = readPcm16(audio);
    if (pcm) { frames = await extractFramesAsync(pcm); signal = analyzePcmSignal(pcm); }
  } catch {
    pcm = null; frames = null; signal = null;
  }

  const diar = diarize(stt.words, frames);
  const ta = buildTurns(stt.words, diar, stt.transcript);
  const speech = computeSpeechMetrics(stt.words, stt.audioDurationSec, ta, diar, stt.provider === 'deepgram');
  const voices = measureVoices(stt.words, diar, frames, signal);
  const reliable = RELIABLE_SOURCES.has(diar.source);
  const ctx = { speakers: Math.max(1, diar.speakers), reliable };

  const u = await understandCall(ta.turns, stt.transcript, speech.low_confidence_words, ctx, ta.background.length > 0, llm);
  const customer = u.understanding?.customer_speaker ?? (ctx.speakers <= 1 ? 0 : null);
  // the lone measured voice is the customer's only when the call has one voice; with two, an unidentified customer stays unmeasured
  const customerVoice = voices.find((v) => v.speaker === customer) ?? (voices.length === 1 && diar.speakers <= 1 ? voices[0] : null);
  const lex = u.understanding ? { ...u.understanding.lexical_tone } : null;
  const tone = composeTone(lex, customerVoice);

  const findings = buildFindings({ speech, signal, understanding: u.understanding, sttProvider: stt.provider, diarization: diar, turns: ta, customerVoice, attributionReliable: reliable });

  // Everything stored or returned is redacted, whatever path the text took.
  return redactDeep({
    version: 2 as const,
    attribution: { speakers: diar.speakers, source: diar.source, reliable, pitch_gap_semitones: diar.pitch_gap_semitones, voice_pitch_hz: diar.voice_pitch_hz, recognizer_speakers: diar.recognizer_speakers, agreement: diar.agreement === null ? null : Math.round(diar.agreement * 100) / 100, notes: diar.notes },
    turns: ta.turns,
    background: ta.background,
    boundaries: ta.boundaries,
    overlap_visibility: ta.overlap_visibility,
    speech,
    voices,
    tone,
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
  });
}
