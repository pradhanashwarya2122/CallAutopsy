// Turns the measurements (speech metrics, audio signal) and the call understanding into plain-language findings.
// Every finding cites the number it is based on, so it is checkable.
import type { AudioSignal } from './audioSignal.js';
import type { SpeechMetrics } from './speechMetrics.js';
import type { Understanding } from './callUnderstanding.js';
import type { SpeakerVoice } from './vocal.js';
import type { Diarization } from './diarize.js';
import type { TurnAnalysis } from './turns.js';

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

export interface FindingsInput {
  speech: SpeechMetrics;
  signal: AudioSignal | null;
  understanding: Understanding | null;
  sttProvider: string | null;
  diarization: Diarization | null;
  turns: TurnAnalysis;
  customerVoice: SpeakerVoice | null; // delivery measurements of the customer's own voice
  attributionReliable: boolean;
}

export function buildFindings(input: FindingsInput): Finding[] {
  const { speech: m, signal, understanding: u, sttProvider, diarization, turns, customerVoice, attributionReliable } = input;
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  // ---- audio quality
  if (signal) {
    if (signal.snr_db < 12) add({ id: 'noise_heavy', severity: 'issue', area: 'audio', title: 'Heavy background noise', detail: `Speech is only about ${Math.round(signal.snr_db)} dB above the noise (noise floor ${signal.noise_floor_db} dB).` });
    else if (signal.snr_db < 26) add({ id: 'noise', severity: 'warn', area: 'audio', title: 'Background noise', detail: `Speech is about ${Math.round(signal.snr_db)} dB above the noise floor, so the recognizer has less margin.` });
    if (signal.band_limited) add({ id: 'band_limited', severity: 'warn', area: 'audio', title: 'Limited bandwidth (phone-like, muffled or low-rate audio)', detail: signal.hf_ratio_db === null ? `The recording sample rate is only ${signal.sample_rate} Hz, so high frequencies are missing.` : `Almost nothing above 5 kHz (${signal.hf_ratio_db} dB relative to the speech band), which hides consonants such as s, f and t.` });
    if (signal.dynamics_compressed) add({ id: 'compressed', severity: 'info', area: 'audio', title: 'Heavily compressed loudness', detail: `Loudness barely varies (${signal.level_sd_db} dB), typical of a phone line or automatic gain control; quiet words can be lost.` });
    if (signal.clipping_ratio > 0.005) add({ id: 'clipping', severity: 'warn', area: 'audio', title: 'Audio clipping', detail: `${(signal.clipping_ratio * 100).toFixed(1)}% of samples are at full scale.` });
  } else if (m.low_confidence_ratio >= 0.1) {
    add({ id: 'noise', severity: 'warn', area: 'audio', title: 'Degraded audio', detail: `${plural(Math.round(m.low_confidence_ratio * m.word_count), 'word')} (${pct(m.low_confidence_ratio)}) were hard for the recognizer to hear.` });
  }

  // ---- transcription quality
  if (m.avg_confidence !== null && sttProvider === 'deepgram') {
    if (m.avg_confidence < 0.85) add({ id: 'stt_low', severity: 'issue', area: 'speech', title: 'Low transcription confidence', detail: `Average word confidence ${pct(m.avg_confidence)}; words like "${m.low_confidence_words.slice(0, 4).join('", "')}" are likely misheard.` });
    else if (m.avg_confidence < 0.95 || m.low_confidence_words.length >= 3) add({ id: 'stt_reduced', severity: 'warn', area: 'speech', title: 'Reduced transcription confidence', detail: `Average word confidence ${pct(m.avg_confidence)}${m.low_confidence_words.length ? `; uncertain words: "${m.low_confidence_words.slice(0, 5).join('", "')}"` : ''}.` });
  }

  // ---- how the customer speaks (the customer's own voice when it could be isolated, otherwise the whole recording)
  const cm = customerVoice?.measurements;
  const fillers = cm ? cm.filler_count : m.filler_count;
  const longPauses = cm ? cm.long_pauses : m.long_pause_count;
  const wpm = cm ? cm.articulation_wpm : m.words_per_minute;
  const whose = cm ? "the customer's voice" : 'the recording';
  if (fillers >= 8) add({ id: 'hesitation_heavy', severity: 'warn', area: 'speech', title: 'Very hesitant speech', detail: `${plural(fillers, 'filler word')} (um, uh) in ${whose}.` });
  else if (fillers >= 3) add({ id: 'hesitation', severity: 'warn', area: 'speech', title: 'Hesitant speech', detail: `${plural(fillers, 'filler word')} (um, uh) in ${whose}.` });
  if (longPauses >= 1) add({ id: 'long_pauses', severity: 'warn', area: 'speech', title: 'Long pauses', detail: `${plural(longPauses, 'pause')} over ${cm ? '1' : '1.5'} s${cm ? '' : `; the longest was ${m.longest_pause_s} s`} in ${whose}.` });
  else if (m.pause_count >= 4) add({ id: 'pauses', severity: 'info', area: 'speech', title: 'Frequent pauses', detail: `${plural(m.pause_count, 'pause')} over 0.7 s.` });
  if (wpm !== null && wpm !== undefined) {
    if (wpm > 185) add({ id: 'fast', severity: 'warn', area: 'speech', title: 'Fast speech', detail: `About ${wpm} words per minute in ${whose} (conversational is roughly 130-165).` });
    else if (wpm < 105) add({ id: 'slow', severity: 'info', area: 'speech', title: 'Slow speech', detail: `About ${wpm} words per minute in ${whose}.` });
  }

  // ---- who spoke, and how sure we are
  if (diarization) {
    if (m.speakers >= 2) add({ id: 'speakers', severity: 'info', area: 'conversation', title: `${m.speakers} speakers detected`, detail: `${diarization.source === 'acoustic' ? 'Found from the audio itself (the recognizer reported one speaker)' : diarization.source === 'recognizer+acoustic' ? 'Confirmed by both the recognizer and the audio' : 'Reported by the recognizer'}${diarization.voice_pitch_hz.length === 2 ? `; typical pitch ${diarization.voice_pitch_hz[0]} Hz and ${diarization.voice_pitch_hz[1]} Hz` : ''}.` });
    if (!attributionReliable) add({ id: 'attribution_uncertain', severity: 'warn', area: 'conversation', title: 'Who said what is uncertain', detail: diarization.notes[0] ?? 'Speaker labels could not be verified from the audio, so details are not attributed to a speaker.' });
    else if (turns.turns.some((t) => t.uncertain) && m.speakers >= 2) add({ id: 'attribution_partial', severity: 'info', area: 'conversation', title: 'Some lines could not be attributed', detail: `${turns.turns.filter((t) => t.uncertain).length} short line(s) are marked uncertain because the voice evidence was weak.` });
  }
  const events = turns.boundaries.filter((b) => b.kind === 'simultaneous' || b.kind === 'interruption');
  if (events.length) {
    const sim = events.filter((b) => b.kind === 'simultaneous');
    const cut = events.filter((b) => b.kind === 'interruption');
    const parts: string[] = [];
    if (sim.length) parts.push(`speakers talk over each other ${sim.length === 1 ? 'once' : `${sim.length} times`} (${m.overlap_s} s, confirmed by word timestamps)`);
    if (cut.length) parts.push(`${plural(cut.length, 'sentence')} cut off by the other speaker (at ${cut.map((b) => `${b.at} s`).join(', ')}; ${cut[0].evidence[0]})`);
    add({ id: 'overlap', severity: 'warn', area: 'conversation', title: 'Interruptions', detail: `${parts.join('; ')}.` });
  }
  if (turns.overlap_visibility === 'limited') add({ id: 'overlap_limited', severity: 'info', area: 'conversation', title: 'Overlapping speech may be hidden', detail: 'This is a single-channel recording: when two people talk at once the recognizer usually keeps only the louder voice, so interruptions are a lower bound.' });

  // ---- speech that is not part of the call
  const offTopic = u?.off_topic_speech ?? [];
  if (turns.background.length || offTopic.length) {
    const quotes = [...turns.background.map((b) => b.text), ...offTopic].slice(0, 2).map((t) => `"${t}"`).join(', ');
    add({ id: 'background_speech', severity: 'warn', area: 'audio', title: 'Speech from the environment', detail: `${turns.background.length ? 'Quiet speech that is not the caller or agent was left out of the conversation' : 'Some words in the transcript do not belong to the call'}: ${quotes}.` });
  }

  // ---- what was said
  if (u) {
    if (u.corrections.length) add({ id: 'corrections', severity: 'warn', area: 'content', title: `Customer corrected ${plural(u.corrections.length, 'detail')}`, detail: u.corrections.slice(0, 3).map((c) => `${c.field || 'detail'}: ${c.original} → ${c.corrected}`).join('; ') });
    if (u.ambiguities.length) add({ id: 'ambiguity', severity: 'warn', area: 'content', title: 'Unclear or conflicting information', detail: u.ambiguities[0] });
    const intents = 1 + u.secondary_intents.length;
    if (intents >= 3) add({ id: 'multi_intent', severity: 'warn', area: 'content', title: `${intents} separate issues raised`, detail: [u.primary_intent, ...u.secondary_intents].map((i) => i.label.replace(/_/g, ' ')).join(', ') });
    else if (intents === 2) add({ id: 'two_intents', severity: 'info', area: 'content', title: 'Two related issues raised', detail: [u.primary_intent, ...u.secondary_intents].map((i) => i.label.replace(/_/g, ' ')).join(' and ') });
    if (u.repetitions.length) add({ id: 'repetition', severity: 'info', area: 'content', title: 'Customer repeated information', detail: u.repetitions[0] });
    if (u.late_information.length) add({ id: 'late', severity: 'info', area: 'content', title: 'Key detail came late', detail: u.late_information[0] });
    if (u.intent_confidence === 'low') add({ id: 'intent_unclear', severity: 'warn', area: 'content', title: 'Intent is unclear', detail: 'The request could not be pinned down with confidence.' });
    if (u.dropped_unverified > 0) add({ id: 'ungrounded', severity: 'info', area: 'content', title: 'Some extracted details were discarded', detail: `${plural(u.dropped_unverified, 'detail')} proposed by the language model did not appear in the transcript and were removed.` });
  }
  return out;
}

export function rateDifficulty(findings: Finding[]): Difficulty {
  const weight = { info: 0.5, warn: 2, issue: 3 } as const;
  const score = findings.reduce((s, f) => s + weight[f.severity], 0);
  const label = score < 2 ? 'Easy' : score < 5 ? 'Moderate' : score < 9 ? 'Hard' : 'Severe';
  return { score, label };
}
