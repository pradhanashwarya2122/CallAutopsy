import '../styles/dashboard.css';

const pretty = (s) => String(s || '').replace(/_/g, ' ');
const SEVERITY = { issue: 'Problem', warn: 'Notice', info: 'Note' };
const AREA = { audio: 'Audio quality', speech: 'How they speak', conversation: 'Conversation', content: 'What was said' };
const ENTITY_LABEL = { order_ids: 'Order numbers', transaction_ids: 'Transaction IDs', amounts: 'Amounts', dates: 'Dates', other: 'Other' };

function List({ items, tone }) {
  if (!items || !items.length) return null;
  return <ul className={`ap-list ${tone || ''}`}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

export function Understanding({ analysis }) {
  const u = analysis?.understanding;
  if (!u) {
    return (
      <section className="ap-panel">
        <h2 className="ap-h">What the call was about</h2>
        <p className="ap-note">
          {analysis?.understanding_error === 'empty transcript'
            ? 'No speech was recognised in this recording, so there is nothing to analyze.'
            : 'The call could not be analyzed.'}
        </p>
      </section>
    );
  }
  const entities = Object.entries(u.entities || {}).filter(([, v]) => v && v.length);
  return (
    <section className="ap-panel lit" style={{ '--a1': '#e2372b', '--a2': '#f0a23a' }}>
      <h2 className="ap-h">What the call was about</h2>
      <p className="ap-sum">{u.summary}</p>

      <div className="ap-chips" aria-label="Customer intent">
        <span className="ap-chip primary" title={u.primary_intent.description}>{pretty(u.primary_intent.label)}</span>
        {u.secondary_intents.map((i, k) => <span key={k} className="ap-chip" title={i.description}>{pretty(i.label)}</span>)}
        <span className="ap-chip ghost">confidence: {u.intent_confidence}</span>
      </div>
      {u.primary_intent.description && <p className="ap-note" style={{ marginTop: 6 }}>{u.primary_intent.description}</p>}

      <div className="ap-und-grid">
        <div>
          <h3 className="ap-h3">Details heard</h3>
          {entities.length === 0 && <p className="ap-note">No order numbers, amounts or dates were given.</p>}
          {entities.map(([k, v]) => (
            <div key={k} className="ap-kv"><span>{ENTITY_LABEL[k] || k}</span><b>{v.join(', ')}</b></div>
          ))}
          {u.corrections.length > 0 && (
            <>
              <h3 className="ap-h3" style={{ marginTop: 12 }}>Corrections (the last value stands)</h3>
              {u.corrections.map((c, i) => (
                <div key={i} className="ap-corr"><span>{c.field || 'detail'}</span><s>{c.original}</s><i>→</i><b>{c.corrected}</b></div>
              ))}
            </>
          )}
        </div>
        <div>
          <h3 className="ap-h3">Tone</h3>
          <p className="ap-tone"><b>{u.sentiment.emotion}</b> <span>({u.sentiment.intensity})</span></p>
          {u.sentiment.evidence && <p className="ap-note">{u.sentiment.evidence}</p>}
          <p className="ap-fine">Judged from the words and pace, not the sound of the voice.</p>
        </div>
      </div>

      {u.established_facts.length > 0 && (<><h3 className="ap-h3">Established by the customer</h3><List items={u.established_facts} /></>)}
      {u.ambiguities.length > 0 && (<><h3 className="ap-h3">Unclear or conflicting</h3><List items={u.ambiguities} tone="warn" /></>)}
      {u.repetitions.length > 0 && (<><h3 className="ap-h3">Repeated</h3><List items={u.repetitions} /></>)}
      {u.late_information.length > 0 && (<><h3 className="ap-h3">Mentioned late</h3><List items={u.late_information} /></>)}
      {u.next_steps.length > 0 && (<><h3 className="ap-h3">Suggested next steps</h3><ol className="ap-list num">{u.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ol></>)}
      {u.escalate && <p className="ap-msg err" role="alert">Flagged for escalation: signs of fraud, a legal threat or serious distress.</p>}
    </section>
  );
}

export function Findings({ analysis }) {
  if (!analysis) return null;
  const { findings = [], difficulty, speech, signal, script_match: match } = analysis;
  const grouped = Object.keys(AREA).map((a) => [a, findings.filter((f) => f.area === a)]).filter(([, l]) => l.length);
  return (
    <section className="ap-panel">
      <div className="ap-dhead">
        <h2 className="ap-h">What we noticed</h2>
        {difficulty && <span className={`ap-diff ${difficulty.label.toLowerCase()}`} title={`Score ${difficulty.score}`}>Difficulty: {difficulty.label}</span>}
      </div>
      {findings.length === 0 ? (
        <p className="ap-note">No audio or speech problems detected: clear audio, steady pace, one speaker, nothing corrected.</p>
      ) : (
        grouped.map(([area, list]) => (
          <div key={area} className="ap-fgroup">
            <h3 className="ap-h3">{AREA[area]}</h3>
            {list.map((f) => (
              <div key={f.id} className={`ap-find ${f.severity}`}>
                <span className="sev">{SEVERITY[f.severity]}</span>
                <span className="txt"><b>{f.title}</b>{f.detail}</span>
              </div>
            ))}
          </div>
        ))
      )}
      {speech && (
        <details className="ap-fold">
          <summary>Measurements</summary>
          <div className="ap-meas">
            <div><span>Length</span><b>{Math.round(speech.duration_s)} s</b></div>
            <div><span>Pace</span><b>{speech.words_per_minute ? `${speech.words_per_minute} words/min` : '—'}</b></div>
            <div><span>Words heard</span><b>{speech.word_count}</b></div>
            <div><span>Recognition confidence</span><b>{speech.avg_confidence == null ? '—' : `${Math.round(speech.avg_confidence * 100)}%`}</b></div>
            <div><span>Filler words</span><b>{speech.filler_count}</b></div>
            <div><span>Pauses over 0.7 s</span><b>{speech.pause_count} (longest {speech.longest_pause_s} s)</b></div>
            <div><span>Voices detected</span><b>{speech.speakers}</b></div>
            <div><span>Interruptions</span><b>{speech.interruption_count ?? 0}</b></div>
            {signal && <div><span>Signal-to-noise</span><b>{Math.round(signal.snr_db)} dB</b></div>}
            {signal && <div><span>Noise floor</span><b>{signal.noise_floor_db} dB</b></div>}
            {match && <div><span>Match to the known script</span><b>{Math.round((1 - match.wer) * 100)}%</b></div>}
          </div>
          {!signal && <p className="ap-fine">Signal-level measurements (noise, bandwidth) need a WAV file; this recording was analyzed from the recognizer's output only.</p>}
        </details>
      )}
    </section>
  );
}

export default function CallAnalysisPanels({ analysis }) {
  if (!analysis) return null;
  return (
    <>
      <Understanding analysis={analysis} />
      <Findings analysis={analysis} />
    </>
  );
}
