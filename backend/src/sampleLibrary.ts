import fs from 'node:fs/promises';
import path from 'node:path';

export const SAMPLES_DIR = () => path.resolve(process.cwd(), 'samples');
export const AUDIO_RE = /\.(wav|mp3|ogg|webm|m4a)$/i;

interface Event { who?: string; text: string }
export interface ManifestEntry {
  id: string; label?: string; group?: string; category?: string; level?: number; featured?: boolean;
  speaker?: string; environment?: string; tags?: string[];
  summary?: string; challenge?: string; says?: string;
  segments?: Event[]; timeline?: Event[];
}

// The manifest is read on every sample call and every library listing, so it is parsed once and re-read only when the file changes.
let cache: { mtimeMs: number; dir: string; map: Map<string, ManifestEntry & { order: number }> } | null = null;

export async function loadManifest(): Promise<Map<string, ManifestEntry & { order: number }>> {
  try {
    const file = path.join(SAMPLES_DIR(), 'manifest.json');
    const { mtimeMs } = await fs.stat(file);
    if (cache && cache.mtimeMs === mtimeMs && cache.dir === file) return cache.map;
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const map = new Map((parsed.samples as ManifestEntry[]).map((e, i) => [e.id, { ...e, order: i }] as [string, ManifestEntry & { order: number }]));
    cache = { mtimeMs, dir: file, map };
    return map;
  } catch {
    return new Map();
  }
}

export async function listSampleIds(): Promise<string[]> {
  try {
    return (await fs.readdir(SAMPLES_DIR())).filter((f) => AUDIO_RE.test(f)).sort();
  } catch {
    return [];
  }
}

// Every word spoken in the call, in order (customer and agent), for comparing against the transcript.
export function scriptPlain(e: ManifestEntry | undefined): string | null {
  if (!e) return null;
  const events = e.timeline ?? e.segments;
  if (events?.length) return events.map((x) => x.text).join(' ');
  return e.says ?? null;
}

// The script as shown to people: "Customer: ..." / "Agent: ..." lines when more than one voice speaks.
export function scriptDisplay(e: ManifestEntry | undefined): string | null {
  if (!e) return null;
  if (e.says) return e.says;
  const events = e.timeline ?? e.segments;
  if (!events?.length) return null;
  const multi = new Set(events.map((x) => x.who ?? 'customer')).size > 1;
  return multi
    ? events.map((x) => `${(x.who ?? 'customer') === 'agent' ? 'Agent' : 'Customer'}: ${x.text}`).join('\n')
    : events.map((x) => x.text).join(' ');
}

export async function readSample(id: string): Promise<{ buf: Buffer; ext: string } | null> {
  const safe = path.basename(id).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!AUDIO_RE.test(safe)) return null;
  try {
    return { buf: await fs.readFile(path.join(SAMPLES_DIR(), safe)), ext: safe.split('.').pop()!.toLowerCase() };
  } catch {
    return null;
  }
}
