import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

export const samplesRouter = Router();

const LABELS: Record<string, string> = {
  'clean-1.mp3': 'What is the weather today?',
  'clean-2.mp3': 'Book a table for two at seven',
  'noisy-1.mp3': 'Mumbled / noisy speech',
};

function contentTypeFor(id: string): string {
  const ext = id.split('.').pop()?.toLowerCase();
  return ext === 'mp3' ? 'audio/mpeg'
    : ext === 'wav' ? 'audio/wav'
    : ext === 'ogg' ? 'audio/ogg'
    : ext === 'webm' ? 'audio/webm'
    : 'application/octet-stream';
}

samplesRouter.get('/samples', async (_req, res) => {
  const dir = path.resolve(process.cwd(), 'samples');
  try {
    const files = (await fs.readdir(dir)).filter((f) => /\.(wav|mp3|ogg|webm)$/i.test(f));
    const items = files.map((id) => ({ id, label: LABELS[id] ?? id, duration_s: 4 }));
    res.json({ samples: items });
  } catch {
    res.json({ samples: [] });
  }
});

// Serve the raw audio file for the sample library <audio> player.
samplesRouter.get('/samples/:id', async (req, res) => {
  const safe = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
  const p = path.resolve(process.cwd(), 'samples', safe);
  try {
    const buf = await fs.readFile(p);
    res.setHeader('Content-Type', contentTypeFor(safe));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});
