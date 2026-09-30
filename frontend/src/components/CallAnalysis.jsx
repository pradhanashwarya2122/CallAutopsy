import '../styles/dashboard.css';

const pretty = (s) => String(s || '').replace(/_/g, ' ');
const SEVERITY = { issue: 'Problem', warn: 'Notice', info: 'Note' };
const AREA = { audio: 'Audio quality', speech: 'How they speak', conversation: 'Conversation', content: 'What was said' };
const ENTITY_LABEL = { order_ids: 'Order numbers', transaction_ids: 'Transaction IDs', amounts: 'Amounts', dates: 'Dates', other: 'Other' };
const CONDITION = { clean_wideband: 'Clean, full-bandwidth audio', acceptable: 'Acceptable audio', noisy: 'Noisy', band_limited: 'Limited bandwidth (phone-like or muffled)', clipped: 'Clipped', compressed: 'Compressed dynamics', degraded: 'Degraded (several problems)' };
const SOURCE = { acoustic: 'found from the audio itself', 'recognizer+acoustic': 'confirmed by the recognizer and the audio', recognizer: 'reported by the recognizer, not verified', single_voice: 'one consistent voice', unavailable: 'not available' };
const AROUSAL = { high: 'animated', medium: 'ordinary', low: 'subdued', unclear: 'no clear reading' };
const BOUNDARY = { simultaneous: 'talking at the same time', interruption: 'interruption', backchannel: 'short acknowledgement' };

// Who a numbered voice is. The customer is only named when the analysis identified them; the other voice is not called an agent.
export function voiceName(analysis, speaker) {
  const cs = analysis?.understanding?.customer_speaker;
  const two = (analysis?.attribution?.speakers ?? 1) > 1;
  if (!two) return 'Caller';
  if (cs === speaker) return 'Customer';
  if (cs === null || cs === undefined) return `Voice ${speaker + 1}`;
  return 'Other voice';
}

export function Turns({ analysis }) {
  const a = analysis;
  const turns = a?.turns || [];
  const two = (a?.attribution?.speakers ?? 1) > 1;
  const at = (t) => (t.start == null ? '' : `${t.start.toFixed(1)} s`);
  const between = (i) => (a.boundaries || []).find((b) => b.kind !== 'transition' && turns[i] && b.at === Math.round(turns[i].start * 100) / 100);
  return (
    <div className="ap-turns">
      {turns.map((t, i) => {
        const b = i > 0 ? between(i) : null;
        return (
          <div key={i}>
            {b && (b.kind === 'simultaneous' || b.kind === 'interruption') && (
              <p className={`ap-bound ${b.kind}`} title={b.evidence.join('; ')}>
                {BOUNDARY[b.kind]} at {b.at.toFixed(1)} s · confidence {Math.round(b.confidence * 100)}%
              </p>
            )}
            <div className={`ap-turn${t.uncertain ? ' unsure' : ''}`}>
              {two && <b>{voiceName(a, t.speaker)}{t.uncertain ? ' (?)' : ''}: </b>}
              {t.text}
              {at(t) && <em> {at(t)}</em>}
            </div>
          </div>
        );
      })}
      {(a?.background || []).map((b, i) => (
        <div key={`bg${i}`} className="ap-turn bg" title="Quiet speech that is not the caller or the agent">Background, not part of the call: “{b.text}”</div>
      ))}
    </div>
  );
}

function List({ items, tone }) {
  if (!items || !items.length) return null;
  return <ul className={`ap-list ${tone || ''}`}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}


const level = (l) => ({ low: 'low', medium: 'medium', high: 'high' }[l] || l);

// Words, voice and overall are three separate readings. The voice reading describes delivery (pace, pitch movement, pauses),
// never a diagnosis of feeling, and is withheld when the recording is too noisy to measure it.
function ToneBlock({ tone }) {
  const lex = tone.lexical;
  const v = tone.vocal;
  const o = tone.overall;
  return (
    <div className="ap-tone3">
      <div>
        <span className="k">From the words</span>
        <p className="ap-tone"><b>{lex ? pretty(lex.emotion === 'not_evident' ? 'no emotion evident' : lex.emotion) : 'not assessed'}</b>{lex && lex.emotion !== 'not_evident' && <span> ({lex.intensity})</span>}</p>
        {lex?.evidence && <p className="ap-note">“{lex.evidence}”</p>}
      </div>
      <div>
        <span className="k">From the voice</span>
        {v ? (
          <>
            <p className="ap-tone"><b>{AROUSAL[v.arousal]}</b>{v.arousal !== 'unclear' && <span> ({level(v.confidence)} confidence)</span>}</p>
            {v.cues.length > 0 && <p className="ap-note">{v.cues.join('; ')}</p>}
            <p className="ap-note">{v.reason}</p>
          </>
        ) : <p className="ap-note">The audio could not be measured (WAV input is needed).</p>}
      </div>
      <div>
        <span className="k">Overall</span>
        <p className="ap-tone"><b>{pretty(o.label)}</b><span> ({level(o.confidence)} confidence)</span></p>
        <p className="ap-note">{o.basis}</p>
      </div>
      <p className="ap-fine">A voice can show how animated or hesitant someone sounds; it cannot show whether they are pleased or upset. That comes from the words, and the two are never averaged into one claim.</p>
    </div>
  );
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
  const group = (obj) => Object.entries(obj || {}).filter(([, v]) => v && v.length);
  const entities = group(u.entities);
  const agentSaid = group(u.agent_stated);
  const unverified = group(u.unverified_speaker);
  const tone = analysis.tone;
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
          <h3 className="ap-h3">{analysis.attribution?.speakers > 1 && analysis.attribution?.reliable ? 'Details the customer gave' : 'Details heard'}</h3>
          {entities.length === 0 && <p className="ap-note">No order numbers, amounts or dates were given.</p>}
          {entities.map(([k, v]) => (
            <div key={k} className="ap-kv"><span>{ENTITY_LABEL[k] || k}</span><b>{v.join(', ')}</b></div>
          ))}
          {agentSaid.length > 0 && (
            <>
              <h3 className="ap-h3" style={{ marginTop: 12 }}>Said only by the other voice</h3>
              {agentSaid.map(([k, v]) => <div key={k} className="ap-kv"><span>{ENTITY_LABEL[k] || k}</span><b>{v.join(', ')}</b></div>)}
            </>
          )}
          {unverified.length > 0 && (
            <>
              <h3 className="ap-h3" style={{ marginTop: 12 }}>Heard, but who said it is unclear</h3>
              {unverified.map(([k, v]) => <div key={k} className="ap-kv"><span>{ENTITY_LABEL[k] || k}</span><b>{v.join(', ')}</b></div>)}
            </>
          )}
          {u.corrections.length > 0 && (
            <>
              <h3 className="ap-h3" style={{ marginTop: 12 }}>Corrections (the last value stands)</h3>
              {u.corrections.map((c, i) => (
                <div key={i} className="ap-corr"><span>{c.field || 'detail'}</span><s>{c.original}</s><i>→</i><b>{c.corrected}</b></div>
              ))}
            </>
          )}
          {u.dropped_unverified > 0 && <p className="ap-fine">{u.dropped_unverified} detail(s) proposed by the language model were not in the transcript and were removed.</p>}
        </div>
        <div>
          <h3 className="ap-h3">Tone, three separate readings</h3>
          {tone ? <ToneBlock tone={tone} /> : <p className="ap-note">Tone was not assessed.</p>}
        </div>
      </div>

      {u.established_facts.length > 0 && (<><h3 className="ap-h3">Established by the customer</h3><List items={u.established_facts} /></>)}
      {u.ambiguities.length > 0 && (<><h3 className="ap-h3">Unclear or conflicting</h3><List items={u.ambiguities} tone="warn" /></>)}
      {u.repetitions.length > 0 && (<><h3 className="ap-h3">Repeated</h3><List items={u.repetitions} /></>)}
      {u.late_information.length > 0 && (<><h3 className="ap-h3">Mentioned late</h3><List items={u.late_information} /></>)}
      {u.next_steps.length > 0 && (<><h3 className="ap-h3">Suggested next steps</h3><ol className="ap-list num">{u.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ol></>)}
      {u.off_topic_speech?.length > 0 && (<><h3 className="ap-h3">Words that are not part of the call</h3><List items={u.off_topic_speech.map((x) => `“${x}”`)} tone="warn" /></>)}
      {u.escalate && <p className="ap-msg err" role="alert">Flagged for escalation: signs of fraud, a legal threat or serious distress.</p>}
    </section>
  );
}

export function Findings({ analysis }) {
  if (!analysis) return null;
  const { findings = [], difficulty, speech, signal, script_match: match, attribution, voices = [], boundaries = [] } = analysis;
  const events = boundaries.filter((b) => b.kind === 'simultaneous' || b.kind === 'interruption');
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
            <div><span>Voices detected</span><b>{speech.speakers || 'unknown'}{attribution && speech.speakers ? ` (${SOURCE[attribution.source] || attribution.source})` : ''}</b></div>
            <div><span>Interruptions</span><b>{speech.interruption_count ?? 0}{analysis.overlap_visibility === 'limited' ? ' or more' : ''}</b></div>
            {signal && <div><span>Audio condition</span><b>{CONDITION[signal.condition?.label] || signal.condition?.label}</b></div>}
            {signal && <div><span>Signal-to-noise</span><b>{Math.round(signal.snr_db)} dB</b></div>}
            {signal && <div><span>Noise floor</span><b>{signal.noise_floor_db} dB</b></div>}
            {signal && <div><span>Bandwidth</span><b>{signal.band_limited ? 'limited' : 'full'}{signal.hf_ratio_db != null ? ` (${signal.hf_ratio_db} dB above 5 kHz)` : ''}</b></div>}
            {match && <div><span>Words matching the script</span><b>{Math.round((1 - match.wer) * 100)}% (exact wording {Math.round((1 - match.wer_strict) * 100)}%)</b></div>}
            {match && <div><span>Numbers heard exactly</span><b>{match.numbers_matched} of {match.numbers_expected}</b></div>}
          </div>
          {voices.map((v) => (
            <p key={v.speaker} className="ap-fine"><b>{voiceName(analysis, v.speaker)}:</b> {v.measurements.pitch_hz ? `pitch about ${v.measurements.pitch_hz} Hz, ` : ''}{v.measurements.articulation_wpm ? `${v.measurements.articulation_wpm} words/min while speaking, ` : ''}{Math.round(v.measurements.pause_ratio * 100)}% of the time in pauses{v.measurements.filler_count ? `, ${v.measurements.filler_count} filler words` : ''}.</p>
          ))}
          {events.length > 0 && (
            <>
              <h3 className="ap-h3" style={{ marginTop: 10 }}>Interruption evidence</h3>
              {events.map((b, i) => <p key={i} className="ap-fine"><b>{BOUNDARY[b.kind]} at {b.at.toFixed(1)} s</b> (confidence {Math.round(b.confidence * 100)}%): {b.evidence.join('; ')}.</p>)}
            </>
          )}
          {attribution?.notes?.length > 0 && attribution.notes.map((n, i) => <p key={i} className="ap-fine">{n}</p>)}
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
