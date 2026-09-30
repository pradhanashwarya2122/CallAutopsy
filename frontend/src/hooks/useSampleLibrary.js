import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { DEMO_CALLS } from '../lib/reference';

// The demo-call library.
//   samples        every recording the app ships with: the server's list, plus any the server lacks, served from the website itself
//                  (frontend/public/samples). A server deployed from an older build has only a few, and the rest must not vanish.
//   serverSamples  only what the server can run itself (A/B and calibration run server-side, so they offer just these).
//   missing        how many recordings the server lacks.   error: the server could not be reached.   reload: try again.
const bundledRow = (c) => ({
  id: c.id, label: c.label, group: c.group, category: c.category, level: c.level, featured: c.group !== 'quick',
  speaker: c.speaker, environment: c.environment, tags: c.tags ?? [], summary: c.summary, challenge: c.challenge, says: c.says,
  duration_s: c.seconds, url: `${import.meta.env.BASE_URL}samples/${encodeURIComponent(c.id)}`, bundled: true,
});
const ORDER = new Map(DEMO_CALLS.map((c, i) => [c.id, i]));
const byOrder = (a, b) => (ORDER.get(a.id) ?? 1000) - (ORDER.get(b.id) ?? 1000);

export function useSampleLibrary() {
  const [server, setServer] = useState(null);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const load = useCallback(async () => {
    setError('');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const list = await api.sampleList();
        if (alive.current) setServer(list);
        return;
      } catch {
        if (!alive.current) return;
        if (attempt === 2) { setError('The server could not be reached, so these recordings can be played but not analysed yet.'); setServer((cur) => cur ?? []); return; }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  if (server === null) return { samples: null, serverSamples: null, error, reload: load, missing: 0 };
  const have = new Set(server.map((x) => x.id));
  const extra = DEMO_CALLS.filter((c) => !have.has(c.id)).map(bundledRow);
  const samples = [...server, ...extra].sort(byOrder);
  return { samples, serverSamples: [...server].sort(byOrder), error, reload: load, missing: error ? 0 : extra.length };
}
