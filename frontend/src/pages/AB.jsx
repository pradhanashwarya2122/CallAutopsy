import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import PageChrome from '../components/PageChrome';

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
const GROUPS = [['core', 'Core scenarios'], ['stress', 'Stress tests'], ['quick', 'Quick clips']];
const pretty = (s) => String(s || '').replace(/_/g, ' ');
const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const secs = (n) => (n == null ? '—' : `${n.toFixed(1)}s`);

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
        <Stat label="Avg time" value={secs(sum.avgLatencyS)} />
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

export default function AB() {
  const [samples, setSamples] = useState(null);
  const [sampleId, setSampleId] = useState('');
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [faultType, setFaultType] = useState('none');
  const [iterations, setIterations] = useState(2);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    api.samples().then((r) => {
      const list = r.samples ?? [];
      setSamples(list);
      if (list.length) setSampleId((cur) => cur || list[0].id);
    }).catch(() => setSamples([]));
    return () => clearTimeout(timer.current);
  }, []);

  const poll = async (runId) => {
    try {
      const r = await api.getAb(runId);
      setResult(r);
      if (r.status === 'running') timer.current = setTimeout(() => poll(runId), 1500);
      else setRunning(false);
    } catch (e) {
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
  const summary = result?.summary;
  const done = result?.status === 'done';
  const winner = done ? result.verdict.winner : null;
  const hasScript = summary && (summary.configA.avgWordErrorRate != null || summary.configB.avgWordErrorRate != null);

  return (
    <PageChrome active="A/B" eyebrow="Comparative Trial" title="A/B" titleEm="comparison." tagline="Run the same call through two configurations and read the verdict.">
      <div className="pc-panel pc-section">
        <p className="pc-h">1. Call to test</p>
        {samples === null ? <p className="pc-sub">Loading demo calls…</p> : samples.length === 0 ? (
          <p className="pc-sub">No demo calls on this server.</p>
        ) : (
          <>
            <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} aria-label="Call to test" className="pc-input" style={{ width: '100%', maxWidth: 520 }}>
              {GROUPS.map(([g, label]) => {
                const list = samples.filter((s) => (s.group || 'quick') === g);
                return list.length ? (
                  <optgroup key={g} label={`${label} (${list.length})`}>
                    {list.map((s) => <option key={s.id} value={s.id}>{s.label}{s.duration_s ? ` (${Math.round(s.duration_s)}s)` : ''}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
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
            <input type="range" min={1} max={5} step={1} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} className="pc-range" style={{ '--pct': `${((iterations - 1) / 4) * 100}%` }} aria-label="Runs per side" />
            <p className="pc-sub" style={{ marginTop: 6 }}>{iterations * 2} calls in total, counted against your daily limit.</p>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <button onClick={run} disabled={running || !sampleId} className="pc-btn">
            {running ? `Running… ${result?.progress?.finished ?? 0} of ${iterations * 2} finished` : `Run ${iterations * 2} calls`}
          </button>
        </div>
        {error && <p className="pc-sub" role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}
      </div>

      {summary && (
        <>
          {done && (
            <div className="pc-panel pc-section">
              <p className="pc-h">Verdict</p>
              {winner === 'tie' ? (
                <p style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '6px 0 0' }}>No clear winner: the two configurations performed about the same on this call.</p>
              ) : (
                <>
                  <p style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '6px 0 0' }}>Config {winner} wins</p>
                  {result.verdict.reasons.map((r) => <p key={r} className="pc-sub" style={{ marginTop: 4 }}>{r}</p>)}
                </>
              )}
              <p className="pc-sub" style={{ marginTop: 10, fontSize: 12 }}>
                A verdict needs a real gap: 1 or more failed calls out of 5, 3 points of transcript accuracy, or a 10% difference in time or cost. Small samples are noisy, so treat this as a hint, not proof.
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
                <thead><tr><th>#</th><th>Side</th><th>STT</th><th>Outcome</th><th>Time</th><th>Transcript errors</th><th>Cost</th></tr></thead>
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
      )}
    </PageChrome>
  );
}
