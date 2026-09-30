// Shared PCM WAV decoding and FFT used by the signal-quality and prosody analysers.

export interface Pcm { samples: Float64Array; rate: number }

export function readPcm16(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let fmt: { tag: number; ch: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.tag !== 1 || fmt.bits !== 16 || fmt.ch < 1 || fmt.ch > 8 || fmt.rate < 1000) return null;
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

export function fft(re: Float64Array, im: Float64Array) {
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

