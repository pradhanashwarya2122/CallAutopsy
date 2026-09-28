import { useState } from 'react';
import { api } from '../lib/api';
import PageChrome from '../components/PageChrome';

/* ============================================================
   A/B COMPARISON — pick a scenario + fault + iteration count,
   backend runs the same input through both configs, we show
   the side-by-side result.
   ============================================================ */

const SCENARIOS = [
  {
    id: 'stt_bake_off',
    label: 'STT bake-off',
    desc: 'Deepgram nova-3 vs OpenAI Whisper on the same clip.',
    configA: { preferredSttProvider: 'deepgram' },
    configB: { preferredSttProvider: 'whisper' },
  },
  {
    id: 'llm_cost_quality',
    label: 'LLM cost vs quality',
    desc: 'gpt-4o-mini vs gpt-4o head to head.',
    configA: { llmModel: 'gpt-4o-mini' },
    configB: { llmModel: 'gpt-4o' },
  },
  {
    id: 'combined',
    label: 'Fast + cheap vs premium',
    desc: 'Deepgram + gpt-4o-mini vs Whisper + gpt-4o.',
    configA: { preferredSttProvider: 'deepgram', llmModel: 'gpt-4o-mini' },
    configB: { preferredSttProvider: 'whisper', llmModel: 'gpt-4o' },
  },
];

const FAULTS = ['none', 'bad_stt', 'hallucination', 'timeout', 'tts_glitch'];

function SummaryCard({ label, cfg, sum, winner }) {
  return (
    <div className={`pc-panel ${winner ? 'pc-winner' : ''}`}>
      <p className="pc-h" style={{ margin: 0 }}>{label}</p>
      <p className="mono" style={{ fontSize: 11, color: 'var(--mute)', margin: '4px 0 14px', wordBreak: 'break-all' }}>
        {JSON.stringify(cfg)}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Runs</p>
          <p className="mono" style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0' }}>{sum.n}</p>
        </div>
        <div>
          <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Failed</p>
          <p className="mono" style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0', color: sum.failed > 0 ? 'var(--red)' : 'var(--ink)' }}>{sum.failed}</p>
        </div>
        <div>
          <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Failure rate</p>
          <p className="mono" style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0' }}>{(sum.failureRate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Avg cost</p>
          <p className="mono" style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0' }}>${sum.avgCostUsd.toFixed(6)}</p>
        </div>
        <div style={{ gridColumn: '1 / -1', paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Total cost</p>
          <p className="mono" style={{ fontSize: 16, margin: '4px 0 0' }}>${sum.totalCostUsd.toFixed(6)}</p>
        </div>
      </div>
    </div>
  );
}

export default function AB() {
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [faultType, setFaultType] = useState('none');
  const [iterations, setIterations] = useState(3);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { runId } = await api.runAb(scenario.configA, scenario.configB, faultType === 'none' ? null : faultType, iterations);
      setResult(await api.getAb(runId));
    } catch (e) {
      alert(`A/B run failed: ${e.message}`);
    } finally { setRunning(false); }
  };

  const summary = result?.summary;
  let winner = null;
  if (summary) {
    if (summary.configA.failureRate !== summary.configB.failureRate) {
      winner = summary.configA.failureRate < summary.configB.failureRate ? 'A' : 'B';
    } else if (summary.configA.avgCostUsd !== summary.configB.avgCostUsd) {
      winner = summary.configA.avgCostUsd < summary.configB.avgCostUsd ? 'A' : 'B';
    }
  }
  const costDelta = summary ? summary.configB.avgCostUsd - summary.configA.avgCostUsd : 0;
  const rateDelta = summary ? (summary.configB.failureRate - summary.configA.failureRate) * 100 : 0;

  return (
    <PageChrome
      active="A/B"
      eyebrow="Comparative Trial"
      title="A/B"
      titleEm="comparison."
      tagline="Run the same fault through two configs and read the verdict."
    >
      {/* Step 1 — scenario */}
      <div className="pc-panel pc-section">
        <p className="pc-h">1. Scenario</p>
        <div className="pc-grid g3" style={{ marginTop: 6 }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScenario(s)}
              className="pc-panel"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                background: scenario.id === s.id ? 'rgba(255,253,247,.98)' : 'var(--panel)',
                borderColor: scenario.id === s.id ? 'var(--ink)' : 'var(--line)',
                borderWidth: scenario.id === s.id ? 2 : 1,
                padding: scenario.id === s.id ? '17px 19px' : '18px 20px',
              }}
            >
              <p style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, margin: 0 }}>{s.label}</p>
              <p className="pc-sub" style={{ marginTop: 6 }}>{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2 + 3 */}
      <div className="pc-panel pc-section">
        <div className="pc-grid g2">
          <div>
            <p className="pc-h">2. Fault to inject</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {FAULTS.map((f) => (
                <button key={f} onClick={() => setFaultType(f)} className={`pc-chip ${faultType === f ? 'on' : ''}`}>{f}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="pc-h">3. Iterations per side <span className="mono" style={{ color: 'var(--mute)', fontSize: 11 }}>({iterations})</span></p>
            <input type="range" min={1} max={10} step={1} value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              className="pc-range" style={{ '--pct': `${((iterations - 1) / 9) * 100}%` }} />
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <button onClick={run} disabled={running} className="pc-btn">
            {running ? `Running ${iterations * 2} calls…` : `Run ${iterations * 2} calls`}
          </button>
        </div>
      </div>

      {running && (
        <div className="pc-grid g2 pc-section">
          <div className="pc-panel" style={{ minHeight: 180 }}><p className="pc-sub">Running config A…</p></div>
          <div className="pc-panel" style={{ minHeight: 180 }}><p className="pc-sub">Running config B…</p></div>
        </div>
      )}

      {summary && (
        <>
          <div className="pc-grid g2 pc-section">
            <SummaryCard label="Config A" cfg={result.run.config_a} sum={summary.configA} winner={winner === 'A'} />
            <SummaryCard label="Config B" cfg={result.run.config_b} sum={summary.configB} winner={winner === 'B'} />
          </div>

          <div className="pc-panel pc-section">
            <p className="pc-h">Deltas (B − A)</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Cost per call</p>
                <p className="mono" style={{ fontSize: 26, fontWeight: 500, margin: '6px 0 0', color: costDelta > 0 ? 'var(--red)' : costDelta < 0 ? 'var(--green)' : 'var(--ink)' }}>
                  {costDelta >= 0 ? '+' : ''}${costDelta.toFixed(6)}
                </p>
              </div>
              <div>
                <p className="mono" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', margin: 0 }}>Failure rate</p>
                <p className="mono" style={{ fontSize: 26, fontWeight: 500, margin: '6px 0 0', color: rateDelta > 0 ? 'var(--red)' : rateDelta < 0 ? 'var(--green)' : 'var(--ink)' }}>
                  {rateDelta >= 0 ? '+' : ''}{rateDelta.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          <div className="pc-panel pc-section">
            <p className="pc-h">Per-call detail</p>
            <table className="pc-table">
              <thead>
                <tr><th>#</th><th>Side</th><th>STT</th><th>Predicted</th><th>Status</th><th>Cost</th></tr>
              </thead>
              <tbody>
                {result.calls.map((c, i) => (
                  <tr key={c.id}>
                    <td className="mono">{i + 1}</td>
                    <td><span className={`pc-tag ${i % 2 === 0 ? 'blue' : 'violet'}`}>{i % 2 === 0 ? 'A' : 'B'}</span></td>
                    <td className="mono">{c.stt_provider_used ?? '—'}</td>
                    <td>{c.predicted_category ? <span className={`pc-tag ${c.status === 'failed' ? 'red' : 'green'}`}>{c.predicted_category}</span> : '—'}</td>
                    <td className="mono" style={{ color: c.status === 'failed' ? 'var(--red)' : 'var(--green)' }}>{c.status}</td>
                    <td className="mono">${Number(c.total_cost_usd ?? 0).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageChrome>
  );
}
