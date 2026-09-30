// Speaker attribution that does not trust the recogniser's speaker labels alone. Speech-to-text diarizers often collapse
// two voices into one on noisy, compressed or mono recordings, so the audio itself is measured too: the pitch of every
// phrase is compared, and a second voice is only reported when the phrases fall into two clearly separated pitch groups.
// When the evidence is weak the result says "uncertain" instead of inventing a second speaker or a confident label.
//
// Known limit: two voices with a similar pitch (for example two men with the same register) cannot be separated by pitch
// alone; the result is then a single voice unless the recogniser found two.
import { spanFeatures, type Frames } from './prosody.js';

export interface DiarWord { word: string; confidence: number; start?: number; end?: number; speaker?: number }

export type AttributionSource = 'recognizer' | 'acoustic' | 'recognizer+acoustic' | 'single_voice' | 'unavailable';

export interface WordAttribution {
  speaker: number | null; // null = could not be attributed
  confidence: number; // 0-1
  background: boolean; // much quieter than the main voices: not the customer or the agent
}

export interface Diarization {
  speakers: number; // distinct foreground voices
  source: AttributionSource;
  pitch_gap_semitones: number | null; // distance between the two voices' typical pitch (null when one voice)
  voice_pitch_hz: number[]; // typical pitch of each voice, in speaker order
  recognizer_speakers: number;
  agreement: number | null; // share of words where recogniser and acoustic labels agree (best label mapping)
  words: WordAttribution[];
  notes: string[];
}

// Tunables, calibrated on the bundled demo calls (bench/diarization-benchmark.ts prints the numbers behind them).
export const MIN_PITCH_DELTA_ST = 5.5; // two voices need their typical pitches at least this many semitones apart (demo calls: single voices <= 3.8, two voices >= 7.5)
export const MIN_DPRIME = 3.5; // ...and the groups must be tight compared with that distance
export const MIN_SECOND_VOICE_S = 1.0; // ...and the quieter voice needs at least this much measured speech
const MIN_CHUNK_FRAMES = 30; // voiced 10 ms frames needed before a phrase counts as a reliable pitch measurement
const PHRASE_PAUSE_S = 0.25;
export const SWITCH_COST = 20; // Viterbi penalty (squared semitones) for changing voice between neighbouring words; 5-10 flickered on single words, 40+ smoothed real short turns away
const PAUSE_DISCOUNT_S = 0.35;
const SAME_VOICE_ST = 3; // a quiet phrase within this many semitones of a known voice is that voice, not background
const BACKGROUND_DB = 12; // words this much quieter than the median foreground word are treated as background speech
const st = (hz: number) => 12 * Math.log2(hz / 100);

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

interface Phrase { first: number; last: number; start: number; end: number; frames: number; pitch: number | null; level: number | null }

export function phrases(words: DiarWord[], fr: Frames): Phrase[] {
  const out: Phrase[] = [];
  let first = 0;
  const flush = (last: number) => {
    const a = words[first];
    const b = words[last];
    if (typeof a.start !== 'number' || typeof b.end !== 'number') return;
    const f = spanFeatures(fr, a.start, b.end);
    out.push({ first, last, start: a.start, end: b.end, frames: f.frames, pitch: f.f0Median ? st(f.f0Median) : null, level: f.levelDb });
  };
  for (let i = 0; i < words.length; i += 1) {
    const nxt = words[i + 1];
    const gap = nxt && typeof nxt.start === 'number' && typeof words[i].end === 'number' ? nxt.start - (words[i].end as number) : 9;
    if (!nxt || gap > PHRASE_PAUSE_S || /[.?!]["')]*$/.test(words[i].word)) { flush(i); first = i + 1; }
  }
  return out;
}

// Best two-group split of the phrase pitches (weighted 1-D two-means). Accepted only when the groups are far apart
// (delta), tight compared with that distance (d'), and the quieter voice has enough speech to be a real participant.
function splitPitches(items: { pitch: number; weight: number }[]): { gap: number; cut: number; delta: number; dprime: number } | null {
  const s = [...items].sort((x, y) => x.pitch - y.pitch);
  const wsum = (g: typeof s) => g.reduce((a, i) => a + i.weight, 0);
  const wmean = (g: typeof s) => g.reduce((a, i) => a + i.pitch * i.weight, 0) / wsum(g);
  let best: { between: number; i: number; delta: number; pooled: number } | null = null;
  for (let i = 1; i < s.length; i += 1) {
    const lo = s.slice(0, i);
    const hi = s.slice(i);
    const mLo = wmean(lo);
    const mHi = wmean(hi);
    const vLo = lo.reduce((a, x) => a + x.weight * (x.pitch - mLo) ** 2, 0) / wsum(lo);
    const vHi = hi.reduce((a, x) => a + x.weight * (x.pitch - mHi) ** 2, 0) / wsum(hi);
    const between = (mHi - mLo) ** 2 * wsum(lo) * wsum(hi);
    if (!best || between > best.between) best = { between, i, delta: mHi - mLo, pooled: Math.sqrt((vLo * wsum(lo) + vHi * wsum(hi)) / (wsum(lo) + wsum(hi))) };
  }
  if (!best) return null;
  const dprime = best.delta / Math.max(best.pooled, 0.8);
  const lo = s.slice(0, best.i);
  const hi = s.slice(best.i);
  if (best.delta < MIN_PITCH_DELTA_ST || dprime < MIN_DPRIME) return null;
  if (Math.min(wsum(lo), wsum(hi)) / 100 < MIN_SECOND_VOICE_S) return null;
  return { gap: hi[0].pitch - lo[lo.length - 1].pitch, cut: (hi[0].pitch + lo[lo.length - 1].pitch) / 2, delta: best.delta, dprime };
}

export function diarize(words: DiarWord[], fr: Frames | null, opts: { switchCost?: number } = {}): Diarization {
  const switchCost = opts.switchCost ?? SWITCH_COST;
  const recog = words.map((w) => (typeof w.speaker === 'number' ? w.speaker : null));
  const recognizerSpeakers = new Set(recog.filter((s) => s !== null)).size;
  const base = { recognizer_speakers: recognizerSpeakers, agreement: null as number | null, pitch_gap_semitones: null as number | null, voice_pitch_hz: [] as number[] };
  const fromRecognizer = (conf: number, notes: string[]): Diarization => ({
    ...base,
    speakers: recognizerSpeakers || 1,
    source: recognizerSpeakers ? 'recognizer' : 'unavailable',
    words: words.map((_, i) => ({ speaker: recog[i], confidence: recog[i] === null ? 0 : conf, background: false })),
    notes,
  });

  if (!words.length) return { ...base, speakers: 0, source: 'unavailable', words: [], notes: ['This transcript has no word timings, so speakers could not be separated.'] };
  if (!fr) return fromRecognizer(0.5, ['Audio could not be analysed, so speaker labels come from the speech recogniser only and were not verified.']);

  const ph = phrases(words, fr);
  const reliable = ph.filter((p) => p.pitch !== null && p.frames >= MIN_CHUNK_FRAMES);
  const levels = reliable.map((p) => p.level ?? -100);
  const medLevel = levels.length ? median(levels) : 0;
  // with too little clear speech there is no reference level, so nothing can be called "quieter than the call"
  const canDetectBackground = reliable.length >= 3;
  // background: phrases far quieter than the main voices
  const quiet = new Set(canDetectBackground ? ph.filter((p) => p.level !== null && p.frames >= 8 && p.level < medLevel - BACKGROUND_DB) : []);
  const fg = reliable.filter((p) => !quiet.has(p));

  const split = fg.length >= 3 ? splitPitches(fg.map((p) => ({ pitch: p.pitch as number, weight: p.frames }))) : null;
  const notes: string[] = [];
  // A quiet phrase is background speech only if its pitch matches none of the voices found in the call: a quiet caller or agent
  // (speaker-phone, turned away) has the same pitch as their louder lines and stays in the conversation.
  const voiceCenters = split
    ? [median(fg.filter((p) => (p.pitch as number) < split.cut).map((p) => p.pitch as number)), median(fg.filter((p) => (p.pitch as number) >= split.cut).map((p) => p.pitch as number))]
    : fg.length ? [median(fg.map((p) => p.pitch as number))] : [];
  const isBackground = (p: Phrase) => quiet.has(p) && (p.pitch === null || !voiceCenters.some((c) => Math.abs(c - (p.pitch as number)) < SAME_VOICE_ST));
  const bgFlags = words.map((_, i) => ph.some((p) => isBackground(p) && i >= p.first && i <= p.last));
  const withBg = (arr: WordAttribution[]) => arr.map((a, i) => (bgFlags[i] ? { speaker: null, confidence: 0, background: true } : a));

  if (!split) {
    // one voice acoustically
    if (recognizerSpeakers >= 2) {
      notes.push(`The speech recogniser reported ${recognizerSpeakers} speakers but the audio shows one consistent pitch, so its labels are kept but marked uncertain. Two voices with a similar pitch cannot be told apart from the audio alone.`);
      const d = fromRecognizer(0.45, notes);
      return { ...d, agreement: null, words: withBg(d.words) };
    }
    if (reliable.length < 3) notes.push('Too little clear speech to compare voices, so a single speaker is assumed.');
    return {
      ...base,
      speakers: 1,
      source: 'single_voice',
      voice_pitch_hz: fg.length ? [Math.round(100 * 2 ** (median(fg.map((p) => p.pitch as number)) / 12))] : [],
      words: withBg(words.map(() => ({ speaker: 0, confidence: reliable.length >= 3 ? 0.9 : 0.6, background: false }))),
      notes,
    };
  }

  // ---- two voices: pitch groups, then word-level assignment smoothed along the call
  const groupOf = (p: number) => (p < split.cut ? 0 : 1);
  const groups = [0, 1].map((g) => fg.filter((p) => groupOf(p.pitch as number) === g));
  const centers = groups.map((g) => median(g.map((p) => p.pitch as number)));
  const sigma = groups.map((g, i) => Math.max(2, Math.sqrt(g.reduce((s, p) => s + ((p.pitch as number) - centers[i]) ** 2, 0) / g.length)));
  // number voices by first appearance
  const firstStart = groups.map((g) => Math.min(...g.map((p) => p.start)));
  const order = firstStart[0] <= firstStart[1] ? [0, 1] : [1, 0];

  const wordCost: (number[] | null)[] = words.map((w) => {
    if (typeof w.start !== 'number' || typeof w.end !== 'number') return null;
    const f = spanFeatures(fr, w.start, w.end);
    if (f.frames < 4 || !f.f0Median) return null;
    const pitch = st(f.f0Median);
    const weight = Math.min(1, f.frames / 12);
    return order.map((g) => weight * ((pitch - centers[g]) / sigma[g]) ** 2);
  });
  // Viterbi over words that have a measurement; the others inherit the path
  const idx = wordCost.map((c, i) => (c ? i : -1)).filter((i) => i >= 0 && !bgFlags[i]);
  const costs = idx.map((i) => wordCost[i] as number[]);
  const n = costs.length;
  const best = costs.map((c) => c.slice());
  const from = costs.map(() => [0, 0]);
  for (let i = 1; i < n; i += 1) {
    const gap = (words[idx[i]].start as number) - (words[idx[i - 1]].end as number);
    // people change turns at pauses and at sentence ends, so switching there is cheaper than in the middle of a phrase
    const boundary = gap >= PAUSE_DISCOUNT_S || /[.?!]["')]*$/.test(words[idx[i - 1]].word);
    const sw = boundary ? switchCost * 0.4 : switchCost;
    for (let k = 0; k < 2; k += 1) {
      const stay = best[i - 1][k];
      const move = best[i - 1][1 - k] + sw;
      if (move < stay) { best[i][k] += move; from[i][k] = 1 - k; } else { best[i][k] += stay; from[i][k] = k; }
    }
  }
  const path = Array(n).fill(0);
  let k = n && best[n - 1][1] < best[n - 1][0] ? 1 : 0;
  for (let i = n - 1; i >= 0; i -= 1) { path[i] = k; k = from[i][k]; }

  const attr: WordAttribution[] = words.map(() => ({ speaker: null, confidence: 0, background: false }));
  idx.forEach((wi, i) => {
    const [c0, c1] = costs[i];
    const margin = Math.abs(c0 - c1) / (c0 + c1 + 1e-9);
    attr[wi] = { speaker: path[i], confidence: Math.round(Math.min(0.98, 0.5 + margin) * 100) / 100, background: false };
  });
  // A 1-2 word run squeezed between two runs of the same voice, with no real pause on either side, is a pitch glitch (the
  // falling pitch at the end of a sentence often looks like the other voice), not a speaker change.
  for (let pass = 0; pass < words.length; pass += 1) { // one fix per pass, repeated until nothing changes
    let changed = false;
    const seq = idx.filter((wi) => attr[wi].speaker !== null);
    const runs: { from: number; to: number; sp: number }[] = [];
    seq.forEach((wi, k) => {
      const l = runs[runs.length - 1];
      if (l && l.sp === attr[wi].speaker) l.to = k; else runs.push({ from: k, to: k, sp: attr[wi].speaker as number });
    });
    for (let r = 1; r < runs.length - 1; r += 1) {
      const run = runs[r];
      if (run.to - run.from + 1 > 2 || runs[r - 1].sp !== runs[r + 1].sp) continue;
      const before = words[seq[run.from]].start as number - (words[seq[run.from - 1]].end as number);
      const after = (words[seq[run.to + 1]].start as number) - (words[seq[run.to]].end as number);
      if (before >= 0.3 || after >= 0.3) continue;
      for (let k = run.from; k <= run.to; k += 1) attr[seq[k]] = { speaker: runs[r - 1].sp, confidence: 0.5, background: false };
      changed = true;
      break;
    }
    if (!changed) break;
  }
  words.forEach((_, i) => {
    if (attr[i].speaker !== null || bgFlags[i]) return;
    let near = -1;
    for (const m of idx) if (near < 0 || Math.abs(m - i) < Math.abs(near - i)) near = m;
    if (near >= 0) attr[i] = { speaker: attr[near].speaker, confidence: Math.min(0.55, attr[near].confidence), background: false };
  });

  // Voices are numbered by who speaks first, whatever the pitch groups looked like.
  const firstWord = words.findIndex((_, i) => attr[i].speaker !== null);
  const swap = firstWord >= 0 && attr[firstWord].speaker === 1;
  if (swap) attr.forEach((a, i) => { if (a.speaker !== null) attr[i] = { ...a, speaker: 1 - a.speaker }; });
  const voicePitch = order.map((g) => Math.round(100 * 2 ** (centers[g] / 12)));
  if (swap) voicePitch.reverse();

  // ---- agreement with the recogniser (best mapping of its labels onto the two acoustic voices)
  let agreement: number | null = null;
  if (recognizerSpeakers >= 2) {
    const pairs = words.map((_, i) => [recog[i], attr[i].speaker] as const).filter(([a, b]) => a !== null && b !== null);
    if (pairs.length) {
      const labels = [...new Set(pairs.map((p) => p[0] as number))];
      agreement = Math.max(...labels.flatMap((l) => {
        const a = pairs.filter(([r, s]) => (r === l ? 0 : 1) === s).length / pairs.length;
        return [a, 1 - a];
      }));
    }
  }
  const source: AttributionSource = recognizerSpeakers >= 2 && agreement !== null && agreement >= 0.85 ? 'recognizer+acoustic' : 'acoustic';
  if (recognizerSpeakers < 2) notes.push('The speech recogniser reported one speaker; two distinct voices were found in the audio itself.');
  else if (source === 'acoustic') notes.push(`The recogniser's speaker labels agree with the audio only ${Math.round((agreement ?? 0) * 100)}% of the time, so the acoustic labels were used.`);
  return {
    ...base,
    speakers: 2,
    source,
    pitch_gap_semitones: Math.round(split.delta * 10) / 10,
    voice_pitch_hz: voicePitch,
    agreement,
    words: withBg(attr),
    notes,
  };
}
