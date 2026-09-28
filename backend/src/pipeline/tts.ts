import OpenAI from 'openai';
import 'dotenv/config';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface TtsResult {
  audio: Buffer;
  bytes: number;
  approxDurationSec: number;
  model: string;
  charCount: number;
}

// tts-1 mp3 default ~ human speech pace ~ 15 chars/sec
const CHARS_PER_SECOND = 15;

export async function synthesize(text: string, opts: { voice?: string; model?: string } = {}): Promise<TtsResult> {
  if (!openai) throw new Error('OPENAI_API_KEY not set');
  const model = opts.model ?? 'tts-1';
  const voice = opts.voice ?? 'alloy';

  const res = await openai.audio.speech.create({
    model,
    voice: voice as any,
    input: text,
  });

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    audio: buf,
    bytes: buf.length,
    approxDurationSec: text.length / CHARS_PER_SECOND,
    model,
    charCount: text.length,
  };
}
