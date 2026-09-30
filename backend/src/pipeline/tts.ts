import OpenAI from 'openai';
import 'dotenv/config';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface TtsResult {
  audio: Buffer;
  bytes: number;
  approxDurationSec: number;
  model: string;
  charCount: number;
  truncated: boolean; // the reply was longer than the API accepts and was cut at a sentence end
}

// The API rejects input over 4096 characters. A runaway reply (a hallucinating model at a high temperature can write pages) must be
// cut before it is spoken, not crash the stage and be diagnosed as an unrelated exception. Cut at the last sentence end.
export const TTS_MAX_CHARS = 4000;
export function prepareTtsInput(text: string): { input: string; truncated: boolean } {
  const t = text.trim() || '.';
  if (t.length <= TTS_MAX_CHARS) return { input: t, truncated: false };
  const head = t.slice(0, TTS_MAX_CHARS);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '), head.lastIndexOf('.\n'));
  return { input: cut > TTS_MAX_CHARS * 0.5 ? head.slice(0, cut + 1) : head, truncated: true };
}

// tts-1 mp3 default ~ human speech pace ~ 15 chars/sec
const CHARS_PER_SECOND = 15;

export async function synthesize(text: string, opts: { voice?: string; model?: string } = {}): Promise<TtsResult> {
  if (!openai) throw new Error('OPENAI_API_KEY not set');
  const model = opts.model ?? 'tts-1';
  const voice = opts.voice ?? 'alloy';

  const { input, truncated } = prepareTtsInput(text);
  const res = await openai.audio.speech.create({
    model,
    voice: voice as any,
    input,
  });

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    audio: buf,
    bytes: buf.length,
    approxDurationSec: input.length / CHARS_PER_SECOND,
    model,
    charCount: input.length,
    truncated,
  };
}
