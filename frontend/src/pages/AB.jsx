import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import PageChrome from '../components/PageChrome';
import SampleSelect from '../components/SampleSelect';
import { useSampleLibrary } from '../hooks/useSampleLibrary';
import { REFERENCE } from '../lib/reference';

/* ============================================================
   A/B COMPARISON: pick a demo call, a scenario and a fault; the same
   audio runs through two configurations and the results are compared.
   The run happens in the background; this page polls for progress.
   ============================================================ */

const SCENARIOS = [
  { id: 'stt_bake_off', label: 'STT bake-off', desc: 'Deepgram nova-3 vs OpenAI Whisper on the same call.', configA: { preferredSttProvider: 'deepgram' }, configB: { preferredSttProvider: 'whisper' } },
  { id: 'llm_cost_quality', label: 'LLM cost vs quality', desc: 'gpt-4o-mini vs gpt-4o answering the same call.', configA: { llmModel: 'gpt-4o-mini' }, configB: { llmModel: 'gpt-4o' } },
  { id: 'combined', label: 'Fast + cheap vs premium', desc: 'Deepgram + gpt-4o-mini vs Whisper + gpt-4o.', configA: { preferredSttProvider: 'deepgram', llmModel: 'gpt-4o-mini' }, configB: { preferredSttProvider: 'whisper', llmModel: 'gpt-4o' } },
];
const FAULTS = ['none', 'bad_stt', 'hallucination', 'tts_glitch', 'timeout', 'user_hangup', 'network_drop', 'exception'];
const pretty = (s) => String(s || '').replace(/_/g, ' ');
const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const secs = (n) => (n == null ? '—' : `${n.toFixed(1)}s`);
const fmtMetric = (id, v) => (v == null ? '—' : id === 'failures' ? pct(v) : id === 'accuracy' ? `${Math.round(v * 1000) / 10}%` : id === 'speed' ? secs(v) : usd(v));

const Label = ({ children }) => (
  <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>{children}</p>
);
const Stat = ({ label, value, warn }) => (
  <div>
    <Label>{label}</Label>
    <p className="mono" style={{ fontSize: 20, fontWeight: 500, margin: '4px 0 0', color: warn ? 'var(--red)' : 'var(--ink)' }}>{value}</p>
  </div>
);

function SummaryCard({ label, cfg, sum, winner, hasScript }) {
  return (
    <div className={`pc-panel ${winner ? 'pc-winner' : ''}`}>
      <p className="pc-h" style={{ margin: 0 }}>{label}{winner && <span className="pc-tag green" style={{ marginLeft: 10 }}>winner</span>}</p>
      <p className="mono" style={{ fontSize: 11, color: 'var(--mute)', margin: '4px 0 14px', wordBreak: 'break-all' }}>{JSON.stringify(cfg)}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Stat label="Finished" value={sum.n} />
        <Stat label="Failed" value={`${sum.failed} (${pct(sum.failureRate)})`} warn={sum.failed > 0} />
        <Stat label="Avg pipeline time" value={secs(sum.avgLatencyS)} />
        <Stat label="Avg cost" value={usd(sum.avgCostUsd)} />
        {hasScript && <Stat label="Transcript errors" value={pct(sum.avgWordErrorRate)} />}
        <Stat label="Fell back to Whisper" value={sum.failoverCount} />
      </div>
      {sum.primaryIntent && <p className="pc-sub" style={{ marginTop: 12 }}>Understood as: <b>{pretty(sum.primaryIntent)}</b></p>}
      {sum.sampleTranscript && (
        <p className="pc-sub" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>Heard: “{sum.sampleTranscript.slice(0, 220)}{sum.sampleTranscript.length > 220 ? '…' : ''}”</p>
      )}
    </div>
  );
}


const REFERENCE_RESULT = {
  status: 'done',
  run: { config_a: REFERENCE.ab.configA, config_b: REFERENCE.ab.configB },
  summary: { configA: REFERENCE.ab.a, configB: REFERENCE.ab.b },
  verdict: { winner: REFERENCE.ab.winner, headline: REFERENCE.ab.headline, metrics: REFERENCE.ab.metrics, caveats: REFERENCE.ab.caveats ?? [] },
  calls: REFERENCE.ab.calls,
};

function ResultView({ result }) {
  const summary = result?.summary;
  const done = result?.status === 'done';
  const verdict = done ? result.verdict : null;
  const winner = verdict && (verdict.winner === 'A' || verdict.winner === 'B') ? verdict.winner : null;
  const hasScript = summary && (summary.configA.avgWordErrorRate != null || summary.configB.avgWordErrorRate != null);
  if (!summary) return null;
  return (
      <>
          {verdict && (
            <div className="pc-panel pc-section">
              <p className="pc-h">Verdict</p>
              <p style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '6px 0 0' }}>{verdict.headline}</p>
              {verdict.caveats.map((c) => <p key={c} className="pc-sub" style={{ marginTop: 6, color: 'var(--amber, #8a5a00)' }}>{c}</p>)}
              {verdict.metrics.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table className="pc-table">
                    <thead><tr><th>Measure</th><th>Config A</th><th>Config B</th><th>Result</th></tr></thead>
                    <tbody>
                      {verdict.metrics.map((m) => (
                        <tr key={m.id}>
                          <td>{m.label}</td>
                          <td className="mono">{fmtMetric(m.id, m.a)}</td>
                          <td className="mono">{fmtMetric(m.id, m.b)}</td>
                          <td>{m.better === 'none' ? <span className="pc-tag">no difference</span> : <span className="pc-tag green">{m.better} is better</span>} <span className="pc-sub" style={{ fontSize: 12 }}>{m.why}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="pc-sub" style={{ marginTop: 10, fontSize: 12 }}>
                A side only wins a measure when the gap is meaningful (half of the runs failing, 3 points of transcript accuracy, or 10% in time or cost) and every run of the better side beats every run of the other. Quality outranks speed and cost. With a handful of runs this is a strong hint, not proof.
              </p>
            </div>
          )}
          <div className="pc-grid g2 pc-section">
            <SummaryCard label="Config A" cfg={result.run.config_a} sum={summary.configA} winner={winner === 'A'} hasScript={hasScript} />
            <SummaryCard label="Config B" cfg={result.run.config_b} sum={summary.configB} winner={winner === 'B'} hasScript={hasScript} />
          </div>

          <div className="pc-panel pc-section">
            <p className="pc-h">Per-call detail</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="pc-table">
                <thead><tr><th>#</th><th>Side</th><th>STT</th><th>Outcome</th><th>Pipeline time</th><th>Transcript errors</th><th>Cost</th></tr></thead>
                <tbody>
                  {result.calls.map((c, i) => (
                    <tr key={c.id}>
                      <td className="mono">{i + 1}</td>
                      <td><span className={`pc-tag ${c.side === 'A' ? 'blue' : 'violet'}`}>{c.side ?? '—'}</span></td>
                      <td className="mono">{c.stt_provider_used ?? '—'}{c.failover ? ' (fallback)' : ''}</td>
                      <td>{c.status === 'completed' || c.status === 'failed'
                        ? <span className={`pc-tag ${c.status === 'failed' ? 'red' : 'green'}`}>{c.status === 'failed' ? pretty(c.predicted_category) : 'ok'}</span>
                        : <span className="pc-tag">running</span>}</td>
                      <td className="mono">{secs(c.latency_s)}</td>
                      <td className="mono">{pct(c.wer)}</td>
                      <td className="mono">{usd(c.total_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
  );
}

export default function AB() {
  const { samples, error: samplesError, reload: reloadSamples, missing: missingSamples } = useSampleLibrary();
  const [sampleId, setSampleId] = useState('');
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [faultType, setFaultType] = useState('none');
  const [iterations, setIterations] = useState(2);
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    loadRecent();
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  useEffect(() => { if (samples && samples.length) setSampleId((cur) => cur || samples[0].id); }, [samples]);
  const loadRecent = () => api.abList().then((r) => { if (alive.current) setRecent(r.runs ?? []); }).catch(() => { if (alive.current) setRecent([]); });
  const openRun = async (id) => {
    clearTimeout(timer.current); setError('');
    try { const r = await api.getAb(id); if (!alive.current) return; setResult(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not open that comparison.'); }
  };

  const poll = async (runId) => {
    try {
      const r = await api.getAb(runId);
      if (!alive.current) return; // the page was left while this request was in flight
      setResult(r);
      if (r.status === 'running') timer.current = setTimeout(() => poll(runId), 1500);
      else { setRunning(false); loadRecent(); }
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof ApiError ? e.message : 'Lost contact with the server while the run was in progress.');
      setRunning(false);
    }
  };

  const run = async () => {
    setError('');
    setResult(null);
    setRunning(true);
    try {
      const { runId } = await api.runAb({ sampleId, configA: scenario.configA, configB: scenario.configB, faultType: faultType === 'none' ? null : faultType, iterations });
      poll(runId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the run. Check your connection and try again.');
      setRunning(false);
    }
  };

  const chosen = (samples || []).find((s) => s.id === sampleId);
  return (
    <PageChrome active="A/B" eyebrow="Comparative Trial" title="A/B" titleEm="comparison." tagline="Run the same call through two configurations and read the verdict.">
      <div className="pc-panel pc-section">
        <p className="pc-h">1. Call to test</p>
        {samples === null ? <p className="pc-sub">Loading demo calls…</p> : samplesError ? (
          <p className="pc-sub" role="alert" style={{ color: 'var(--red)' }}>{samplesError} <button type="button" className="pc-chip" onClick={reloadSamples}>Try again</button></p>
        ) : samples.length === 0 ? (
          <p className="pc-sub">No demo calls on this server.</p>
        ) : (
          <>
            <SampleSelect samples={samples} value={sampleId} onChange={setSampleId} label="Call to test" style={{ width: '100%', maxWidth: 560 }} />
            {missingSamples > 0 && <p className="pc-sub" role="status" style={{ color: 'var(--amber, #8a5a00)', marginTop: 8 }}>This server has {missingSamples} fewer demo calls than the app expects (15 recordings). The backend needs redeploying with its latest samples folder.</p>}
            {chosen?.summary && <p className="pc-sub" style={{ marginTop: 8 }}>{chosen.summary}</p>}
          </>
        )}
      </div>

      <div className="pc-panel pc-section">
        <p className="pc-h">2. Scenario</p>
        <div className="pc-grid g3" style={{ marginTop: 6 }}>
          {SCENARIOS.map((s) => (
            <button key={s.id} onClick={() => setScenario(s)} className="pc-panel" style={{ textAlign: 'left', cursor: 'pointer', background: scenario.id === s.id ? 'rgba(255,253,247,.98)' : 'var(--panel)', borderColor: scenario.id === s.id ? 'var(--ink)' : 'var(--line)', borderWidth: scenario.id === s.id ? 2 : 1, padding: scenario.id === s.id ? '17px 19px' : '18px 20px' }}>
              <p style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, margin: 0 }}>{s.label}</p>
              <p className="pc-sub" style={{ marginTop: 6 }}>{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="pc-panel pc-section">
        <div className="pc-grid g2">
          <div>
            <p className="pc-h">3. Failure to inject (optional)</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {FAULTS.map((f) => <button key={f} onClick={() => setFaultType(f)} className={`pc-chip ${faultType === f ? 'on' : ''}`}>{f}</button>)}
            </div>
          </div>
          <div>
            <p className="pc-h">4. Runs per side <span className="mono" style={{ color: 'var(--mute)', fontSize: 11 }}>({iterations})</span></p>
            <input type="range" min={2} max={5} step={1} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} className="pc-range" style={{ '--pct': `${((iterations - 2) / 3) * 100}%` }} aria-label="Runs per side" />
            <p className="pc-sub" style={{ marginTop: 6 }}>{iterations * 2} calls in total, counted against your daily limit. A verdict needs at least 2 runs per side.</p>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <button onClick={run} disabled={running || !sampleId} className="pc-btn">
            {running ? `Running… ${result?.progress?.finished ?? 0} of ${iterations * 2} finished` : `Run ${iterations * 2} calls`}
          </button>
        </div>
        {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}
      </div>

      {result && <ResultView result={result} />}

      <div className="pc-panel pc-section">
        <p className="pc-h">Recent comparisons</p>
        {recent === null ? <p className="pc-sub">Loading…</p> : recent.length === 0 ? (
          <p className="pc-sub">You have not run a comparison yet. The measured example below shows what one looks like.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pc-table">
              <thead><tr><th>When</th><th>Call</th><th>Failure</th><th>Runs</th><th>Verdict</th><th /></tr></thead>
              <tbody>
                {recent.map((x) => (
                  <tr key={x.id}>
                    <td className="mono">{new Date(x.created_at).toISOString().slice(5, 16).replace('T', ' ')}</td>
                    <td className="mono">{(x.sample_id || '').replace(/\.[^.]+$/, '').slice(0, 26)}</td>
                    <td className="mono">{x.fault_type || 'none'}</td>
                    <td className="mono">{x.iterations} per side</td>
                    <td>{x.status === 'done' ? <><span className={`pc-tag ${x.winner === 'A' || x.winner === 'B' ? 'green' : ''}`}>{x.winner === 'A' || x.winner === 'B' ? `${x.winner} wins` : x.winner === 'insufficient' ? 'not enough runs' : x.winner === 'tradeoff' ? 'trade-off' : 'no clear winner'}</span> <span className="pc-sub" style={{ fontSize: 12 }}>{x.headline}</span></> : <span className="pc-tag">running</span>}</td>
                    <td><button type="button" className="pc-chip" onClick={() => openRun(x.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!result && (
        <>
          <p className="pc-sub" style={{ margin: '28px 0 10px' }}>
            <b>Measured example.</b> The same demo call ({REFERENCE.ab.sample}) was run {REFERENCE.ab.iterations} times through each of two stacks on {REFERENCE.measuredOn}, and the verdict below was produced by the same rules this page uses.
          </p>
          <ResultView result={REFERENCE_RESULT} />
        </>
      )}
    </PageChrome>
  );
}
