// Frame-level voice features (pitch, loudness, spectral envelope) computed from the audio itself. They feed speaker
// separation (who is talking), overlap evidence and vocal-delivery measurements. No model, no network call.
import { fft, type Pcm } from './audioIO.js';

export const CEP_DIM = 12;

export interface Frames {
  hop: number; // seconds between frames
  count: number;
  f0: Float32Array; // Hz, 0 when the frame is not voiced
  voicing: Float32Array; // normalised autocorrelation peak, 0-1
  db: Float32Array; // frame level in dB re full scale
  cep: Float32Array; // CEP_DIM cepstral coefficients per frame (spectral envelope shape)
  floorDb: number; // level of the quietest tenth of frames
}

const HOP_S = 0.01;
const F0_MIN = 60;
const F0_MAX = 400;

function melBank(rate: number, nfft: number, bands: number, lo: number, hi: number): Float64Array[] {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const inv = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const pts = Array.from({ length: bands + 2 }, (_, i) => inv(mel(lo) + ((mel(hi) - mel(lo)) * i) / (bands + 1)));
  const bins = pts.map((f) => (f * nfft) / rate);
  return Array.from({ length: bands }, (_, b) => {
    const w = new Float64Array(nfft / 2);
    for (let k = 0; k < nfft / 2; k += 1) {
      if (k > bins[b] && k <= bins[b + 1]) w[k] = (k - bins[b]) / (bins[b + 1] - bins[b]);
      else if (k > bins[b + 1] && k < bins[b + 2]) w[k] = (bins[b + 2] - k) / (bins[b + 2] - bins[b + 1]);
    }
    return w;
  });
}

// Only 100-3800 Hz is used for the spectral envelope so a phone line or muffled microphone changes it as little as possible.
function* extractSteps(pcm: Pcm): Generator<void, Frames> {
  const { samples, rate } = pcm;
  const hop = Math.round(rate * HOP_S);
  const count = Math.max(0, Math.floor((samples.length - Math.round(rate * 0.04)) / hop));

  // pitch runs on a ~8 kHz copy (average of neighbouring samples is a crude but sufficient low-pass)
  const dec = Math.max(1, Math.round(rate / 8000));
  const x8 = new Float64Array(Math.floor(samples.length / dec));
  for (let i = 0; i < x8.length; i += 1) {
    let a = 0;
    for (let d = 0; d < dec; d += 1) a += samples[i * dec + d];
    x8[i] = a / dec;
  }
  const rate8 = rate / dec;
  const win = Math.round(rate8 * 0.04);
  const hop8 = Math.round(rate8 * HOP_S);
  const lagMin = Math.floor(rate8 / F0_MAX);
  const lagMax = Math.ceil(rate8 / F0_MIN);

  let nfft = 1;
  while (nfft < rate * 0.032) nfft <<= 1;
  const bank = melBank(rate, nfft, 22, 100, Math.min(3800, rate / 2 - 100));
  const hann = new Float64Array(nfft);
  for (let i = 0; i < nfft; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nfft - 1));
  const dct = Array.from({ length: CEP_DIM }, (_, c) => Float64Array.from({ length: bank.length }, (_, b) => Math.cos((Math.PI * (c + 1) * (b + 0.5)) / bank.length)));

  const f0 = new Float32Array(count);
  const voicing = new Float32Array(count);
  const db = new Float32Array(count);
  const cep = new Float32Array(count * CEP_DIM);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const ncc = new Float64Array(lagMax + 1);

  for (let f = 0; f < count; f += 1) {
    if (f > 0 && f % 200 === 0) yield; // about 2 s of audio per slice, so a caller can let other work run between slices
    const s0 = f * hop;
    let e = 0;
    for (let i = 0; i < hop * 2 && s0 + i < samples.length; i += 1) e += samples[s0 + i] * samples[s0 + i];
    db[f] = 10 * Math.log10(e / (hop * 2) + 1e-12);

    // ---- spectral envelope
    re.fill(0); im.fill(0);
    for (let i = 0; i < nfft && s0 + i < samples.length; i += 1) re[i] = samples[s0 + i] * hann[i];
    fft(re, im);
    const logE = bank.map((w) => {
      let a = 0;
      for (let k = 1; k < nfft / 2; k += 1) a += w[k] * (re[k] * re[k] + im[k] * im[k]);
      return Math.log(a + 1e-10);
    });
    for (let c = 0; c < CEP_DIM; c += 1) {
      let a = 0;
      for (let b = 0; b < logE.length; b += 1) a += logE[b] * dct[c][b];
      cep[f * CEP_DIM + c] = a / logE.length;
    }

    // ---- pitch: normalised autocorrelation, smallest strong peak (avoids picking an octave too low)
    const a0 = f * hop8;
    if (a0 + win + lagMax > x8.length) continue;
    let mean = 0;
    for (let i = 0; i < win + lagMax; i += 1) mean += x8[a0 + i];
    mean /= win + lagMax;
    let e0 = 0;
    for (let i = 0; i < win; i += 1) { const v = x8[a0 + i] - mean; e0 += v * v; }
    if (e0 < 1e-7) continue;
    let best = 0;
    for (let lag = lagMin; lag <= lagMax; lag += 1) {
      let c = 0;
      let e1 = 0;
      for (let i = 0; i < win; i += 1) { const v = x8[a0 + i + lag] - mean; c += (x8[a0 + i] - mean) * v; e1 += v * v; }
      ncc[lag] = c / Math.sqrt(e0 * e1 + 1e-12);
      if (ncc[lag] > best) best = ncc[lag];
    }
    if (best < 0.45) continue;
    let pick = -1;
    for (let lag = lagMin + 1; lag < lagMax; lag += 1) {
      if (ncc[lag] >= 0.9 * best && ncc[lag] >= ncc[lag - 1] && ncc[lag] >= ncc[lag + 1]) { pick = lag; break; }
    }
    if (pick < 0) continue;
    f0[f] = rate8 / pick;
    voicing[f] = best;
  }

  const sorted = Array.from(db).sort((a, b) => a - b);
  return { hop: hop / rate, count, f0, voicing, db, cep, floorDb: sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -100 };
}

export function extractFrames(pcm: Pcm): Frames {
  const g = extractSteps(pcm);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

// Same result, but hands control back to the event loop between slices: a couple of seconds of solid computation per analysis
// would otherwise stall every other request, WebSocket message and health check on the server.
export async function extractFramesAsync(pcm: Pcm): Promise<Frames> {
  const g = extractSteps(pcm);
  let r = g.next();
  while (!r.done) { await new Promise<void>((resolve) => setImmediate(resolve)); r = g.next(); }
  return r.value;
}

// A frame counts as voiced speech when it has a clear pitch AND is well above the noise floor.
export const isVoiced = (fr: Frames, i: number) => fr.f0[i] > 0 && fr.db[i] > fr.floorDb + 8;

export interface SpanFeatures {
  frames: number; // voiced frames used
  f0Median: number | null;
  f0P10: number | null;
  f0P90: number | null;
  levelDb: number | null; // median level of voiced frames
  cep: number[] | null; // mean cepstrum of voiced frames
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quantile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };

export function spanFeatures(fr: Frames, start: number, end: number): SpanFeatures {
  const i0 = Math.max(0, Math.floor(start / fr.hop));
  const i1 = Math.min(fr.count, Math.ceil(end / fr.hop));
  const f0: number[] = [];
  const lv: number[] = [];
  const sum = new Float64Array(CEP_DIM);
  for (let i = i0; i < i1; i += 1) {
    if (!isVoiced(fr, i)) continue;
    f0.push(fr.f0[i]);
    lv.push(fr.db[i]);
    for (let c = 0; c < CEP_DIM; c += 1) sum[c] += fr.cep[i * CEP_DIM + c];
  }
  return {
    frames: f0.length,
    f0Median: median(f0),
    f0P10: quantile(f0, 0.1),
    f0P90: quantile(f0, 0.9),
    levelDb: median(lv),
    cep: f0.length ? Array.from(sum, (v) => v / f0.length) : null,
  };
}
