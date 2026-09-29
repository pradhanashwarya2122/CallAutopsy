import { useEffect, useState } from 'react';
import { api, BASE, connectivity } from '../lib/api';

/*
  Small floating banner in the top-right that shows a plain-English backend
  status. Never exposes the raw API URL — interviewers see a mental model
  ("Live", "Warming up", "Backend offline"), not a hostname.
*/
export default function ConnectionStatus() {
  const [tone, setTone] = useState('checking');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');

  // One-time probe + subscribe to connectivity state
  useEffect(() => {
    let cancelled = false;
    let hideTimer;

    const probe = async () => {
      try {
        const r = await fetch(BASE + '/health', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && body?.ready) {
          setTone('ok');
          hideTimer = setTimeout(() => setHidden(true), 4000);
        } else if (r.ok) {
          setTone('warming');
        } else {
          setTone('down');
          setError(`Backend returned ${r.status}`);
        }
      } catch (e) {
        if (cancelled) return;
        setTone('down');
        setError(e?.name === 'TimeoutError' ? 'Backend timed out' : 'Backend not reachable');
      }
    };
    probe();

    const listener = () => {
      if (connectivity.online) {
        setTone((t) => (t === 'down' ? 'ok' : t));
        setError('');
      } else {
        setTone('down');
        setError(connectivity.lastError ?? 'Backend not reachable');
      }
    };
    connectivity.listeners.add(listener);

    return () => {
      cancelled = true;
      if (hideTimer) clearTimeout(hideTimer);
      connectivity.listeners.delete(listener);
    };
  }, []);

  if (hidden) return null;

  const palette = {
    checking: { bg: '#f4efe3', border: '#d8d2c3', dot: '#8a8577', label: 'Checking backend…', sub: 'Warming up the pipeline' },
    warming:  { bg: '#f7e5bf', border: '#d9b06d', dot: '#a5620a', label: 'Backend warming up',  sub: 'Database / Redis not ready yet' },
    ok:       { bg: '#d8eee2', border: '#8ccaa9', dot: '#12935f', label: 'Live',                sub: 'Connected to CallAutopsy backend' },
    down:     { bg: '#fbd9d3', border: '#eb8f86', dot: '#d0161c', label: 'Backend offline',     sub: error || 'Backend not responding' },
  }[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 12, right: 12, zIndex: 9999,
        background: palette.bg, border: `1px solid ${palette.border}`,
        color: '#15130f', borderRadius: 8, padding: '10px 14px', maxWidth: 320,
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 11,
        boxShadow: '0 8px 22px -10px rgba(60,45,20,.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: palette.dot }} />
        <b style={{ fontWeight: 600 }}>{palette.label}</b>
        <button
          onClick={() => setHidden(true)}
          style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 14, padding: 0 }}
          aria-label="Dismiss"
        >×</button>
      </div>
      <div style={{ opacity: 0.75 }}>{palette.sub}</div>
    </div>
  );
}
