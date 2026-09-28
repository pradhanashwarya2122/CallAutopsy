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
  });

  const segments = res.segments ?? [];
  const avgLogProb = segments.length
    ? segments.reduce((s: number, seg: any) => s + (seg.avg_logprob ?? 0), 0) / segments.length
    : 0;
  // approx confidence from avg_logprob (log space; closer to 0 = better)
  const approxConfidence = Math.max(0, Math.min(1, Math.exp(avgLogProb)));

  return {
    transcript: res.text ?? '',
    words: [],
    avgConfidence: approxConfidence,
    audioDurationSec: res.duration ?? 0,
    provider: 'whisper',
    rawMeta: {
      duration: res.duration,
      avgLogProb,
      noSpeechProb: segments.length
        ? segments.reduce((s: number, seg: any) => s + (seg.no_speech_prob ?? 0), 0) / segments.length
        : 0,
    },
  };
}
