import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import PageChrome from '../components/PageChrome';

/* ============================================================
   OPS — three tabs (SLA · Self-healing · Queue & chaos)
   Uses shared PageChrome + .pc-* classes for consistent look.
   ============================================================ */

function Tabs({ tabs, defaultTab }) {
  const [sp, setSp] = useSearchParams();
  const active = sp.get('tab') ?? defaultTab ?? tabs[0].id;
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const setActive = (id) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    setSp(next, { replace: true });
  };
  return (
    <div>
      <div className="pc-tabs">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)} className={t.id === current.id ? 'on' : ''}>
            {t.label}
          </button>
        ))}
      </div>
      <current.render />
    </div>
  );
}

/* ============================================================
   1. SLASettings
   ============================================================ */
function SLASettings() {
  const [pct, setPct] = useState(5);
  const [mins, setMins] = useState(60);
  const [state, setState] = useState(null);
  const [breaches, setBreaches] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const refresh = () => {
    api.getSla().then((r) => {
      setState(r.status);
      setPct(Number(r.config?.max_failure_rate_pct ?? 5));
      setMins(Number(r.config?.window_minutes ?? 60));
    }).catch(() => setState({ observed: 0, threshold: 5, breached: false }));
    api.slaBreaches().then((r) => setBreaches(r.breaches)).catch(() => setBreaches([]));
  };
  useEffect(() => { refresh(); const id = setInterval(refresh, 15000); return () => clearInterval(id); }, []);

  const save = async () => {
    try { await api.setSla(pct, mins); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000); refresh(); }
    catch (e) { alert(`Save failed: ${e.message}`); }
  };
  const testWebhook = async () => {
    setTesting(true); setTestResult(null);
    try { const r = await api.slaTestWebhook(); setTestResult(r.ok ? 'Sent to Discord.' : (r.note || 'Failed.')); }
    catch (e) { setTestResult(e.message); }
    finally { setTesting(false); }
  };
  const breached = state?.breached;

  return (
    <div>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        Configure the failure-rate threshold, watch the live health signal, review breach history, and dispatch a test alert.
      </p>

      <div className="pc-panel pc-section" style={breached ? { borderColor: 'var(--red-line)', background: 'rgba(251,217,211,.4)' } : {}}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className={`pc-dot ${!state ? '' : breached ? 'bad' : 'ok'}`} style={{ width: 14, height: 14 }} />
          <div style={{ flex: 1 }}>
            <p className="pc-h" style={{ margin: 0 }}>Current status</p>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500, margin: '4px 0 0' }}>
              {!state ? 'Loading…' : breached ? 'Breached' : 'Within SLA'}
              {state && (
                <span className="mono" style={{ fontSize: 13, color: 'var(--mute)', marginLeft: 14 }}>
                  observed {state.observed.toFixed(1)}% · threshold {state.threshold}%
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="pc-panel pc-section">
        <p className="pc-h">Threshold config</p>
        <div style={{ display: 'grid', gap: 18 }}>
          <label>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--mute)' }}>
              <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>Max failure rate</span>
              <span className="mono">{pct}%</span>
            </div>
            <input type="range" min={1} max={50} step={1} value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="pc-range" style={{ '--pct': `${((pct - 1) / 49) * 100}%` }} />
          </label>
          <label>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--mute)' }}>
              <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>Window</span>
              <span className="mono">{mins} min</span>
            </div>
            <input type="range" min={5} max={360} step={5} value={mins}
              onChange={(e) => setMins(Number(e.target.value))}
              className="pc-range" style={{ '--pct': `${((mins - 5) / 355) * 100}%` }} />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={save} className="pc-btn">Save</button>
            {savedFlash && <span className="pc-tag green">SAVED</span>}
          </div>
        </div>
      </div>

      <div className="pc-panel pc-section">
        <p className="pc-h">Alerting</p>
        <p className="pc-sub" style={{ marginBottom: 12 }}>
          On breach, the backend posts to <code className="mono">DISCORD_WEBHOOK_URL</code> once per 15-minute window.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={testWebhook} disabled={testing} className="pc-btn ghost">
            {testing ? 'Sending…' : 'Send test alert'}
          </button>
          {testResult && <span className="pc-sub">{testResult}</span>}
        </div>
      </div>

      <div className="pc-panel pc-section">
        <p className="pc-h">Breach history</p>
        {!breaches ? (
          <p className="pc-sub">Loading…</p>
        ) : breaches.length === 0 ? (
          <p className="pc-sub">No breaches recorded.</p>
        ) : (
          <table className="pc-table">
            <thead><tr><th>Breached at</th><th>Observed rate</th><th>Discord</th></tr></thead>
            <tbody>
              {breaches.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{new Date(b.breached_at).toISOString()}</td>
                  <td className="mono">{Number(b.observed_failure_rate_pct).toFixed(1)}%</td>
                  <td>{b.notified ? <span className="pc-tag green">sent</span> : <span className="pc-sub">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   2. Self-healing
   ============================================================ */
function Healing() {
  const [suggestions, setSuggestions] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState(null);
  const [dismissed, setDismissed] = useState(new Set());

  const refresh = async () => {
    try { const r = await api.healing(); setSuggestions(r.suggestions); }
    catch { setSuggestions([]); }
  };
  useEffect(() => { refresh(); }, []);

  const generate = async () => {
    setGenerating(true);
    try { await api.generateHealing(); await refresh(); }
    finally { setGenerating(false); }
  };

  const faults = suggestions ? Array.from(new Set(suggestions.map((s) => s.fault_type))) : [];
  const visible = suggestions?.filter((s) => (!filter || s.fault_type === filter) && !dismissed.has(s.id)) ?? [];

  return (
    <div>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        When a fault type recurs (≥5 in 24h), an LLM reasons over the pattern and proposes a concrete config change.
      </p>

      <div className="pc-panel pc-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={generate} disabled={generating} className="pc-btn">
            {generating ? 'Reasoning…' : 'Generate suggestions now'}
          </button>
          <span className="pc-sub">Analyzes last 24h of failed calls per fault type.</span>
        </div>
      </div>

      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="pc-h" style={{ margin: 0 }}>Filter</span>
          <button onClick={() => setFilter(null)} className={`pc-chip ${!filter ? 'on' : ''}`}>
            all ({suggestions.length})
          </button>
          {faults.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`pc-chip ${filter === f ? 'on' : ''}`}>
              {f} ({suggestions.filter((s) => s.fault_type === f).length})
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {!suggestions ? (
          <p className="pc-sub">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="pc-panel">
            <p className="pc-sub">
              {suggestions.length === 0
                ? 'No suggestions yet. Either no fault type has hit 5+ occurrences in 24h, or the monitor has not tickled since boot.'
                : 'All suggestions dismissed.'}
            </p>
          </div>
        ) : (
          visible.map((s) => (
            <div key={s.id} className="pc-panel">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="pc-tag red">{s.fault_type}</span>
                  <span className="pc-sub">{s.occurrence_count} recent occurrences</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--mute)' }}>{new Date(s.generated_at).toISOString()}</span>
                  <button onClick={() => setDismissed((d) => new Set([...d, s.id]))} className="pc-btn ghost small">Dismiss</button>
                </div>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{s.suggestion_text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ============================================================
   3. Queue & chaos control room
   ============================================================ */
function QueueStatsPanel() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const tick = () => api.queueStats().then(setStats).catch(() => setStats({ error: true }));
    tick(); const id = setInterval(tick, 4000); return () => clearInterval(id);
  }, []);
  if (!stats || stats.error) return (
    <div className="pc-panel"><p className="pc-h">Retry queue</p><p className="pc-sub">Queue backend unreachable.</p></div>
  );
  const q = stats.call_queue ?? {};
  const items = [
    ['waiting', q.waiting ?? 0, 'blue'],
    ['active', q.active ?? 0, 'green'],
    ['delayed', q.delayed ?? 0, 'amber'],
    ['failed', q.failed ?? 0, 'red'],
    ['dlq', stats.dlq?.size ?? 0, 'red'],
  ];
  return (
    <div className="pc-panel">
      <p className="pc-h">Retry queue</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, textAlign: 'center' }}>
        {items.map(([k, v, tone]) => (
          <div key={k}>
            <p className="mono" style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>{k}</p>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500, margin: '6px 0 0', color: (v > 0 && (k === 'failed' || k === 'dlq')) ? 'var(--red)' : 'var(--ink)' }}>{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutageToggle() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api.outageState().then(setState).catch(() => setState({ enabled: false }));
  useEffect(() => { refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, []);
  const knock = async () => { setBusy(true); try { setState(await api.setOutage(true, 90)); } finally { setBusy(false); } };
  const recover = async () => { setBusy(true); try { setState(await api.setOutage(false)); } finally { setBusy(false); } };
  const down = !!state?.enabled;
  return (
    <div className="pc-panel" style={down ? { borderColor: 'var(--red-line)', background: 'rgba(251,217,211,.35)' } : {}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className={`pc-dot ${down ? 'bad' : 'ok'}`} style={{ width: 14, height: 14 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <p className="pc-h" style={{ margin: 0 }}>Deepgram (primary STT)</p>
          <p style={{ fontSize: 13.5, margin: '4px 0 0' }}>
            {down ? `Simulated outage — ${state.secondsRemaining}s remaining, next call routes to Whisper.` : 'Operational.'}
          </p>
        </div>
        {!down ? (
          <button onClick={knock} disabled={busy} className="pc-btn danger small">Knock offline (90s)</button>
        ) : (
          <button onClick={recover} disabled={busy} className="pc-btn small">Recover</button>
        )}
      </div>
    </div>
  );
}

const CHAOS_FAULTS = ['bad_stt', 'hallucination', 'tts_glitch', 'timeout', 'user_hangup', 'network_drop', 'exception'];

function ChaosPanel() {
  const [state, setState] = useState(null);
  const refresh = () => api.chaosState().then(setState).catch(() => setState({ enabled: false, callsPerMinute: 6, faultMix: [], includeCleanRuns: true }));
  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, []);
  const toggle = async () => setState(await api.setChaos({ enabled: !state?.enabled }));
  const setRate = async (rate) => setState(await api.setChaos({ callsPerMinute: rate }));
  const toggleFault = async (f) => {
    const cur = new Set(state?.faultMix ?? []);
    if (cur.has(f)) cur.delete(f); else cur.add(f);
    setState(await api.setChaos({ faultMix: Array.from(cur) }));
  };
  const toggleClean = async () => setState(await api.setChaos({ includeCleanRuns: !state?.includeCleanRuns }));
  if (!state) return null;

  return (
    <div className="pc-panel" style={state.enabled ? { borderColor: 'var(--ink)', borderWidth: 2, padding: '17px 19px' } : {}}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p className="pc-h" style={{ margin: 0 }}>Chaos mode</p>
        <button onClick={toggle} className={`pc-chip ${state.enabled ? 'on' : ''}`} style={{ padding: '6px 14px' }}>
          {state.enabled ? 'ON — firing continuously' : 'OFF'}
        </button>
      </div>
      <p className="pc-sub" style={{ marginBottom: 14 }}>Backend fires random calls from the sample library at the configured rate.</p>
      <label style={{ display: 'block', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--mute)' }}>
          <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>Calls per minute</span>
          <span className="mono">{state.callsPerMinute}</span>
        </div>
        <input type="range" min={1} max={30} step={1} value={state.callsPerMinute}
          onChange={(e) => setRate(Number(e.target.value))}
          className="pc-range" style={{ '--pct': `${((state.callsPerMinute - 1) / 29) * 100}%` }} />
      </label>
      <div>
        <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: '0 0 8px' }}>Fault mix</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button onClick={toggleClean} className={`pc-chip ${state.includeCleanRuns ? 'on' : ''}`}>clean_runs</button>
          {CHAOS_FAULTS.map((f) => {
            const on = state.faultMix?.includes(f);
            return <button key={f} onClick={() => toggleFault(f)} className={`pc-chip ${on ? 'on red' : ''}`}>{f}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

function ControlRoom() {
  return (
    <div>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        Live view of the retry queue, plus rehearsal controls to knock providers offline and generate synthetic traffic.
      </p>
      <div className="pc-section"><QueueStatsPanel /></div>
      <div className="pc-grid g2 pc-section">
        <OutageToggle />
        <ChaosPanel />
      </div>
    </div>
  );
}

/* ============================================================
   Page
   ============================================================ */
export default function Ops() {
  return (
    <PageChrome
      active="Ops"
      eyebrow="Control Room"
      title="Operations"
      titleEm="playbook."
      tagline="SLA thresholds, self-healing suggestions, queue depth, chaos, and provider-outage rehearsal."
    >
      <Tabs
        tabs={[
          { id: 'sla',     label: 'SLA',            render: () => <SLASettings /> },
          { id: 'healing', label: 'Self-healing',   render: () => <Healing /> },
          { id: 'queue',   label: 'Queue & chaos',  render: () => <ControlRoom /> },
        ]}
      />
    </PageChrome>
  );
}
