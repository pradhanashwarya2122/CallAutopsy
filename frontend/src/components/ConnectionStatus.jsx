import { useEffect, useState } from 'react';
import { api, BASE, connectivity } from '../lib/api';

/*
  Fixed floating banner at the top-right of the app. Runs one health probe on
  mount, then flips its state whenever any api.* call succeeds or fails.

  While the banner is dev/ops-friendly, we hide it entirely once we've had a
  successful call — no need to distract users.
*/
export default function ConnectionStatus() {
  const [state, setState] = useState({
    checked: false,
    ok: false,
    err: '',
    ready: false,
    checks: null,
  });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await fetch(BASE + '/health', { cache: 'no-store' });
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        setState({
          checked: true,
          ok: r.ok,
          err: r.ok ? '' : `${r.status}`,
          ready: !!body?.ready,
          checks: body?.checks ?? null,
        });
      } catch (e) {
        if (cancelled) return;
        setState({ checked: true, ok: false, err: e?.message || String(e), ready: false, checks: null });
      }
    };
    probe();
    const listener = () => {
      if (connectivity.online) {
        setState((s) => ({ ...s, ok: true, err: '' }));
      } else {
        setState((s) => ({ ...s, ok: false, err: connectivity.lastError || 'API unreachable' }));
      }
    };
    connectivity.listeners.add(listener);
    return () => {
      cancelled = true;
      connectivity.listeners.delete(listener);
    };
  }, []);

  if (hidden) return null;
  if (state.checked && state.ok && state.ready) {
    // fully green — auto-hide after a moment
    setTimeout(() => setHidden(true), 4000);
  }

  const tone = !state.checked
    ? 'checking'
    : state.ok && state.ready
    ? 'ok'
    : state.ok
    ? 'partial'
    : 'down';

  const bg = {
    checking: '#f4efe3',
    ok: '#d8eee2',
    partial: '#f7e5bf',
    down: '#fbd9d3',
  }[tone];
  const border = {
    checking: '#d8d2c3',
    ok: '#8ccaa9',
    partial: '#d9b06d',
    down: '#eb8f86',
  }[tone];
  const label = {
    checking: 'Checking backend…',
    ok: 'Backend connected',
    partial: 'Backend up · database/redis not ready',
    down: 'Backend unreachable',
  }[tone];

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 9999,
        background: bg,
        border: `1px solid ${border}`,
        color: '#15130f',
        borderRadius: 8,
        padding: '10px 14px',
        maxWidth: 380,
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 11,
        boxShadow: '0 8px 22px -10px rgba(60,45,20,.45)',
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background:
              tone === 'ok' ? '#12935f' : tone === 'partial' ? '#a5620a' : tone === 'down' ? '#d0161c' : '#8a8577',
          }}
        />
        <b style={{ fontWeight: 600 }}>{label}</b>
        <button
          onClick={() => setHidden(true)}
          style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 14 }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div style={{ opacity: 0.75, wordBreak: 'break-all' }}>API: {BASE}</div>
      {state.checks && (
        <div style={{ opacity: 0.75, marginTop: 2 }}>
          db: {state.checks.db} · redis: {state.checks.redis}
        </div>
      )}
      {state.err && <div style={{ marginTop: 4, color: '#8a1c15' }}>{state.err}</div>}
    </div>
  );
}
