// How each speaker SOUNDS, measured from the audio: speaking rate, pauses and hesitation, pitch movement and loudness
// swings. These are delivery measurements, not feelings. An overall activation level ("arousal": calm to agitated) is
// estimated from them only when several cues agree and the recording is clean enough; otherwise it is reported as "unclear".
// Whether the person is happy or upset (valence) cannot be read reliably from a voice alone, so it is never claimed here;
// that comes from the words (lexical tone) and the two are combined in composeTone().
import { isVoiced, type Frames } from './prosody.js';
import type { Diarization } from './diarize.js';
import type { SttWord } from './turns.js';
import type { AudioSignal } from './audioSignal.js';

export type Level = 'low' | 'medium' | 'high';
export interface Cue { id: 'fast' | 'slow' | 'hesitant' | 'long_pauses' | 'wide_pitch' | 'narrow_pitch' | 'loudness_swings' | 'steady_loudness'; text: string }

export interface SpeakerVoice {
  speaker: number;
  words: number;
  speech_s: number;
  measurements: {
    pitch_hz: number | null;
    pitch_range_st: number | null; // p90 - p10 of voiced-frame pitch, semitones
    loudness_sd_db: number | null;
    articulation_wpm: number | null; // words per minute of actual speaking time (pauses over 0.3 s removed)
    pause_ratio: number; // share of the speaking span spent in pauses over 0.3 s
    long_pauses: number; // pauses over 1 s
    fillers_per_min: number;
    filler_count: number;
  };
  cues: Cue[];
  arousal: 'low' | 'medium' | 'high' | 'unclear';
  confidence: Level;
  reason: string;
}

export const THRESHOLDS = {
  fastWpm: 165, slowWpm: 125, // conversational speech is roughly 130-165 wpm
  wideSt: 11, narrowSt: 5,
  swingSd: 8, steadySd: 3.5,
  hesitantFillersPerMin: 3, hesitantPauseRatio: 0.25, longPauseCount: 2,
  minSpeechS: 8, // less speech than this and nothing is asserted
  minSnrDb: 15, // confidence needs a clean recording
  minToneSnrDb: 15, // below this pitch tracking and loudness are dominated by the noise, so no activation level is claimed
} as const;

const FILLERS = new Set(['uh', 'um', 'uhm', 'uhh', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mmm']);
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const sd = (a: number[]) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export function measureVoices(words: SttWord[], d: Diarization | null, fr: Frames | null, signal: AudioSignal | null): SpeakerVoice[] {
  if (!fr || !d) return [];
  const out: SpeakerVoice[] = [];
  for (let sp = 0; sp < Math.max(1, d.speakers); sp += 1) {
    const idx = words.map((_, i) => i).filter((i) => d.words[i]?.speaker === sp && typeof words[i].start === 'number' && typeof words[i].end === 'number');
    if (idx.length < 5) continue;
    const ws = idx.map((i) => words[i]);
    let pauseT = 0;
    let longPauses = 0;
    for (let k = 1; k < ws.length; k += 1) {
      const gap = (ws[k].start as number) - (ws[k - 1].end as number);
      if (gap > 0.3 && gap < 8) { pauseT += gap; if (gap > 1) longPauses += 1; }
    }
    const span = (ws[ws.length - 1].end as number) - (ws[0].start as number);
    const talkTime = Math.max(0.5, span - pauseT);
    const fillers = ws.filter((w) => FILLERS.has(w.word.toLowerCase().replace(/[^a-z]/g, ''))).length;
    const pitch: number[] = [];
    const level: number[] = [];
    for (const w of ws) {
      for (let i = Math.round((w.start as number) / fr.hop); i < Math.min(fr.count, Math.round((w.end as number) / fr.hop)); i += 1) {
        if (isVoiced(fr, i)) { pitch.push(12 * Math.log2(fr.f0[i] / 100)); level.push(fr.db[i]); }
      }
    }
    const speechS = pitch.length * fr.hop;
    const p10 = q(pitch, 0.1);
    const p90 = q(pitch, 0.9);
    const m = {
      pitch_hz: pitch.length ? Math.round(100 * 2 ** ((q(pitch, 0.5) as number) / 12)) : null,
      pitch_range_st: p10 !== null && p90 !== null ? r1(p90 - p10) : null,
      loudness_sd_db: r1(sd(level)),
      articulation_wpm: span > 2 ? Math.round(((ws.length - fillers) / talkTime) * 60) : null,
      pause_ratio: Math.round((pauseT / Math.max(span, 1)) * 100) / 100,
      long_pauses: longPauses,
      fillers_per_min: Math.round((fillers / Math.max(span, 1)) * 600) / 10,
      filler_count: fillers,
    };

    const T = THRESHOLDS;
    const cues: Cue[] = [];
    if (m.articulation_wpm !== null && m.articulation_wpm >= T.fastWpm) cues.push({ id: 'fast', text: `fast speech (${m.articulation_wpm} words per minute)` });
    if (m.articulation_wpm !== null && m.articulation_wpm <= T.slowWpm) cues.push({ id: 'slow', text: `slow speech (${m.articulation_wpm} words per minute)` });
    if (m.fillers_per_min >= T.hesitantFillersPerMin || (m.pause_ratio >= T.hesitantPauseRatio && m.long_pauses >= T.longPauseCount)) cues.push({ id: 'hesitant', text: `hesitant delivery (${m.fillers_per_min} fillers/min, ${Math.round(m.pause_ratio * 100)}% of the time in pauses)` });
    else if (m.long_pauses >= T.longPauseCount) cues.push({ id: 'long_pauses', text: `${m.long_pauses} long pauses` });
    if (m.pitch_range_st !== null && m.pitch_range_st >= T.wideSt) cues.push({ id: 'wide_pitch', text: `wide pitch movement (${m.pitch_range_st} semitones)` });
    if (m.pitch_range_st !== null && m.pitch_range_st <= T.narrowSt) cues.push({ id: 'narrow_pitch', text: `narrow pitch movement (${m.pitch_range_st} semitones)` });
    // loudness spread says nothing about the speaker when a compressed channel or steady noise flattens it
    const loudnessTrustworthy = !!signal && !signal.dynamics_compressed && signal.snr_db >= 18;
    if (loudnessTrustworthy && m.loudness_sd_db !== null && m.loudness_sd_db >= T.swingSd) cues.push({ id: 'loudness_swings', text: `large loudness swings (${m.loudness_sd_db} dB)` });
    if (loudnessTrustworthy && m.loudness_sd_db !== null && m.loudness_sd_db <= T.steadySd) cues.push({ id: 'steady_loudness', text: `very steady loudness (${m.loudness_sd_db} dB)` });

    // activation: fast, wide pitch and loudness swings push up; slow, narrow pitch and steady loudness push down
    const up = cues.filter((c) => ['fast', 'wide_pitch', 'loudness_swings'].includes(c.id)).length;
    const down = cues.filter((c) => ['slow', 'narrow_pitch', 'steady_loudness'].includes(c.id)).length;
    const score = up - down;
    const clean = signal ? signal.snr_db >= T.minSnrDb && !signal.band_limited && signal.clipping_ratio < 0.005 : false;
    let arousal: SpeakerVoice['arousal'] = 'unclear';
    let confidence: Level = 'low';
    let reason: string;
    if (speechS < T.minSpeechS) reason = `Only ${Math.round(speechS)} s of clear speech from this speaker; too little to judge how it sounds.`;
    else if (!signal || signal.snr_db < T.minToneSnrDb) reason = 'The recording is too noisy (or could not be measured) to judge how the voice sounds.';
    else if (score >= 2 && down === 0) { arousal = 'high'; reason = `${up} cues agree on an animated delivery.`; }
    else if (score <= -2 && up === 0) { arousal = 'low'; reason = `${down} cues agree on a subdued delivery.`; }
    else if (up === 0 && down === 0) { arousal = 'medium'; reason = 'Rate, pitch movement and loudness are all in the ordinary range.'; }
    else reason = 'The delivery cues point in different directions, so no activation level is claimed.';
    if (arousal !== 'unclear') {
      // even agreeing cues are weak evidence about a feeling, so confidence never exceeds "medium" and needs a clean recording
      confidence = clean && Math.abs(score) >= 2 && speechS >= 15 ? 'medium' : 'low';
      if (!clean) reason += ' The recording is noisy or band-limited, which distorts pitch and loudness, so this is a weak indication.';
    }
    out.push({ speaker: sp, words: ws.length, speech_s: Math.round(speechS * 10) / 10, measurements: m, cues, arousal, confidence, reason });
  }
  return out;
}

export interface Tone {
  lexical: { emotion: string; valence: string; intensity: Level; evidence: string } | null; // from the words only
  vocal: { arousal: SpeakerVoice['arousal']; hesitant: boolean; confidence: Level; cues: string[]; reason: string } | null; // from the audio only
  overall: { label: string; confidence: Level; agreement: 'agree' | 'differ' | 'words_only' | 'voice_only' | 'insufficient'; basis: string };
}

const HIGH_ENERGY = new Set(['frustrated', 'angry', 'impatient', 'rushed', 'nervous']);

// Combines the two independent readings. Words and voice are never averaged into one claim: the overall label says what each
// source supports, and confidence drops when they disagree or one is missing.
export function composeTone(lex: Tone['lexical'], voice: SpeakerVoice | null): Tone {
  const vocal: Tone['vocal'] = voice ? {
    arousal: voice.arousal,
    hesitant: voice.cues.some((c) => c.id === 'hesitant'),
    confidence: voice.confidence,
    cues: voice.cues.map((c) => c.text),
    reason: voice.reason,
  } : null;
  const wordsClear = !!lex && !['not_evident', 'unclear', 'neutral'].includes(lex.emotion); // "neutral" = the wording shows no emotion
  const voiceClear = !!vocal && vocal.arousal !== 'unclear';

  if (!wordsClear && !voiceClear) {
    return { lexical: lex, vocal, overall: { label: 'not evident', confidence: 'low', agreement: 'insufficient', basis: lex?.emotion === 'neutral' ? 'The wording is businesslike and the delivery gives no clear signal, so no emotion is claimed.' : 'Neither the wording nor the delivery gives clear evidence of an emotional state.' } };
  }
  if (wordsClear && !voiceClear) {
    return { lexical: lex, vocal, overall: { label: (lex as NonNullable<Tone['lexical']>).emotion, confidence: 'low', agreement: 'words_only', basis: 'Judged from the words only; the voice gave no clear indication.' } };
  }
  if (!wordsClear && voiceClear) {
    const v = vocal as NonNullable<Tone['vocal']>;
    const label = v.arousal === 'high' ? 'animated delivery' : v.arousal === 'low' ? 'subdued delivery' : v.hesitant ? 'hesitant delivery' : 'even delivery';
    return { lexical: lex, vocal, overall: { label, confidence: 'low', agreement: 'voice_only', basis: 'The words show no clear emotion; this describes only how the voice sounds, not necessarily how the caller feels.' } };
  }
  const l = lex as NonNullable<Tone['lexical']>;
  const v = vocal as NonNullable<Tone['vocal']>;
  const wordsHigh = HIGH_ENERGY.has(l.emotion);
  const wordsCalm = l.emotion === 'calm' || l.emotion === 'relieved';
  const agree = (wordsHigh && (v.arousal === 'high' || (l.emotion === 'nervous' && v.hesitant))) || (wordsCalm && v.arousal !== 'high') || (l.emotion === 'confused' && (v.hesitant || v.arousal === 'low'));
  const differ = (wordsHigh && v.arousal === 'low') || (wordsCalm && v.arousal === 'high');
  if (agree) {
    return { lexical: lex, vocal, overall: { label: l.emotion, confidence: v.confidence === 'medium' && l.intensity !== 'low' ? 'medium' : 'low', agreement: 'agree', basis: `The words (${l.emotion}) and the way it sounds (${v.arousal === 'unclear' ? 'hesitant' : `${v.arousal} activation`}) point the same way.` } };
  }
  if (differ) {
    return { lexical: lex, vocal, overall: { label: `mixed signals: wording suggests ${l.emotion}, delivery sounds ${v.arousal === 'low' ? 'subdued' : 'animated'}`, confidence: 'low', agreement: 'differ', basis: 'Words and delivery disagree, so no single emotion is claimed.' } };
  }
  return { lexical: lex, vocal, overall: { label: l.emotion, confidence: 'low', agreement: 'words_only', basis: 'Judged mainly from the words; the delivery neither confirms nor contradicts it.' } };
}
