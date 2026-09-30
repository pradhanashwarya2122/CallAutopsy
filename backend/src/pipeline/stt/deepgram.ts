import { createClient } from '@deepgram/sdk';
import 'dotenv/config';
import { isDeepgramDown } from '../../admin/outageFlag.js';

export interface SttResult {
  transcript: string;
  words: Array<{ word: string; confidence: number; start?: number; end?: number; speaker?: number }>;
  avgConfidence: number;
  audioDurationSec: number;
  provider: 'deepgram' | 'whisper';
  rawMeta: any;
}

const deepgram = process.env.DEEPGRAM_API_KEY
  ? createClient(process.env.DEEPGRAM_API_KEY)
  : null;

export async function transcribeWithDeepgram(audio: Buffer, _mimeType = 'audio/wav', ownerId?: string): Promise<SttResult> {
  if (!deepgram) throw new Error('DEEPGRAM_API_KEY not set');
  if (isDeepgramDown(ownerId)) throw new Error('deepgram: simulated outage active');

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audio, {
    model: 'nova-3',
    smart_format: true,
    punctuate: true,
    diarize: true,
    filler_words: true,
  });

  if (error) throw error;

  const channel = result?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = (alt?.words ?? []).map((w: any) => ({
    word: w.punctuated_word || w.word,
    confidence: w.confidence ?? 0,
    start: typeof w.start === 'number' ? w.start : undefined,
    end: typeof w.end === 'number' ? w.end : undefined,
    speaker: typeof w.speaker === 'number' ? w.speaker : undefined,
  }));
  const avg = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
  const duration = result?.metadata?.duration ?? 0;

  return {
    transcript: alt?.transcript ?? '',
    words,
    avgConfidence: avg,
    audioDurationSec: duration,
    provider: 'deepgram',
    rawMeta: { duration, wordCount: words.length, confidence: alt?.confidence, avgConfidence: avg },
  };
}
