// Signal-level audio quality for PCM WAV input: noise floor, signal-to-noise, clipping, bandwidth and dynamics.
// Compressed uploads (mp3/m4a/webm) cannot be decoded here without ffmpeg, so they return null and the
// findings fall back to the STT provider's confidence.
import { fft, readPcm16, type Pcm } from './audioIO.js';

export interface AudioSignal {
  duration_s: number;
  sample_rate: number;
  noise_floor_db: number;
  speech_level_db: number;
  snr_db: number;
  clipping_ratio: number;
  hf_ratio_db: number | null; // energy at 5-7 kHz relative to 0.5-2.5 kHz in the loud frames (null when the sample rate cannot show it)
  band_limited: boolean; // almost nothing above ~4.5 kHz: a phone line, a muffled or low-rate recording
  level_sd_db: number; // spread of the loudness of speech frames; very low = squashed by compression / AGC
  dynamics_compressed: boolean;
  condition: Condition;
}

// Thresholds are calibrated on the bundled demo calls, whose recording conditions are known (bench/audio-quality-benchmark.ts
// prints the measurements next to the truth). Band limit: filtered calls measure <= -29 dB, unfiltered ones >= -24 dB.
// Noise: calls rendered at <= 24 dB speech-to-noise measure <= 24.8 dB, calls rendered at >= 27 dB measure >= 27.1 dB.
export const AUDIO_THRESHOLDS = {
  bandLimitedHfDb: -27,
  compressedLevelSdDb: 3.5,
  compressedMinSnrDb: 18, // below this, steady noise flattens the loudness spread by itself, so compression cannot be told from noise
  noisyDb: 26,
  veryNoisyDb: 12,
  clippingRatio: 0.005,
  cleanSnrDb: 30,
} as const;

export type ConditionFlag = 'noisy' | 'very_noisy' | 'band_limited' | 'clipped' | 'compressed';
export interface Condition {
  label: 'clean_wideband' | 'noisy' | 'band_limited' | 'clipped' | 'compressed' | 'degraded' | 'acceptable';
  flags: ConditionFlag[];
}

export function classifyCondition(sig: Pick<AudioSignal, 'snr_db' | 'clipping_ratio' | 'band_limited' | 'dynamics_compressed'>): Condition {
  const T = AUDIO_THRESHOLDS;
  const flags: ConditionFlag[] = [];
  if (sig.snr_db < T.veryNoisyDb) flags.push('very_noisy');
  else if (sig.snr_db < T.noisyDb) flags.push('noisy');
  if (sig.band_limited) flags.push('band_limited');
  if (sig.clipping_ratio > T.clippingRatio) flags.push('clipped');
  if (sig.dynamics_compressed) flags.push('compressed');
  let label: Condition['label'];
  if (flags.length === 0) label = sig.snr_db >= T.cleanSnrDb ? 'clean_wideband' : 'acceptable';
  else if (flags.length === 1) label = flags[0] === 'very_noisy' ? 'noisy' : flags[0];
  else label = 'degraded';
  return { label, flags };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export function analyzeWavSignal(buf: Buffer): AudioSignal | null {
  const pcm = readPcm16(buf);
  return pcm ? analyzePcmSignal(pcm) : null;
}

export function analyzePcmSignal(pcm: Pcm): AudioSignal | null {
  if (pcm.samples.length < pcm.rate * 0.5) return null;
  const { samples, rate } = pcm;

  const frame = Math.round(rate * 0.02);
  const frames: { db: number; start: number }[] = [];
  for (let s = 0; s + frame <= samples.length; s += frame) {
    let e = 0;
    for (let i = s; i < s + frame; i += 1) e += samples[i] * samples[i];
    frames.push({ db: 10 * Math.log10(e / frame + 1e-12), start: s });
  }
  const sortedDb = frames.map((f) => f.db).sort((a, b) => a - b);
  const floor = percentile(sortedDb, 0.2); // 20th percentile tracks the rendered speech-to-noise ratio of the demo calls within ~2 dB
  const speech = percentile(sortedDb, 0.9);

  let clipped = 0;
  for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i]) >= 0.999) clipped += 1;

  // A channel limit (phone line, muffled mic, low sample rate) leaves almost nothing at 5-7.5 kHz. Measured on the loudest
  // frames so noise between words does not decide it.
  let hfRatio: number | null = null;
  if (rate >= 16000) {
    // 5-7 kHz is used instead of 5-8 kHz: the last few hundred Hz below the Nyquist limit always roll off and say nothing about the channel
    const N = 1024;
    const loud = frames.filter((f) => f.db >= speech - 6 && f.start + N <= samples.length).slice(0, 300);
    if (loud.length >= 5) {
      let lo = 0;
      let hi = 0;
      for (const f of loud) {
        const re = new Float64Array(N);
        const im = new Float64Array(N);
        for (let i = 0; i < N; i += 1) re[i] = samples[f.start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
        fft(re, im);
        for (let k = 1; k < N / 2; k += 1) {
          const hz = (k * rate) / N;
          const p = re[k] * re[k] + im[k] * im[k];
          if (hz >= 500 && hz <= 2500) lo += p;
          else if (hz >= 5000 && hz <= 7000) hi += p;
        }
      }
      hfRatio = Math.round(10 * Math.log10((hi + 1e-12) / (lo + 1e-12)) * 10) / 10;
    }
  }
  const bandLimited = hfRatio !== null ? hfRatio <= AUDIO_THRESHOLDS.bandLimitedHfDb : rate <= 8000;

  // loudness spread of the speech frames
  const active = frames.filter((f) => f.db > floor + 10).map((f) => f.db);
  let levelSd = 0;
  if (active.length >= 10) {
    const m = active.reduce((a, b) => a + b, 0) / active.length;
    levelSd = Math.sqrt(active.reduce((a, b) => a + (b - m) ** 2, 0) / active.length);
  }
  const snr = Math.round(Math.min(60, speech - floor) * 10) / 10;
  const dynamicsCompressed = active.length >= 10 && levelSd <= AUDIO_THRESHOLDS.compressedLevelSdDb && snr >= AUDIO_THRESHOLDS.compressedMinSnrDb;
  const clipRatio = clipped / samples.length;

  return {
    duration_s: Math.round((samples.length / rate) * 10) / 10,
    sample_rate: rate,
    noise_floor_db: Math.round(floor * 10) / 10,
    speech_level_db: Math.round(speech * 10) / 10,
    snr_db: snr,
    clipping_ratio: clipRatio,
    hf_ratio_db: hfRatio,
    band_limited: bandLimited,
    level_sd_db: Math.round(levelSd * 10) / 10,
    dynamics_compressed: dynamicsCompressed,
    condition: classifyCondition({ snr_db: snr, clipping_ratio: clipRatio, band_limited: bandLimited, dynamics_compressed: dynamicsCompressed }),
  };
}
