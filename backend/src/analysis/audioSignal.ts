// Signal-level audio quality for PCM WAV input: noise floor, signal-to-noise, clipping and usable bandwidth.
// Compressed uploads (mp3/m4a/webm) cannot be decoded here without ffmpeg, so they return null and the
// findings fall back to the STT provider's confidence.

export interface AudioSignal {
  duration_s: number;
  sample_rate: number;
  noise_floor_db: number;
  speech_level_db: number;
  snr_db: number;
  clipping_ratio: number;
  hf_ratio_db: number | null; // energy at 4-7 kHz relative to 0.3-3 kHz in the loud frames
  narrowband: boolean; // limited high-frequency content: a phone line or muffled recording
}

interface Pcm { samples: Float64Array; rate: number }

function readPcm16(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let fmt: { tag: number; ch: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.tag !== 1 || fmt.bits !== 16) return null;
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (2 * fmt.ch));
      const out = new Float64Array(frames);
      for (let i = 0; i < frames; i += 1) {
        let acc = 0;
        for (let c = 0; c < fmt.ch; c += 1) acc += buf.readInt16LE(body + (i * fmt.ch + c) * 2);
        out[i] = acc / fmt.ch / 32768;
      }
      return { samples: out, rate: fmt.rate };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k]; const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export function analyzeWavSignal(buf: Buffer): AudioSignal | null {
  const pcm = readPcm16(buf);
  if (!pcm || pcm.samples.length < pcm.rate * 0.5) return null;
  const { samples, rate } = pcm;

  const frame = Math.round(rate * 0.02);
  const frames: { db: number; start: number }[] = [];
  for (let s = 0; s + frame <= samples.length; s += frame) {
    let e = 0;
    for (let i = s; i < s + frame; i += 1) e += samples[i] * samples[i];
    frames.push({ db: 10 * Math.log10(e / frame + 1e-12), start: s });
  }
  const sortedDb = frames.map((f) => f.db).sort((a, b) => a - b);
  const floor = percentile(sortedDb, 0.1);
  const speech = percentile(sortedDb, 0.9);

  let clipped = 0;
  for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i]) >= 0.999) clipped += 1;

  // A channel limit (phone line, muffled mic) shows up as a cliff above ~3.5 kHz. Clean wideband voices measure about
  // -12 to -25 dB here; the band-limited demo calls measure about -33 dB or lower.
  let hfRatio: number | null = null;
  if (rate >= 16000) {
    const N = 512;
    const loud = frames.filter((f) => f.db >= speech - 6 && f.start + N <= samples.length).slice(0, 200);
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
          if (hz >= 300 && hz <= 3000) lo += p;
          else if (hz >= 4000 && hz <= 7000) hi += p;
        }
      }
      hfRatio = Math.round(10 * Math.log10((hi + 1e-12) / (lo + 1e-12)) * 10) / 10;
    }
  }

  return {
    duration_s: Math.round((samples.length / rate) * 10) / 10,
    sample_rate: rate,
    noise_floor_db: Math.round(floor * 10) / 10,
    speech_level_db: Math.round(speech * 10) / 10,
    snr_db: Math.round(Math.min(60, speech - floor) * 10) / 10,
    clipping_ratio: clipped / samples.length,
    hf_ratio_db: hfRatio,
    narrowband: hfRatio !== null && hfRatio < -38,
  };
}
