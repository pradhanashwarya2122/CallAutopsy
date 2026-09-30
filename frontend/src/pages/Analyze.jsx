import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import PageChrome from '../components/PageChrome';
import SampleSelect from '../components/SampleSelect';
import { useSampleLibrary } from '../hooks/useSampleLibrary';
import { REFERENCE } from '../lib/reference';

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
const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
const usd = (v, dp = 2) => `$${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const usd6 = (v) => `$${Number(v ?? 0).toFixed(6)}`;

// Measured benchmark shown next to the workspace's own numbers, so an empty workspace still has real values to read.
function CalibrationReference() {
  const r = REFERENCE.faults;
  const rows = r.rows.map((x) => ({ ...x, right: x.predicted.filter((p) => p === x.injected).length }));
  const deterministic = rows.filter((x) => x.injected !== 'hallucination');
  const okDet = deterministic.reduce((a, x) => a + x.right, 0);
  const nDet = deterministic.reduce((a, x) => a + x.predicted.length, 0);
  return (
    <div className="pc-section pc-panel">
      <h3 className="pc-h">Measured reference</h3>
      <p className="pc-sub" style={{ marginBottom: 12 }}>
        Each failure type was injected into {r.sample.length} different demo calls through the live pipeline ({REFERENCE.measuredOn}), and the diagnosis was compared with the fault that was injected.
        {' '}The six rule-based faults were diagnosed correctly {okDet} of {nDet} times.
        {' '}{REFERENCE.clean.ok} of {REFERENCE.clean.n} healthy demo calls were called healthy
        {REFERENCE.clean.other.length ? ` (the other one, ${REFERENCE.clean.other.map((o) => `${o.id} → ${o.predicted}`).join(', ')}, is a deliberately noisy clip)` : ''}.
      </p>
      <table className="pc-table">
        <thead><tr><th>Injected</th><th>Diagnosed correctly</th><th>Diagnosed as</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.injected}>
              <td className="mono">{x.injected}</td>
              <td className="mono">{x.right} of {x.predicted.length}</td>
              <td>{x.predicted.map((p, i) => <span key={i} className={`pc-tag ${p === x.injected ? 'green' : 'red'}`} style={{ marginRight: 6 }}>{p}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pc-sub" style={{ marginTop: 12, fontSize: 12 }}>
        Hallucination is the weak spot: making the model invent things also made two of the three replies slow enough to be called a timeout first (the classifier checks time before content), and one reply was simply not wrong. That verdict depends on the model misbehaving on cue.
      </p>
    </div>
  );
}

function Calibration() {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState(null);
  const [mistakes, setMistakes] = useState(null);
  const [error, setError] = useState('');
  const { serverSamples: library, error: samplesError, reload: reloadSamples, missing: missingSamples } = useSampleLibrary();
  const samples = library ?? [];
  const [sampleId, setSampleId] = useState('');
  const [scope, setScope] = useState('one');
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
    return () => clearTimeout(timer.current);
  }, [load]);
  useEffect(() => { if (samples.length && !sampleId) setSampleId(samples[0].id); }, [samples, sampleId]);

  const coreIds = samples.filter((x) => x.group === 'core').slice(0, 3).map((x) => x.id);
  const jobs = scope === 'core' ? coreIds.length * 8 : 8;
  const startRun = async () => {
    setStarting(true); setNote('');
    try {
      const r = await api.calibrationRun(scope === 'core' ? coreIds : [sampleId]);
      setNote(`Running ${r.total} analyses in the background (per call: one clean, one per failure type). Results appear below as they finish.`);
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
  const smallSample = data && data.total > 0 && data.faultRuns < 14;

  return (
    <div className="pc-body" style={{ marginTop: 0 }}>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        How often the classifier names the right failure, measured against the failures you injected on purpose and the clean control calls made by "Generate calibration data" (so false alarms show up too). Your own uploads and recordings are not scored here: nobody knows in advance what should be diagnosed for them. These are your own calls only.
      </p>

      {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)', marginBottom: 14 }}>{error}</p>}

      <div className="pc-panel pc-section">
        <p className="pc-h">Generate calibration data</p>
        <p className="pc-sub" style={{ marginBottom: 10 }}>
          Runs one clean call and each of the 7 failure types on the demo call you choose. One call gives a single example per failure type, so percentages stay coarse; three calls give a sturdier sample.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="pc-chip-row" role="group" aria-label="How many calls" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`pc-chip ${scope === 'one' ? 'on' : ''}`} onClick={() => setScope('one')}>One call · 8 analyses</button>
            <button type="button" className={`pc-chip ${scope === 'core' ? 'on' : ''}`} onClick={() => setScope('core')} disabled={coreIds.length < 3}>Three core calls · 24 analyses</button>
          </div>
          {samplesError && <span className="pc-sub" role="alert" style={{ color: 'var(--red)' }}>{samplesError} <button type="button" className="pc-chip" onClick={reloadSamples}>Try again</button></span>}
          {scope === 'one' && <SampleSelect samples={samples} value={sampleId} onChange={setSampleId} label="Demo call for calibration" style={{ minWidth: 300 }} />}
          <button onClick={startRun} disabled={starting || data?.running || (scope === 'one' ? !sampleId : coreIds.length < 3)} className="pc-btn">
            {data?.running ? 'Running…' : starting ? 'Starting…' : `Run ${jobs} analyses`}
          </button>
        </div>
        {missingSamples > 0 && <p className="pc-sub" role="status" style={{ color: 'var(--amber, #8a5a00)', marginTop: 8 }}>This server lacks {missingSamples} demo calls that the app ships with (it runs an older build), so calibration can use only the rest. Redeploy the backend to get all 19.</p>}
        <p className="pc-sub" style={{ marginTop: 8, fontSize: 12 }}>Costs roughly {usd(jobs * 0.004, 2)} and counts against your daily limit.</p>
        {note && <p className="pc-sub" style={{ marginTop: 10 }}>{note}</p>}
      </div>

      <div className="pc-grid g3 pc-section">
        <div className="pc-meta-card">
          <p className="k">Overall accuracy</p>
          <p className="v">{data && data.total ? `${overall.toFixed(0)}%` : '—'}</p>
          <p className="h">{data ? (data.total ? `${data.correct} correct of ${data.total} scored calls (${data.faultRuns} with an injected failure, ${data.cleanRuns} clean)` : 'no scored calls yet — see the measured reference below') : 'loading…'}</p>
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
              <p className="h">no scored calls in the last 24h</p>
            </>
          )}
        </div>
        <div className="pc-meta-card">
          <p className="k">Injected failures scored</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
            {LABELS.filter((l) => l !== 'ok').map((l) => {
              const row = data ? LABELS.map((c) => cell(l, c) ?? 0).reduce((a, b) => a + b, 0) : 0;
              if (!row) return null;
              const right = cell(l, l) ?? 0;
              return (
                <li key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span className="mono">{l}</span>
                  <b>{right} of {row} right</b>
                </li>
              );
            })}
            {(!data || !data.faultRuns) && <li style={{ color: 'var(--mute)' }}>—</li>}
          </ul>
        </div>
      </div>

      {smallSample && (
        <p className="pc-sub" role="note" style={{ marginBottom: 14, color: 'var(--amber, #8a5a00)' }}>
          Only {data.faultRuns} injected failures are scored so far, so a single call moves a label's percentage by a large step. Read the counts (for example 1 of 1) rather than the percentages, or run the three-call set.
        </p>
      )}

      <div className="pc-section pc-panel">
        <h3 className="pc-h">Per-label metrics</h3>
        {!data || !perLabelEntries.length ? (
          <p className="pc-sub">No scored calls yet. Use "Generate calibration data" above, or run demo calls with "Simulate a failure" on the Dashboard. The measured reference below shows what a full run looks like.</p>
        ) : (
          <table className="pc-table">
            <thead>
              <tr><th>Label</th><th>Right</th><th>Missed</th><th>Wrongly called</th><th style={{ width: '28%' }}>Precision</th><th style={{ width: '28%' }}>Recall</th></tr>
            </thead>
            <tbody>
              {perLabelEntries.map(([label, m]) => (
                <tr key={label}>
                  <td className="mono">{label}</td>
                  <td className="mono" title="true positives">{m.tp}</td>
                  <td className="mono" title="false negatives: injected but diagnosed as something else">{m.fn}</td>
                  <td className="mono" title="false positives: diagnosed as this label when it was something else">{m.fp}</td>
                  {[['precision', `${m.tp} of ${m.tp + m.fp}`], ['recall', `${m.tp} of ${m.tp + m.fn}`]].map(([k, frac]) => (
                    <td key={k}>
                      {m[k] == null ? <span className="mono" style={{ color: 'var(--mute)' }}>— <span style={{ fontSize: 11 }}>{k === 'precision' ? 'never predicted' : 'never injected'}</span></span> : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ width: 92 }}>{fmtPct(m[k])} <span style={{ color: 'var(--mute)', fontSize: 11 }}>({frac})</span></span>
                          <div className="pc-bar" style={{ flex: 1 }}><i style={{ width: `${m[k] * 100}%` }} /></div>
                        </div>
                      )}
                    </td>
                  ))}
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
          <p className="pc-sub">{data && data.total ? 'No mismatches on record.' : 'Nothing to show until you have some scored calls.'}</p>
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

      <CalibrationReference />
    </div>
  );
}

/* ============================================================
   2. Blast radius
   ============================================================ */
const PRESETS = [100, 1000, 10000, 100000, 1000000];

function BlastRadius() {
  const [volume, setVolume] = useState(10000);
  const [ratePct, setRatePct] = useState(5);
  const [reductionPct, setReductionPct] = useState(50);
  const [r, setR] = useState(null);
  const [error, setError] = useState('');

  // Recomputed as the inputs change: the maths is a few multiplications on measured costs, so there is nothing to wait for.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try { const res = await api.blastRadius(volume, ratePct); if (live) { setR(res); setError(''); } }
      catch (e) { if (live) setError(e instanceof ApiError ? e.message : 'Could not project. Check your connection and try again.'); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [volume, ratePct]);

  const savings = r ? r.monthlyImpactUsd * (reductionPct / 100) : 0;
  const stageRows = !r ? [] : r.stages.length ? r.stages : (() => {
    const total = REFERENCE.costStages.reduce((a, x) => a + x.avgCostUsd, 0);
    return REFERENCE.costStages.map((x) => ({ ...x, share: x.avgCostUsd / total, monthlyUsd: r.monthlyCalls * x.avgCostUsd }));
  })();
  const measured = r?.basis === 'your_calls';

  return (
    <div className="pc-body" style={{ marginTop: 0 }}>
      <p className="pc-sub" style={{ marginBottom: 18 }}>
        What a failure rate costs at your call volume. You choose the volume and the failure rate; what a call costs and where the money goes is measured on real calls.
        Your own failure rate is not used: most calls in a workspace are demo calls with failures injected on purpose, which says nothing about real traffic.
      </p>

      <div className="pc-panel pc-section">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <span className="pc-h" style={{ margin: 0 }}>Calls per day</span>
          {PRESETS.map((v) => (
            <button key={v} onClick={() => setVolume(v)} className={`pc-chip ${volume === v ? 'on' : ''}`}>{v.toLocaleString()}</button>
          ))}
          <input type="number" min={1} max={10000000} value={volume} aria-label="Calls per day"
            onChange={(e) => setVolume(Math.max(1, Math.min(10000000, Number(e.target.value) || 1)))} className="pc-input" style={{ width: 130, marginLeft: 'auto' }} />
        </div>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--mute)' }}>
            <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>Assumed failure rate</span>
            <span className="mono">{ratePct}% of calls</span>
          </span>
          <input type="range" min={0.5} max={50} step={0.5} value={ratePct} aria-label="Assumed failure rate percent"
            onChange={(e) => setRatePct(Number(e.target.value))} className="pc-range" style={{ '--pct': `${((ratePct - 0.5) / 49.5) * 100}%` }} />
        </label>
      </div>

      {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      {r && (
        <>
          <div className="pc-grid g3 pc-section">
            <div className="pc-meta-card">
              <p className="k">Monthly spend</p>
              <p className="v">{usd(r.monthlySpendUsd)}</p>
              <p className="h">{r.monthlyCalls.toLocaleString()} calls × {usd6(r.avgCallUsd)} per call</p>
            </div>
            <div className="pc-meta-card">
              <p className="k">Failed calls per month</p>
              <p className="v">{Math.round(r.monthlyFailures).toLocaleString()}</p>
              <p className="h">at {r.failureRatePct}%</p>
            </div>
            <div className="pc-meta-card">
              <p className="k">Money lost to failures</p>
              <p className="v" style={{ color: 'var(--red)' }}>{usd(r.monthlyImpactUsd)}</p>
              <p className="h">{usd(r.wastedOnFailuresUsd)} spent on the failed calls + {usd(r.retryCostUsd)} to redo each once</p>
            </div>
          </div>

          <p className="pc-sub" role="note" style={{ margin: '14px 0', fontSize: 12 }}>
            {measured
              ? `A healthy call costs the average of your healthy calls with no failure injected. Of your ${r.sampleSize} finished calls, ${r.failedInSample} failed and ${r.injectedInSample} had a failure injected on purpose; a failed call averaged ${usd6(r.avgFailedCallUsd)}.`
              : `You have no healthy calls of your own yet, so the cost of a healthy call uses the measured average of ${r.reference.n} real demo calls (${usd6(r.reference.avgCallUsd)}, range ${usd6(r.reference.minCallUsd)} to ${usd6(r.reference.maxCallUsd)}). Analyze a few calls and these become your own.`}
            {' '}A retry is assumed to cost as much as a healthy call. Nothing here counts lost customers or agent time.
          </p>

          <div className="pc-panel pc-section">
            <h3 className="pc-h">Where each call's money goes</h3>
            {r.stages.length === 0 && <p className="pc-sub" style={{ marginBottom: 10 }}>You have no healthy calls of your own yet, so this is the measured reference ({REFERENCE.measuredOn}, calls with no failure injected).</p>}
            {(

              <table className="pc-table">
                <thead><tr><th>Stage</th><th>Provider</th><th>Calls measured</th><th>Cost per call</th><th style={{ width: '30%' }}>Share</th><th>At this volume, per month</th></tr></thead>
                <tbody>
                  {stageRows.map((s) => (
                    <tr key={`${s.stage}-${s.provider}`}>
                      <td className="mono" style={{ textTransform: 'uppercase' }}>{s.stage}</td>
                      <td className="mono">{s.provider}</td>
                      <td className="mono">{s.n}</td>
                      <td className="mono">{usd6(s.avgCostUsd)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ width: 40 }}>{Math.round(s.share * 100)}%</span>
                          <div className="pc-bar" style={{ flex: 1 }}><i style={{ width: `${s.share * 100}%` }} /></div>
                        </div>
                      </td>
                      <td className="mono">{usd(s.monthlyUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {r.byFault.length > 0 && (
            <div className="pc-panel pc-section">
              <h3 className="pc-h">What a failed call cost, by cause (your calls)</h3>
              <table className="pc-table">
                <thead><tr><th>Cause</th><th>Failed calls</th><th>Average cost</th><th>Range</th></tr></thead>
                <tbody>
                  {r.byFault.map((f) => (
                    <tr key={f.faultType}>
                      <td><span className="pc-tag red">{f.faultType}</span></td>
                      <td className="mono">{f.n}</td>
                      <td className="mono">{usd6(f.avgCostUsd)}</td>
                      <td className="mono">{usd6(f.minCostUsd)} – {usd6(f.maxCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pc-sub" style={{ marginTop: 10, fontSize: 12 }}>A failure that stops early (a dropped connection, a hang-up, an exception) spends almost nothing; one that fails late, after the model and the voice have run, spends nearly a full call.</p>
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
                <input type="range" min={0} max={100} step={5} value={reductionPct} aria-label="Failure reduction percent"
                  onChange={(e) => setReductionPct(Number(e.target.value))} className="pc-range" style={{ '--pct': `${reductionPct}%` }} />
              </label>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 500, margin: 0, color: 'var(--green)' }}>{usd(savings)}</p>
                <p className="pc-sub">saved per month · failure rate {(ratePct * (1 - reductionPct / 100)).toFixed(1)}%</p>
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
        Seven questions about things that do not exist (a fictional company, a fictional law, an invented astronaut). A well-behaved assistant declines; one that invents an answer is caught by a second model acting as judge.
        The rate is a property of the model and the judge, so it moves a little from run to run: read the trend over several runs, not one number. A prompt whose check could not run is shown as not measured and left out of the rate.
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
                                {r.error ? <span className="pc-tag amber">NOT MEASURED</span> : r.hallucinated ? <span className="pc-tag red">INVENTED</span> : <span className="pc-tag green">DECLINED / GROUNDED</span>}
                                <span className="mono" style={{ color: 'var(--mute)' }}>· {r.id}</span>
                              </div>
                              {r.prompt && <p style={{ marginTop: 6, fontSize: 13 }}><b>Asked:</b> {r.prompt}</p>}
                              {r.expected && <p style={{ marginTop: 2, fontSize: 12, color: 'var(--mute)' }}><b>A good answer:</b> {r.expected}</p>}
                              <p style={{ marginTop: 6, fontSize: 13 }}><b>Replied:</b> {r.response || '—'}</p>
                              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--mute)', fontStyle: 'italic' }}>{r.error ? 'The check did not run: ' : 'Judge: '}{r.reasoning}</p>
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
