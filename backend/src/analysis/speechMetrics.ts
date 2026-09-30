// Objective speech measurements derived from the STT provider's per-word timings and confidences and from the speaker analysis.
// Nothing here is estimated by a language model.
import type { Diarization } from './diarize.js';
import type { SttWord, TurnAnalysis } from './turns.js';

export interface SpeechMetrics {
  duration_s: number;
  word_count: number;
  words_per_minute: number | null;
  avg_confidence: number | null;
  low_confidence_words: string[];
  low_confidence_ratio: number;
  filler_count: number;
  pause_count: number; // gaps between words over 0.7 s
  long_pause_count: number; // gaps over 1.5 s
  longest_pause_s: number;
  speakers: number;
  turn_count: number;
  overlap_count: number; // simultaneous speech confirmed by timestamps (a lower bound on mono recordings, see turns.ts)
  overlap_s: number;
  interruption_count: number; // a sentence cut off by the other speaker (see analysis.boundaries for evidence and confidence)
  backchannel_count: number;
}

const FILLERS = new Set(['uh', 'um', 'uhm', 'uhh', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mmm']);
const PAUSE_S = 0.7;
const LONG_PAUSE_S = 1.5;
const LOW_CONF = 0.7;

const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');

// `wordConfidence`: the provider gives a real confidence for each word (Deepgram does). Whisper only gives one per segment, which is not
// comparable with the 0.7 threshold (clear speech scores 0.6-0.75), so for it no word is called "low confidence" and there is no average.
export function computeSpeechMetrics(words: SttWord[], durationSec: number, ta: TurnAnalysis, d: Diarization | null, wordConfidence = true): SpeechMetrics {
  const timed = words.filter((w) => typeof w.start === 'number' && typeof w.end === 'number');
  const speechSpan = timed.length ? (timed[timed.length - 1].end as number) - (timed[0].start as number) : 0;

  let pauseCount = 0;
  let longPauseCount = 0;
  let longest = 0;
  for (let i = 1; i < timed.length; i += 1) {
    const gap = (timed[i].start as number) - (timed[i - 1].end as number);
    if (gap > PAUSE_S) pauseCount += 1;
    if (gap > LONG_PAUSE_S) longPauseCount += 1;
    if (gap > longest) longest = gap;
  }

  const sim = ta.boundaries.filter((x) => x.kind === 'simultaneous');
  const lowConf = wordConfidence ? words.filter((w) => w.confidence < LOW_CONF) : [];
  const avg = wordConfidence && words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : null;
  return {
    duration_s: durationSec,
    word_count: words.length,
    words_per_minute: speechSpan > 2 ? Math.round((words.length / speechSpan) * 60) : null,
    avg_confidence: avg,
    low_confidence_words: lowConf.slice(0, 12).map((w) => w.word.replace(/[.,?!]/g, '')),
    low_confidence_ratio: words.length ? lowConf.length / words.length : 0,
    filler_count: words.filter((w) => FILLERS.has(bare(w.word))).length,
    pause_count: pauseCount,
    long_pause_count: longPauseCount,
    longest_pause_s: Math.round(longest * 10) / 10,
    speakers: d?.speakers ?? (ta.turns.length ? 1 : 0),
    turn_count: ta.turns.length,
    overlap_count: sim.length,
    overlap_s: Math.round(sim.reduce((a, x) => a + x.overlap_s, 0) * 10) / 10,
    interruption_count: ta.boundaries.filter((x) => x.kind === 'interruption').length,
    backchannel_count: ta.boundaries.filter((x) => x.kind === 'backchannel').length,
  };
}
