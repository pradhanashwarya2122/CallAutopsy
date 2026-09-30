import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import 'dotenv/config';
import type { SttResult } from './deepgram.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function transcribeWithWhisper(audio: Buffer, filename = 'audio.wav'): Promise<SttResult> {
  if (!openai) throw new Error('OPENAI_API_KEY not set');

  const file = await toFile(audio, filename);
  const res: any = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'], // word timings let speaker separation, pauses and fillers work on this provider too
  });

  return parseWhisperResponse(res);
}

// Whisper's word list has no punctuation, but sentence ends are how a call is split into phrases (and turns), so each word gets
// the punctuation that follows it in the transcript text.
export function attachPunctuation<T extends { word: string }>(words: T[], text: string): T[] {
  const lower = text.toLowerCase();
  let pos = 0;
  return words.map((w) => {
    const at = lower.indexOf(w.word.toLowerCase(), pos);
    if (at < 0 || at - pos > 12) return w; // lost track: leave this word as it is
    let end = at + w.word.length;
    let tail = '';
    while (end < text.length && /[.,!?;:"')…-]/.test(text[end])) { tail += text[end]; end += 1; }
    pos = end;
    return { ...w, word: `${w.word}${tail}` };
  });
}

// Pure, so it can be tested against real recorded responses.
export function parseWhisperResponse(res: any): SttResult {
  const segments = res.segments ?? [];
  const avgLogProb = segments.length
    ? segments.reduce((s: number, seg: any) => s + (seg.avg_logprob ?? 0), 0) / segments.length
    : 0;
  // approx confidence from avg_logprob (log space; closer to 0 = better)
  const approxConfidence = Math.max(0, Math.min(1, Math.exp(avgLogProb)));

  // Whisper gives no per-word confidence, so each word carries the confidence of the segment it falls in (a coarser signal than
  // Deepgram's, and labelled as such by the provider field). It gives no speaker labels either; those come from the audio.
  const segConf = (t: number) => {
    const seg = segments.find((x: any) => t >= x.start && t <= x.end);
    return seg ? Math.max(0, Math.min(1, Math.exp(seg.avg_logprob ?? avgLogProb))) : approxConfidence;
  };
  const mapped: SttResult['words'] = (res.words ?? []).map((w: any) => ({
    word: String(w.word ?? '').trim(),
    confidence: segConf(((w.start ?? 0) + (w.end ?? 0)) / 2),
    start: typeof w.start === 'number' ? w.start : undefined,
    end: typeof w.end === 'number' ? w.end : undefined,
  }));
  const words = attachPunctuation(mapped.filter((w) => w.word), String(res.text ?? ''));

  return {
    transcript: res.text ?? '',
    words,
    avgConfidence: approxConfidence,
    audioDurationSec: res.duration ?? 0,
    provider: 'whisper',
    rawMeta: {
      duration: res.duration,
      avgConfidence: approxConfidence,
      wordCount: words.length,
      avgLogProb,
      noSpeechProb: segments.length
        ? segments.reduce((s: number, seg: any) => s + (seg.no_speech_prob ?? 0), 0) / segments.length
        : 0,
    },
  };
}
