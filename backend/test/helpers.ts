// Shared helpers for the tests: real demo-call fixtures and small synthetic signals.
import fs from 'node:fs';
import path from 'node:path';
import { readPcm16, type Pcm } from '../src/analysis/audioIO.js';
import { extractFrames, type Frames } from '../src/analysis/prosody.js';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const SAMPLES = path.join(ROOT, 'samples');

export interface SttFixture { id: string; transcript: string; duration: number; words: { word: string; confidence: number; start: number; end: number; speaker?: number }[] }

// Real Deepgram output captured for each bundled demo call (bench/capture-stt.mjs).
export const sttFixture = (id: string): SttFixture => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/stt', `${id}.json`), 'utf8'));
export const wavBuffer = (id: string) => fs.readFileSync(path.join(SAMPLES, `${id}.wav`));
export const truthSegments = (id: string): { who: string; text: string; start: number; end: number }[] | null => {
  const f = path.join(SAMPLES, 'truth', `${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).segments : null;
};
export const framesOf = (id: string): Frames => extractFrames(readPcm16(wavBuffer(id)) as Pcm);
export const sttOutcome = (id: string) => { const s = sttFixture(id); return { ...s, audioDurationSec: s.duration, provider: 'deepgram' as const, avgConfidence: 0, rawMeta: {}, failoverOccurred: false }; };

export const DEMO_IDS = fs.readdirSync(path.join(ROOT, 'test/fixtures/stt')).map((f) => f.replace(/\.json$/, ''));

// ---------- synthetic signals ----------
// A crude "voice": a harmonic series at f0 with a spectral tilt and a slow amplitude wobble. Good enough for pitch tracking.
export function voiceSignal(f0: number, seconds: number, rate = 16000, amp = 0.3): Float64Array {
  const n = Math.round(seconds * rate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    let v = 0;
    for (let h = 1; h * f0 < rate / 2 - 500 && h <= 20; h += 1) v += Math.sin(2 * Math.PI * h * f0 * t) / h ** 1.2;
    out[i] = amp * v * (0.75 + 0.25 * Math.sin(2 * Math.PI * 3 * t));
  }
  return out;
}

export function whiteNoise(seconds: number, rate: number, amp: number, seed = 1): Float64Array {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return Float64Array.from({ length: Math.round(seconds * rate) }, () => (rnd() * 2 - 1) * amp);
}

export function toWav(samples: Float64Array, rate = 16000): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export const pcmOf = (samples: Float64Array, rate = 16000): Pcm => ({ samples, rate });

// Lay several voiced segments on a timeline and return the mixed signal plus word timings, one word per 0.3 s.
export interface Line { f0: number; start: number; seconds: number; text: string; amp?: number; speaker?: number }
export function scene(lines: Line[], rate = 16000) {
  const total = Math.max(...lines.map((l) => l.start + l.seconds)) + 0.3;
  const mix = new Float64Array(Math.round(total * rate));
  const words: { word: string; confidence: number; start: number; end: number; speaker?: number }[] = [];
  for (const l of lines) {
    const sig = voiceSignal(l.f0, l.seconds, rate, l.amp ?? 0.3);
    const off = Math.round(l.start * rate);
    sig.forEach((v, i) => { mix[off + i] += v; });
    const toks = l.text.split(' ');
    const per = l.seconds / toks.length;
    toks.forEach((w, k) => words.push({ word: w, confidence: 0.95, start: +(l.start + k * per).toFixed(3), end: +(l.start + (k + 1) * per - 0.02).toFixed(3), speaker: l.speaker }));
  }
  words.sort((a, b) => a.start - b.start);
  return { pcm: pcmOf(mix, rate), words, total };
}
