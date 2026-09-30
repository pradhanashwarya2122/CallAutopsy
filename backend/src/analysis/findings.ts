// Turns the measurements (speech metrics, audio signal) and the call understanding into plain-language findings.
// Every finding cites the number it is based on, so it is checkable.
import type { AudioSignal } from './audioSignal.js';
import type { SpeechMetrics } from './speechMetrics.js';
import type { Understanding } from './callUnderstanding.js';

export interface Finding {
  id: string;
  severity: 'info' | 'warn' | 'issue';
  area: 'audio' | 'speech' | 'conversation' | 'content';
  title: string;
  detail: string;
}
export interface Difficulty { score: number; label: 'Easy' | 'Moderate' | 'Hard' | 'Severe' }

const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function buildFindings(
  m: SpeechMetrics,
  signal: AudioSignal | null,
  u: Understanding | null,
  sttProvider: string | null,
): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  // ---- audio quality ----
  if (signal) {
    if (signal.snr_db < 12) add({ id: 'noise_heavy', severity: 'issue', area: 'audio', title: 'Heavy background noise', detail: `Speech is only about ${Math.round(signal.snr_db)} dB above the noise (noise floor ${signal.noise_floor_db} dB).` });
    else if (signal.snr_db < 22) add({ id: 'noise', severity: 'warn', area: 'audio', title: 'Background noise', detail: `Speech is about ${Math.round(signal.snr_db)} dB above the noise floor, so the recognizer has less margin.` });
    if (signal.narrowband) add({ id: 'narrowband', severity: 'warn', area: 'audio', title: 'Limited bandwidth (phone-like or muffled audio)', detail: `Almost no energy above 4 kHz (${signal.hf_ratio_db} dB relative to the speech band), which hides consonants such as s, f and t.` });
    if (signal.clipping_ratio > 0.005) add({ id: 'clipping', severity: 'warn', area: 'audio', title: 'Audio clipping', detail: `${(signal.clipping_ratio * 100).toFixed(1)}% of samples are at full scale.` });
  } else if (m.low_confidence_ratio >= 0.1) {
    add({ id: 'noise', severity: 'warn', area: 'audio', title: 'Degraded audio', detail: `${plural(Math.round(m.low_confidence_ratio * m.word_count), 'word')} (${pct(m.low_confidence_ratio)}) were hard for the recognizer to hear.` });
  }

  // ---- transcription quality ----
  if (m.avg_confidence !== null && sttProvider === 'deepgram') {
    if (m.avg_confidence < 0.85) add({ id: 'stt_low', severity: 'issue', area: 'speech', title: 'Low transcription confidence', detail: `Average word confidence ${pct(m.avg_confidence)}; words like "${m.low_confidence_words.slice(0, 4).join('", "')}" are likely misheard.` });
    else if (m.avg_confidence < 0.95 || m.low_confidence_words.length >= 3) add({ id: 'stt_reduced', severity: 'warn', area: 'speech', title: 'Reduced transcription confidence', detail: `Average word confidence ${pct(m.avg_confidence)}${m.low_confidence_words.length ? `; uncertain words: "${m.low_confidence_words.slice(0, 5).join('", "')}"` : ''}.` });
  }

  // ---- how the customer speaks ----
  if (m.filler_count >= 8) add({ id: 'hesitation_heavy', severity: 'warn', area: 'speech', title: 'Very hesitant speech', detail: `${plural(m.filler_count, 'filler word')} (um, uh) in ${Math.round(m.duration_s)} s.` });
  else if (m.filler_count >= 3) add({ id: 'hesitation', severity: 'warn', area: 'speech', title: 'Hesitant speech', detail: `${plural(m.filler_count, 'filler word')} (um, uh) detected.` });
  if (m.long_pause_count >= 1) add({ id: 'long_pauses', severity: 'warn', area: 'speech', title: 'Long pauses', detail: `${plural(m.long_pause_count, 'pause')} over 1.5 s; the longest was ${m.longest_pause_s} s.` });
  else if (m.pause_count >= 4) add({ id: 'pauses', severity: 'info', area: 'speech', title: 'Frequent pauses', detail: `${plural(m.pause_count, 'pause')} over 0.7 s.` });
  if (m.words_per_minute !== null) {
    if (m.words_per_minute > 185) add({ id: 'fast', severity: 'warn', area: 'speech', title: 'Fast speech', detail: `About ${m.words_per_minute} words per minute (conversational is roughly 130-160).` });
    else if (m.words_per_minute < 105) add({ id: 'slow', severity: 'info', area: 'speech', title: 'Slow speech', detail: `About ${m.words_per_minute} words per minute.` });
  }

  // ---- conversation structure ----
  if (m.speakers >= 2) add({ id: 'speakers', severity: 'info', area: 'conversation', title: `${m.speakers} speakers detected`, detail: 'The recording contains more than one voice (for example customer and agent).' });
  if (m.overlap_count >= 1 || m.interruption_count >= 1) {
    const parts: string[] = [];
    if (m.overlap_count) parts.push(`speakers talk over each other ${m.overlap_count === 1 ? 'once' : `${m.overlap_count} times`} (about ${m.overlap_s} s)`);
    if (m.interruption_count) parts.push(`${plural(m.interruption_count, 'sentence')} cut off mid-way by the other speaker`);
    add({ id: 'overlap', severity: 'warn', area: 'conversation', title: 'Interruptions / overlapping speech', detail: `${parts.join('; ')}. Words spoken at the same time are often lost or merged in a single-channel recording.` });
  }

  // ---- what was said ----
  if (u) {
    if (u.corrections.length) add({ id: 'corrections', severity: 'warn', area: 'content', title: `Customer corrected ${plural(u.corrections.length, 'detail')}`, detail: u.corrections.slice(0, 3).map((c) => `${c.field || 'detail'}: ${c.original} → ${c.corrected}`).join('; ') });
    if (u.ambiguities.length) add({ id: 'ambiguity', severity: 'warn', area: 'content', title: 'Unclear or conflicting information', detail: u.ambiguities[0] });
    const intents = 1 + u.secondary_intents.length;
    if (intents >= 3) add({ id: 'multi_intent', severity: 'warn', area: 'content', title: `${intents} separate issues raised`, detail: [u.primary_intent, ...u.secondary_intents].map((i) => i.label.replace(/_/g, ' ')).join(', ') });
    else if (intents === 2) add({ id: 'two_intents', severity: 'info', area: 'content', title: 'Two related issues raised', detail: [u.primary_intent, ...u.secondary_intents].map((i) => i.label.replace(/_/g, ' ')).join(' and ') });
    if (u.repetitions.length) add({ id: 'repetition', severity: 'info', area: 'content', title: 'Customer repeated information', detail: u.repetitions[0] });
    if (u.late_information.length) add({ id: 'late', severity: 'info', area: 'content', title: 'Key detail came late', detail: u.late_information[0] });
    if (u.intent_confidence === 'low') add({ id: 'intent_unclear', severity: 'warn', area: 'content', title: 'Intent is unclear', detail: 'The request could not be pinned down with confidence.' });
  }
  return out;
}

export function rateDifficulty(findings: Finding[]): Difficulty {
  const weight = { info: 0.5, warn: 2, issue: 3 } as const;
  const score = findings.reduce((s, f) => s + weight[f.severity], 0);
  const label = score < 2 ? 'Easy' : score < 5 ? 'Moderate' : score < 9 ? 'Hard' : 'Severe';
  return { score, label };
}
