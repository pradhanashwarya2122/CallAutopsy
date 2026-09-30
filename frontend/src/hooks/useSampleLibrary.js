import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { DEMO_CALLS } from '../lib/reference';

// The demo-call library. A failed request is retried (a cold server often answers the first one late) and is reported as an error,
// never as "no demo calls": an empty list and an unreachable server are different problems.
//   samples: null while loading, otherwise the list.   error: message when it could not be loaded.   reload: try again.
export function useSampleLibrary() {
  const [samples, setSamples] = useState(null);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const load = useCallback(async () => {
    setError('');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const list = await api.sampleList();
        if (alive.current) setSamples(list);
        return;
      } catch (e) {
        if (!alive.current) return;
        if (attempt === 2) { setError('The demo calls could not be loaded. Check your connection and try again.'); setSamples((cur) => cur ?? []); return; }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  // The 15 core and stress recordings the app ships with. A server that lacks some was deployed from an older build.
  const missing = samples && !error ? DEMO_CALLS.filter((c) => !samples.some((x) => x.id === c.id)).length : 0;
  return { samples, error, reload: load, missing };
}
