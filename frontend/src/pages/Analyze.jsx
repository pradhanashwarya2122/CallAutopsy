import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import PageChrome from '../components/PageChrome';

/* ============================================================
   ANALYZE — three tabs (Calibration · Blast radius · Hallucination)
   Uses shared PageChrome + .pc-* classes so nav / header / panels
   match Dashboard.jsx aesthetic.
   ============================================================ */

const LABELS = ['bad_stt', 'hallucination', 'tts_glitch', 'timeout', 'user_hangup', 'network_drop', 'exception', 'ok'];

/* ---------- tabs ---------- */
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

/* ---------- tiny inline sparkline ---------- */
function Spark({ values, color = '#e2372b', h = 44, w = 260 }) {
  if (!values || !values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity="0.12" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.75" />
    </svg>
  );
}

/* ============================================================
   1. Calibration
   ============================================================ */
function Calibration() {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState(null);
  const [mistakes, setMistakes] = useState(null);
  const [error, setError] = useState('');
  const [samples, setSamples] = useState([]);
  const [sampleId, setSampleId] = useState('');
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [d, t, m] = await Promise.all([api.calibration(), api.calibrationTrend(), api.calibrationMistakes()]);
      setData(d); setTrend(t.trend); setMistakes(m.mistakes); setError('');
      if (d.running) timer.current = setTimeout(load, 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load calibration data. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    load();
    api.samples().then((r) => { const l = r.samples ?? []; setSamples(l); if (l.length) setSampleId(l[0].id); }).catch(() => {});
    return () => clearTimeout(timer.current);
  }, [load]);

  const startRun = async () => {
    setStarting(true); setNote('');
    try {
      const r = await api.calibrationRun(sampleId);
      setNote(`Running ${r.total} calls in the background (one clean, one per failure type). Results appear below as they finish.`);
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 2500);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Could not start the run.');
    } finally { setStarting(false); }
  };

  const trendAcc = trend?.map((b) => (b.total ? (b.correct / b.total) * 100 : 0)) ?? [];
  const overall = data ? data.accuracy * 100 : 0;
  const cell = (row, col) => {
    if (!data) return null;
    const m = data.confusionMatrix.find((r) => r.injected_fault === row && r.predicted_category === col);
    return m?.n ?? 0;
  };
  const perLabelEntries = data ? Object.entries(data.perLabel) : [];

  return (
    <div className="pc-body" style={{ marginTop: 0 }}>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        How often the classifier names the right failure, measured against the failures you injected on purpose and the clean control calls made by "Generate calibration data" (so false alarms show up too). Your own uploads and recordings are not scored here: nobody knows in advance what should be diagnosed for them. These are your own calls only.
      </p>

      {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)', marginBottom: 14 }}>{error}</p>}

      <div className="pc-panel pc-section">
        <p className="pc-h">Generate calibration data</p>
        <p className="pc-sub" style={{ marginBottom: 10 }}>Runs one clean call and each of the 7 failure types on the demo call you choose (8 analyses, roughly 5 cents).</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} aria-label="Demo call for calibration" className="pc-input" style={{ minWidth: 260 }}>
            {samples.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <button onClick={startRun} disabled={starting || data?.running || !sampleId} className="pc-btn">
            {data?.running ? 'Running…' : starting ? 'Starting…' : 'Run calibration'}
          </button>
        </div>
        {note && <p className="pc-sub" style={{ marginTop: 10 }}>{note}</p>}
      </div>

      <div className="pc-grid g3 pc-section">
        <div className="pc-meta-card">
          <p className="k">Overall accuracy</p>
          <p className="v">{data && data.total ? `${overall.toFixed(1)}%` : '—'}</p>
          <p className="h">{data ? (data.total ? `${data.correct} correct of ${data.total} calls (${data.faultRuns} with an injected failure, ${data.cleanRuns} clean)` : 'no scored calls yet') : 'loading…'}</p>
        </div>
        <div className="pc-meta-card">
          <p className="k">Accuracy last 24h</p>
          {trend && trend.length ? (
            <>
              <div style={{ marginTop: 8 }}><Spark values={trendAcc} color="#12935f" /></div>
              <p className="h" style={{ marginTop: 6 }}>
                {trendAcc.length} hourly buckets · latest {trendAcc[trendAcc.length - 1]?.toFixed(0)}%
              </p>
            </>
          ) : (
            <>
              <p className="v" style={{ color: 'var(--mute)' }}>—</p>
              <p className="h">no labeled calls last 24h</p>
            </>
          )}
        </div>
        <div className="pc-meta-card">
          <p className="k">Labeled fault mix</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
            {LABELS.filter((l) => l !== 'ok').map((l) => {
              const row = data ? LABELS.map((c) => cell(l, c) ?? 0).reduce((a, b) => a + b, 0) : 0;
              if (!row) return null;
              return (
                <li key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span className="mono">{l}</span>
                  <b>{row}</b>
                </li>
              );
            })}
            {(!data || !perLabelEntries.length) && <li style={{ color: 'var(--mute)' }}>—</li>}
          </ul>
        </div>
      </div>

      <div className="pc-section pc-panel">
        <h3 className="pc-h">Per-label metrics</h3>
        {!data || !perLabelEntries.length ? (
          <p className="pc-sub">No scored calls yet. Use "Generate calibration data" above, or run demo calls with "Simulate a failure" on the Dashboard.</p>
        ) : (
          <table className="pc-table">
            <thead>
              <tr><th>Label</th><th>TP</th><th>FP</th><th>FN</th><th style={{ width: '30%' }}>Precision</th><th style={{ width: '30%' }}>Recall</th></tr>
            </thead>
            <tbody>
              {perLabelEntries.map(([label, m]) => (
                <tr key={label}>
                  <td className="mono">{label}</td>
                  <td className="mono">{m.tp}</td>
                  <td className="mono">{m.fp}</td>
                  <td className="mono">{m.fn}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ width: 52 }}>{(m.precision * 100).toFixed(1)}%</span>
                      <div className="pc-bar" style={{ flex: 1 }}><i style={{ width: `${m.precision * 100}%` }} /></div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ width: 52 }}>{(m.recall * 100).toFixed(1)}%</span>
                      <div className="pc-bar" style={{ flex: 1 }}><i style={{ width: `${m.recall * 100}%` }} /></div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="pc-section pc-panel">
          <h3 className="pc-h">Confusion matrix</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="pc-table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>actual ↓ / predicted →</th>
                  {LABELS.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {LABELS.map((r) => (
                  <tr key={r}>
                    <td className="mono" style={{ color: 'var(--mute)' }}>{r === 'ok' ? 'ok (clean)' : r}</td>
                    {LABELS.map((c) => {
                      const n = cell(r, c);
                      const diag = r === c;
                      return (
                        <td key={c} className={`mono ${n ? (diag ? 'pc-cell-good' : 'pc-cell-bad') : ''}`} style={n ? {} : { color: '#c9c1ad' }}>
                          {n || '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pc-section pc-panel">
        <h3 className="pc-h">Recent misclassifications</h3>
        {!mistakes ? (
          <p className="pc-sub">Loading…</p>
        ) : mistakes.length === 0 ? (
          <p className="pc-sub">{data && data.total ? 'No mismatches on record.' : 'Nothing to show until you have some calls.'}</p>
        ) : (
          <table className="pc-table">
            <thead>
              <tr><th>Call</th><th>When</th><th>Ground truth</th><th>Predicted</th><th>Confidence</th><th>STT</th></tr>
            </thead>
            <tbody>
              {mistakes.map((m) => (
                <tr key={m.id}>
                  <td className="mono"><Link to={`/calls/${m.id}`} style={{ color: 'var(--ink)' }}>{m.id.slice(0, 8)}</Link></td>
                  <td className="mono">{new Date(m.started_at).toISOString().slice(11, 19)}</td>
                  <td><span className="pc-tag amber">{m.injected_fault}</span></td>
                  <td><span className="pc-tag red">{m.predicted_category}</span></td>
                  <td className="mono">{Number(m.classifier_confidence ?? 0).toFixed(2)}</td>
                  <td className="mono">{m.stt_provider_used ?? '—'}</td>
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
   2. Blast radius
   ============================================================ */
const PRESETS = [100, 1000, 10000, 100000, 1000000];

function BlastRadius() {
  const [volume, setVolume] = useState(10000);
  const [reductionPct, setReductionPct] = useState(50);
  const [result, setResult] = useState(null);
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    try { setResult(await api.blastRadius(volume)); setRan(true); }
    catch (e) { setResult(null); setRan(false); setError(e instanceof ApiError ? e.message : 'Could not project. Check your connection and try again.'); }
    finally { setLoading(false); }
  };

  const totalMonthly = result?.failedMonthlyCostUsd ?? 0;
  const savings = totalMonthly * (reductionPct / 100);
  const maxFaultCost = result?.projection?.length ? Math.max(...result.projection.map((p) => p.projectedMonthlyCostUsd), 1) : 1;

  return (
    <div className="pc-body" style={{ marginTop: 0 }}>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        Project the monthly dollar impact of your observed failure rates at any call volume. Cost math uses real per-call totals.
      </p>

      <div className="pc-panel pc-section">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <span className="pc-h" style={{ margin: 0 }}>Preset volumes</span>
          {PRESETS.map((v) => (
            <button key={v} onClick={() => setVolume(v)} className={`pc-chip ${volume === v ? 'on' : ''}`}>
              {v.toLocaleString()}/d
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 240 }}>
            <span className="pc-sub" style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6 }}>Calls per day</span>
            <input type="range" min={100} max={2_000_000} step={100} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="pc-range"
              style={{ '--pct': `${(volume / 2_000_000) * 100}%` }} />
          </label>
          <input type="number" value={volume} onChange={(e) => setVolume(Number(e.target.value))}
            className="pc-input" style={{ width: 140 }} />
          <button onClick={run} disabled={loading} className="pc-btn">{loading ? 'Projecting…' : 'Project'}</button>
        </div>
      </div>

      {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      {ran && result?.projection?.length === 0 && (
        <div className="pc-panel pc-section">
          <p className="pc-sub">{result.sampleSize ? `None of your ${result.sampleSize} calls failed, so there is no failure cost to project.` : 'You have no finished calls yet.'} Run demo calls with "Simulate a failure" on the Dashboard, then come back.</p>
        </div>
      )}

      {result?.projection?.length > 0 && (
        <>
          <div className="pc-grid g3 pc-section">
            <div className="pc-meta-card">
              <p className="k">Projected monthly waste</p>
              <p className="v">${totalMonthly.toFixed(2)}</p>
              <p className="h">at {volume.toLocaleString()}/day</p>
            </div>
            <div className="pc-meta-card">
              <p className="k">Sample size</p>
              <p className="v">{result.sampleSize}</p>
              <p className="h">your finished calls</p>
            </div>
            <div className="pc-meta-card">
              <p className="k">Worst offender</p>
              <p className="v" style={{ fontSize: 22 }}>
                {result.projection.reduce((a, b) => a.projectedMonthlyCostUsd > b.projectedMonthlyCostUsd ? a : b).faultType}
              </p>
              <p className="h">${result.projection.reduce((a, b) => a.projectedMonthlyCostUsd > b.projectedMonthlyCostUsd ? a : b).projectedMonthlyCostUsd.toFixed(2)}/mo</p>
            </div>
          </div>

          <div className="pc-panel pc-section">
            <h3 className="pc-h">Per fault</h3>
            <table className="pc-table">
              <thead>
                <tr><th>Fault</th><th>Observed rate</th><th>Avg $/call</th><th style={{ width: '35%' }}>Projected monthly</th></tr>
              </thead>
              <tbody>
                {result.projection.map((p) => (
                  <tr key={p.faultType}>
                    <td><span className="pc-tag red">{p.faultType}</span></td>
                    <td className="mono">{(p.observedFailureRate * 100).toFixed(1)}%</td>
                    <td className="mono">${(p.avgCostPerCallUsd ?? 0).toFixed(6)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono" style={{ width: 90 }}>${p.projectedMonthlyCostUsd.toFixed(2)}</span>
                        <div className="pc-bar" style={{ flex: 1 }}><i className="red" style={{ width: `${(p.projectedMonthlyCostUsd / maxFaultCost) * 100}%` }} /></div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.stages?.length > 0 && (
            <div className="pc-panel pc-section">
              <h3 className="pc-h">Per-stage cost breakdown</h3>
              <table className="pc-table">
                <thead><tr><th>Stage</th><th>Provider</th><th>Runs</th><th>Avg $/call</th><th>Projected monthly</th></tr></thead>
                <tbody>
                  {result.stages.map((s, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ textTransform: 'uppercase' }}>{s.stage}</td>
                      <td className="mono">{s.provider}</td>
                      <td className="mono">{s.n}</td>
                      <td className="mono">${(s.avg_cost ?? 0).toFixed(6)}</td>
                      <td className="mono">${(s.projectedMonthly ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pc-panel pc-section">
            <h3 className="pc-h">What if we cut failures</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 240 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--mute)' }}>
                  <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>Failure reduction</span>
                  <span className="mono">{reductionPct}%</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={reductionPct}
                  onChange={(e) => setReductionPct(Number(e.target.value))}
                  className="pc-range" style={{ '--pct': `${reductionPct}%` }} />
              </label>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 500, margin: 0, color: 'var(--green)' }}>${savings.toFixed(2)}</p>
                <p className="pc-sub">estimated monthly savings</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   3. Hallucination Suite
   ============================================================ */
function HallucinationSuite() {
  const [history, setHistory] = useState(null);
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [aggregate, setAggregate] = useState({});
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const [h, agg] = await Promise.all([
        api.hallucinationHistory(),
        api.hallucinationAggregate().catch(() => ({ perPrompt: {} })),
      ]);
      setHistory(h.history);
      setAggregate(agg.perPrompt ?? {});
    } catch {
      setHistory([]);
      setAggregate({});
    }
  };
  useEffect(() => { refresh(); }, []);

  const run = async () => {
    setRunning(true);
    setError('');
    try { await api.runHallucinationSuite(); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'The suite could not run. Check your connection and try again.'); }
    finally { setRunning(false); }
  };

  const openRun = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    try { const r = await api.hallucinationRun(id); setDetail(r.run); } catch {}
  };

  const trend = history?.slice().reverse().map((h) => (h.hallucinated_count / Math.max(1, h.total_prompts)) * 100) ?? [];
  const latest = history?.[0];
  const latestRate = latest ? (latest.hallucinated_count / latest.total_prompts) * 100 : 0;
  const avgRate = history && history.length
    ? history.reduce((s, h) => s + (h.hallucinated_count / Math.max(1, h.total_prompts)), 0) / history.length * 100
    : 0;

  return (
    <div className="pc-body" style={{ marginTop: 0 }}>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        Fixed adversarial prompt set. Each run replays every prompt against the current LLM config and scores responses with a grounding check.
      </p>

      <div className="pc-panel pc-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button onClick={run} disabled={running} className="pc-btn danger">
            {running ? 'Running suite…' : 'Run suite'}
          </button>
          <span className="pc-sub">7 adversarial prompts, each judged by a second LLM call.</span>
        </div>
        {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)', marginTop: 10 }}>{error}</p>}
      </div>

      <div className="pc-grid g3 pc-section">
        <div className="pc-meta-card">
          <p className="k">Latest rate</p>
          <p className="v">{latest ? `${latestRate.toFixed(1)}%` : '—'}</p>
          <p className="h">{latest ? `${latest.hallucinated_count} / ${latest.total_prompts}` : 'no runs yet'}</p>
        </div>
        <div className="pc-meta-card">
          <p className="k">Avg across runs</p>
          <p className="v">{history && history.length ? `${avgRate.toFixed(1)}%` : '—'}</p>
          <p className="h">{history ? `${history.length} historical runs` : ''}</p>
        </div>
        <div className="pc-meta-card">
          <p className="k">Trend</p>
          {trend.length ? <div style={{ marginTop: 8 }}><Spark values={trend} color="#e2372b" /></div> : <p className="v" style={{ color: 'var(--mute)' }}>—</p>}
          <p className="h">rate over runs</p>
        </div>
      </div>

      {Object.keys(aggregate).length > 0 && (
        <div className="pc-panel pc-section">
          <h3 className="pc-h">Per-prompt hallucination rate (last 10 runs)</h3>
          <table className="pc-table">
            <thead><tr><th>Prompt id</th><th>Seen in</th><th>Hallucinated</th><th style={{ width: '35%' }}>Rate</th></tr></thead>
            <tbody>
              {Object.entries(aggregate)
                .sort((a, b) => (b[1].hallucinated / Math.max(1, b[1].runs)) - (a[1].hallucinated / Math.max(1, a[1].runs)))
                .map(([id, m]) => {
                  const rate = m.hallucinated / Math.max(1, m.runs);
                  return (
                    <tr key={id}>
                      <td className="mono">{id}</td>
                      <td className="mono">{m.runs}</td>
                      <td className="mono">{m.hallucinated}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ width: 44 }}>{(rate * 100).toFixed(0)}%</span>
                          <div className="pc-bar" style={{ flex: 1 }}><i className="red" style={{ width: `${rate * 100}%` }} /></div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <div className="pc-panel pc-section">
        <h3 className="pc-h">Run history — click to expand</h3>
        {!history ? (
          <p className="pc-sub">Loading…</p>
        ) : history.length === 0 ? (
          <p className="pc-sub">No runs yet.</p>
        ) : (
          <table className="pc-table">
            <thead><tr><th>Run at</th><th>Prompts</th><th>Hallucinated</th><th>Rate</th><th style={{ width: 30 }}></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <Fragment key={h.id}>
                  <tr onClick={() => openRun(h.id)} style={{ cursor: 'pointer' }}>
                    <td className="mono">{new Date(h.run_at).toISOString()}</td>
                    <td className="mono">{h.total_prompts}</td>
                    <td className="mono">{h.hallucinated_count}</td>
                    <td className="mono">{((h.hallucinated_count / Math.max(1, h.total_prompts)) * 100).toFixed(1)}%</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--mute)' }}>{openId === h.id ? '−' : '+'}</td>
                  </tr>
                  {openId === h.id && (
                    <tr><td colSpan={5} style={{ background: 'rgba(255,255,255,.5)', padding: 12 }}>
                      {!detail ? <p className="pc-sub">Loading detail…</p> : (
                        <div style={{ display: 'grid', gap: 8 }}>
                          {(detail.results ?? []).map((r) => (
                            <div key={r.id} className="pc-panel" style={{ padding: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                {r.hallucinated ? <span className="pc-tag red">HALLUCINATED</span> : <span className="pc-tag green">GROUNDED</span>}
                                <span className="mono" style={{ color: 'var(--mute)' }}>· {r.id}</span>
                              </div>
                              <p style={{ marginTop: 6, fontSize: 13 }}>{r.response}</p>
                              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--mute)', fontStyle: 'italic' }}>{r.reasoning}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Page
   ============================================================ */
export default function Analyze() {
  return (
    <PageChrome
      active="Analyze"
      eyebrow="Case Notes"
      title="Analyze the"
      titleEm="patterns."
      tagline="Historical accuracy, cost impact at scale, and hallucination regression."
    >
      <Tabs
        tabs={[
          { id: 'calibration',   label: 'Calibration',    render: () => <Calibration /> },
          { id: 'blast-radius',  label: 'Blast radius',   render: () => <BlastRadius /> },
          { id: 'hallucination', label: 'Hallucination',  render: () => <HallucinationSuite /> },
        ]}
      />
    </PageChrome>
  );
}
