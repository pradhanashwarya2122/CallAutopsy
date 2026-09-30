// Turns and turn boundaries built from attributed words. Every speaker change is classified as simultaneous speech, an
// interruption, a backchannel (short acknowledgement) or a normal transition, with the evidence used and a confidence.
//
// What the evidence can and cannot show: on a single-channel recording the recogniser's word timestamps touch at speaker
// changes and it usually transcribes only the louder of two simultaneous voices, so true overlap is often invisible. Overlap
// counts are therefore a lower bound, and `overlap_visibility` says so; nothing is claimed that the evidence does not support.
import type { Diarization } from './diarize.js';
import type { SttResult } from '../pipeline/stt/deepgram.js';

export type SttWord = SttResult['words'][number];

export interface Turn {
  speaker: number | null; // null = could not be attributed
  start: number | null;
  end: number | null;
  text: string;
  confidence: number; // mean word-level attribution confidence
  uncertain: boolean; // attribution below the confidence needed to state who spoke
}

export interface BackgroundSpeech { start: number | null; end: number | null; text: string }

export type BoundaryKind = 'simultaneous' | 'interruption' | 'backchannel' | 'transition';
export interface Boundary {
  kind: BoundaryKind;
  at: number; // seconds, start of the incoming turn
  from: number | null;
  to: number | null;
  gap_s: number; // negative = the incoming speaker started before the previous one finished
  overlap_s: number;
  confidence: number;
  evidence: string[];
}

export interface TurnAnalysis {
  turns: Turn[];
  background: BackgroundSpeech[];
  boundaries: Boundary[];
  overlap_visibility: 'timestamps' | 'limited' | 'not_applicable';
}

const UNCERTAIN_BELOW = 0.6;
const CUT_GAP_S = 0.5; // a new speaker starting within this long of a cut-off sentence is an interruption
const OVERLAP_MIN_S = 0.15;
const BACKCHANNEL = new Set(['yeah', 'yes', 'yep', 'yup', 'okay', 'ok', 'right', 'sure', 'mm', 'mhm', 'hmm', 'uh-huh', 'uh', 'huh', 'oh', 'alright', 'i', 'see', 'got', 'it', 'thanks', 'thank', 'you', 'sorry', 'go', 'ahead', 'please']);
// words a sentence rarely ends on: if the turn stops there, it was cut off
const DANGLING = new Set(['the', 'a', 'an', 'and', 'but', 'or', 'to', 'of', 'for', 'with', 'my', 'your', 'i', "it's", 'it', 'that', 'is', 'are', 'was', 'on', 'in', 'at', 'so', 'because', 'if', 'i\'m', 'we', 'you', 'this']);

const bare = (w: string) => w.toLowerCase().replace(/[^a-z'-]/g, '');
const finished = (w: string) => /[.?!]["')]*$/.test(w.trim());
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function buildTurns(words: SttWord[], d: Diarization | null, fallbackText: string): TurnAnalysis {
  if (!words.length) {
    return { turns: fallbackText.trim() ? [{ speaker: 0, start: null, end: null, text: fallbackText.trim(), confidence: 0.5, uncertain: false }] : [], background: [], boundaries: [], overlap_visibility: 'not_applicable' };
  }
  const turns: Turn[] = [];
  const background: BackgroundSpeech[] = [];
  const conf: number[][] = [];
  words.forEach((w, i) => {
    const a = d?.words[i] ?? { speaker: w.speaker ?? 0, confidence: 0.5, background: false };
    if (a.background) {
      const l = background[background.length - 1];
      if (l && l.end !== null && typeof w.start === 'number' && w.start - l.end < 0.6) { l.text += ` ${w.word}`; l.end = w.end ?? l.end; } else background.push({ start: w.start ?? null, end: w.end ?? null, text: w.word });
      return;
    }
    const last = turns[turns.length - 1];
    if (last && last.speaker === a.speaker) {
      last.text += ` ${w.word}`;
      last.end = w.end ?? last.end;
      conf[conf.length - 1].push(a.confidence);
    } else {
      turns.push({ speaker: a.speaker, start: w.start ?? null, end: w.end ?? null, text: w.word, confidence: 0, uncertain: false });
      conf.push([a.confidence]);
    }
  });
  turns.forEach((t, i) => {
    t.confidence = round(conf[i].reduce((s, x) => s + x, 0) / conf[i].length);
    t.uncertain = t.speaker === null || t.confidence < UNCERTAIN_BELOW;
  });

  const multi = (d?.speakers ?? 1) > 1;
  const boundaries: Boundary[] = [];
  for (let i = 1; i < turns.length; i += 1) {
    const prev = turns[i - 1];
    const cur = turns[i];
    if (prev.start === null || prev.end === null || cur.start === null || cur.end === null || prev.speaker === cur.speaker) continue;
    const gap = cur.start - prev.end;
    const overlap = Math.max(0, -gap);
    const evidence: string[] = [];
    const uncertain = prev.uncertain || cur.uncertain;
    const lastWord = prev.text.trim().split(/\s+/).pop() ?? '';
    const curWords = cur.text.trim().split(/\s+/);
    const cut = prev.text.trim().split(/\s+/).length >= 3 && !finished(lastWord);
    const dangling = DANGLING.has(bare(lastWord));
    const shortAck = curWords.length <= 3 && curWords.every((w) => BACKCHANNEL.has(bare(w)));
    const resumed = turns[i + 1]?.speaker === prev.speaker;

    let kind: BoundaryKind = 'transition';
    let confidence = 0.7;
    if (overlap >= OVERLAP_MIN_S) {
      kind = 'simultaneous';
      confidence = 0.9;
      evidence.push(`word timestamps of the two speakers overlap by ${round(overlap)} s`);
    } else if (shortAck && resumed && prev.text.trim().split(/\s+/).length >= 3) {
      kind = 'backchannel';
      confidence = 0.75;
      evidence.push(`${curWords.length}-word acknowledgement ("${cur.text.trim()}") and the previous speaker carried on`);
    } else if (cut && gap < CUT_GAP_S) {
      kind = 'interruption';
      confidence = dangling ? 0.7 : 0.55;
      evidence.push(`the previous speaker's sentence stops without an ending ("...${lastWord}")`);
      evidence.push(`the other speaker starts ${gap <= 0.05 ? 'immediately' : `${round(gap)} s later`}`);
      if (dangling) evidence.push('the last word is one a sentence does not normally end on');
    } else {
      evidence.push(`the previous turn ended ${finished(lastWord) ? 'with a complete sentence' : 'without punctuation'}, then a ${gap > 0.05 ? `${round(gap)} s pause` : 'direct hand-over'}`);
    }
    if (uncertain) { confidence = Math.min(confidence, 0.4); evidence.push('speaker attribution around this point is uncertain'); }
    boundaries.push({ kind, at: round(cur.start), from: prev.speaker, to: cur.speaker, gap_s: round(gap), overlap_s: round(overlap), confidence: round(confidence), evidence });
  }
  return { turns, background, boundaries, overlap_visibility: !multi ? 'not_applicable' : boundaries.some((b) => b.kind === 'simultaneous') ? 'timestamps' : 'limited' };
}
