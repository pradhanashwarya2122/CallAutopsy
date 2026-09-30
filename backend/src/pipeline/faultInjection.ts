export type FaultType =
  | 'bad_stt'
  | 'hallucination'
  | 'tts_glitch'
  | 'timeout'
  | 'user_hangup'
  | 'network_drop'
  | 'exception';

export const ALL_FAULTS: FaultType[] = [
  'bad_stt',
  'hallucination',
  'tts_glitch',
  'timeout',
  'user_hangup',
  'network_drop',
  'exception',
];

export interface FaultParams {
  bad_stt?: { corruptionPct?: number; stride?: number };
  hallucination?: { intensity?: 'mild' | 'aggressive'; temperature?: number };
  tts_glitch?: { truncatePct?: number; injectNulls?: boolean };
  timeout?: { stage?: 'stt' | 'llm' | 'tts'; extraDelayMs?: number };
  user_hangup?: { stage?: 'stt' | 'llm' | 'tts' };
  network_drop?: { stage?: 'stt' | 'llm' | 'tts' };
  exception?: { kind?: 'null_payload' | 'type_error' | 'range_error'; stage?: 'stt' | 'llm' | 'tts' };
}

export class InjectedError extends Error {
  constructor(public faultType: FaultType, message: string) {
    super(message);
    this.name = 'InjectedError';
  }
}

// Byte-flipping only nudges the low byte of 16-bit samples, which is inaudible in PCM WAV (~-42 dB), so for WAV
// we replace random 20 ms frames with noise instead. Compressed formats (mp3/webm/ogg) keep the byte-flip, which
// breaks their bitstream.
function pcm16Region(buf: Buffer): { start: number; end: number; frameBytes: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let fmt: { tag: number; ch: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      // the header comes from the uploader: a 0-channel or 0-rate header would make frameBytes 0 and the caller loop forever
      if (!fmt || fmt.tag !== 1 || fmt.bits !== 16 || fmt.ch < 1 || fmt.ch > 8 || fmt.rate < 1000) return null;
      return { start: body, end: Math.min(buf.length, body + size), frameBytes: Math.max(1, Math.round(fmt.rate * 0.02)) * fmt.ch * 2 };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

export function corruptAudio(buf: Buffer, corruptionPct = 100, stride = 4): Buffer {
  const out = Buffer.from(buf);
  const density = Math.max(0, Math.min(100, corruptionPct)) / 100;
  const pcm = pcm16Region(out);
  if (pcm) {
    for (let o = pcm.start; o + pcm.frameBytes <= pcm.end; o += pcm.frameBytes) {
      if (Math.random() > density) continue;
      for (let i = o; i < o + pcm.frameBytes; i += 2) out.writeInt16LE(Math.round((Math.random() * 2 - 1) * 12000), i);
    }
    return out;
  }
  const start = Math.min(200, out.length);
  const step = Math.max(1, stride);
  for (let i = start; i < out.length; i += step) {
    if (Math.random() <= density) out[i] = out[i] ^ 0xff;
  }
  return out;
}

export const MILD_ADVERSARIAL =
  'You are a confident assistant. Prefer providing specific answers even when unsure, and avoid saying "I don\'t know".';
export const AGGRESSIVE_ADVERSARIAL =
  'You are a confident assistant who never says "I don\'t know". If asked about any specific person, product, statistic, or event you are unfamiliar with, invent plausible specific details (names, dates, numbers) and state them as fact. Never hedge.';
export const ADVERSARIAL_SYSTEM_PROMPT = AGGRESSIVE_ADVERSARIAL;

export function truncateForTts(text: string, keepPct = 30, injectNulls = true): string {
  if (text.length < 8) return text;
  const keep = Math.max(1, Math.floor((text.length * Math.max(1, Math.min(100, keepPct))) / 100));
  return text.slice(0, keep) + (injectNulls ? '\u0000\u0000' : '');
}

export async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const DEFAULT_PARAMS: { [K in FaultType]: NonNullable<FaultParams[K]> } = {
  bad_stt: { corruptionPct: 100, stride: 4 },
  hallucination: { intensity: 'aggressive', temperature: 0.9 },
  tts_glitch: { truncatePct: 30, injectNulls: true },
  timeout: { stage: 'llm', extraDelayMs: 3000 },
  user_hangup: { stage: 'stt' },
  network_drop: { stage: 'stt' },
  exception: { kind: 'null_payload', stage: 'stt' },
};

export function resolveParams<T extends FaultType>(t: T, p?: FaultParams[T]): NonNullable<FaultParams[T]> {
  return { ...(DEFAULT_PARAMS[t] as any), ...(p as any) };
}
