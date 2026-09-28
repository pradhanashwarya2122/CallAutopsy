import { createClient } from '@deepgram/sdk';
import 'dotenv/config';
import { isDeepgramDown } from '../../admin/outageFlag.js';

export interface SttResult {
  transcript: string;
  words: Array<{ word: string; confidence: number }>;
  avgConfidence: number;
  audioDurationSec: number;
  provider: 'deepgram' | 'whisper';
  rawMeta: any;
}

const deepgram = process.env.DEEPGRAM_API_KEY
  ? createClient(process.env.DEEPGRAM_API_KEY)
  : null;

export async function transcribeWithDeepgram(audio: Buffer, mimeType = 'audio/wav'): Promise<SttResult> {
  if (!deepgram) throw new Error('DEEPGRAM_API_KEY not set');
  if (isDeepgramDown()) throw new Error('deepgram: simulated outage active');

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audio, {
    model: 'nova-3',
    smart_format: true,
    punctuate: true,
  });

  if (error) throw error;

  const channel = result?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = (alt?.words ?? []).map((w: any) => ({
    word: w.punctuated_word || w.word,
    confidence: w.confidence ?? 0,
  }));
  const avg = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
  const duration = result?.metadata?.duration ?? 0;

  return {
    transcript: alt?.transcript ?? '',
    words,
    avgConfidence: avg,
    audioDurationSec: duration,
    provider: 'deepgram',
    rawMeta: { duration, wordCount: words.length, confidence: alt?.confidence },
  };
}
