import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

export const samplesRouter = Router();

// What each bundled recording says, so the UI can show "said" next to what STT "heard".
// Regenerate them with backend/scripts/generate-samples.sh.
const KNOWN: Record<string, { label: string; says: string }> = {
  'refund-request.wav': { label: 'Refund request', says: 'Hi, I was charged twice on my last invoice and I would like a refund please.' },
  'book-table.wav': { label: 'Book a table', says: 'Book me a table for two at seven pm tonight.' },
  'weather-today.wav': { label: 'Weather question', says: "What's the weather going to be like today?" },
  'noisy-line.wav': { label: 'Noisy line', says: 'Uh, hi, I need to check my, uh, account balance. (with static)' },
};

const AUDIO_RE = /\.(wav|mp3|ogg|webm|m4a)$/i;

function contentTypeFor(id: string): string {
  const ext = id.split('.').pop()?.toLowerCase();
  return ext === 'mp3' ? 'audio/mpeg'
    : ext === 'wav' ? 'audio/wav'
    : ext === 'ogg' ? 'audio/ogg'
    : ext === 'webm' ? 'audio/webm'
    : ext === 'm4a' ? 'audio/mp4'
    : 'application/octet-stream';
}

function prettify(id: string): string {
  const base = id.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// PCM WAV only (what the bundled samples are); other formats report null rather than a guess.
async function wavDurationSeconds(file: string): Promise<number | null> {
  try {
    const fh = await fs.open(file, 'r');
    try {
      const head = Buffer.alloc(44);
      await fh.read(head, 0, 44, 0);
      if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null;
      const byteRate = head.readUInt32LE(28);
      if (!byteRate) return null;
      const { size } = await fh.stat();
      return Math.round(((size - 44) / byteRate) * 10) / 10;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

samplesRouter.get('/samples', async (_req, res) => {
  const dir = path.resolve(process.cwd(), 'samples');
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => AUDIO_RE.test(f));
  } catch {
    return res.json({ samples: [] });
  }
  const samples = await Promise.all(
    files.sort().map(async (id) => ({
      id,
      label: KNOWN[id]?.label ?? prettify(id),
      says: KNOWN[id]?.says ?? null,
      duration_s: id.toLowerCase().endsWith('.wav') ? await wavDurationSeconds(path.join(dir, id)) : null,
    })),
  );
  res.json({ samples });
});

// Serve the raw audio file for the sample library <audio> player.
samplesRouter.get('/samples/:id', async (req, res) => {
  const safe = path.basename(req.params.id).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!AUDIO_RE.test(safe)) return res.status(404).json({ error: 'not_found' });
  try {
    const buf = await fs.readFile(path.resolve(process.cwd(), 'samples', safe));
    res.setHeader('Content-Type', contentTypeFor(safe));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});
