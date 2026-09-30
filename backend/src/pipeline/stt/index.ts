import { transcribeWithDeepgram, type SttResult } from './deepgram.js';
import { transcribeWithWhisper } from './whisper.js';

export type { SttResult };

export interface SttOutcome extends SttResult {
  failoverOccurred: boolean;
  primaryError?: string;
}

export async function transcribe(
  audio: Buffer,
  opts: { preferredProvider?: 'deepgram' | 'whisper'; timeoutMs?: number; audioExt?: string; ownerId?: string } = {},
): Promise<SttOutcome> {
  const preferred = opts.preferredProvider ?? 'deepgram';
  const timeoutMs = opts.timeoutMs ?? 10000;

  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('stt timeout')), timeoutMs)),
    ]);

  const filename = `audio.${opts.audioExt && /^[a-z0-9]{1,5}$/i.test(opts.audioExt) ? opts.audioExt.toLowerCase() : 'wav'}`;
  const dg = (a: Buffer) => transcribeWithDeepgram(a, 'audio/wav', opts.ownerId);
  const wh = (a: Buffer) => transcribeWithWhisper(a, filename);
  const primary = preferred === 'deepgram' ? dg : wh;
  const fallback = preferred === 'deepgram' ? wh : dg;

  try {
    const res = await withTimeout(primary(audio));
    return { ...res, failoverOccurred: false };
  } catch (err) {
    const primaryError = (err as Error).message;
    const res = await withTimeout(fallback(audio));
    return { ...res, failoverOccurred: true, primaryError };
  }
}
