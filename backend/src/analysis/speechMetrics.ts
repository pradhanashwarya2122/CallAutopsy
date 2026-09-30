// Objective speech measurements derived from the STT provider's per-word timings, confidences and speaker labels.
// Nothing here is estimated by a language model.
import type { SttResult } from '../pipeline/stt/deepgram.js';

export type SttWord = SttResult['words'][number];

export interface Turn {
  speaker: number;
  start: number | null;
  end: number | null;
  text: string;
}

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
  overlap_count: number; // episodes where a second speaker starts before the first has finished
  overlap_s: number;
  interruption_count: number; // a speaker's sentence is cut off and the other speaker starts right away
}

const FILLERS = new Set(['uh', 'um', 'uhm', 'uhh', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mmm']);
const PAUSE_S = 0.7;
const LONG_PAUSE_S = 1.5;
const LOW_CONF = 0.7;

const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');

export function buildTurns(words: SttWord[], fallbackText: string): Turn[] {
  if (!words.length) return fallbackText.trim() ? [{ speaker: 0, start: null, end: null, text: fallbackText.trim() }] : [];
  const turns: Turn[] = [];
  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.text += ` ${w.word}`;
      last.end = w.end ?? last.end;
    } else {
      turns.push({ speaker, start: w.start ?? null, end: w.end ?? null, text: w.word });
    }
  }
  return turns;
}

export function computeSpeechMetrics(words: SttWord[], durationSec: number, turns: Turn[]): SpeechMetrics {
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

  let overlapCount = 0;
  let overlapS = 0;
  let inOverlap = false;
  for (let i = 1; i < timed.length; i += 1) {
    const prev = timed[i - 1];
    const cur = timed[i];
    const overlapping = prev.speaker !== cur.speaker && (cur.start as number) < (prev.end as number) - 0.05;
    if (overlapping) {
      overlapS += (prev.end as number) - (cur.start as number);
      if (!inOverlap) overlapCount += 1;
    }
    inOverlap = overlapping;
  }

  // Mono recordings usually cannot show two people talking at once (the recognizer keeps one word stream), so also look for
  // a turn that stops mid-sentence and is followed almost immediately by the other speaker.
  let interruptions = 0;
  for (let i = 1; i < turns.length; i += 1) {
    const prev = turns[i - 1];
    const cur = turns[i];
    if (prev.speaker === cur.speaker || prev.end === null || cur.start === null) continue;
    if (cur.start - prev.end < 0.35 && !/[.?!]["')]*$/.test(prev.text.trim())) interruptions += 1;
  }

  const lowConf = words.filter((w) => w.confidence < LOW_CONF);
  const avg = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : null;
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
    speakers: new Set(words.map((w) => w.speaker ?? 0)).size || (turns.length ? 1 : 0),
    turn_count: turns.length,
    overlap_count: overlapCount,
    overlap_s: Math.round(overlapS * 10) / 10,
    interruption_count: interruptions,
  };
}
