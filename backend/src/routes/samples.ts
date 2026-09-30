import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

export const samplesRouter = Router();

// Metadata for the bundled demo calls lives in samples/manifest.json (also read by scripts/generate-demo-calls.mjs).
// `challenge` says what a call is designed to stress; the actual diagnosis always comes from the pipeline.
interface ManifestEntry {
  id: string; label?: string; category?: string; level?: number; featured?: boolean;
  summary?: string; challenge?: string; says?: string; segments?: { text: string }[];
}

async function loadManifest(dir: string): Promise<Map<string, ManifestEntry>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    return new Map((parsed.samples as ManifestEntry[]).map((e, i) => [e.id, { ...e, level: e.level, order: i } as ManifestEntry & { order: number }]));
  } catch {
    return new Map();
  }
}

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
  const meta = await loadManifest(dir);
  const order = (id: string) => ((meta.get(id) as any)?.order ?? 1000);
  const samples = await Promise.all(
    files.sort((x, y) => order(x) - order(y) || x.localeCompare(y)).map(async (id) => {
      const m = meta.get(id);
      return {
        id,
        label: m?.label ?? prettify(id),
        category: m?.category ?? null,
        level: m?.level ?? null,
        featured: m?.featured ?? false,
        summary: m?.summary ?? null,
        challenge: m?.challenge ?? null,
        says: m?.says ?? (m?.segments ? m.segments.map((x) => x.text).join(' ') : null),
        duration_s: id.toLowerCase().endsWith('.wav') ? await wavDurationSeconds(path.join(dir, id)) : null,
      };
    }),
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
