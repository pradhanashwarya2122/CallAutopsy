import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AB, CONFUSION, DETECTORS, FACTS, LIMITS, RUNS } from '../lib/landingData.js';

// Landing page. Every figure comes from lib/landingData.js and was measured on the real pipeline; nothing here is invented.
// Every call to action routes to /app.

const NAV = [
  { id: 'detection', label: 'Detection' },
  { id: 'real-run', label: 'A real run' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'compare', label: 'Compare' },
  { id: 'analysis', label: 'Analysis' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
.lp{--paper:#F8F5EF;--tan:#f3ecdc;--line:#e3d9c7;--ink:#141210;--mut:#6b6357;--red:#d0161c;--ok:#2f6b4f;font-family:'Newsreader',Georgia,serif;font-size:18px;line-height:1.5;color:var(--ink);background:var(--paper);min-height:100vh;-webkit-font-smoothing:antialiased}
.lp *{box-sizing:border-box}
.lp .mono{font-family:'IBM Plex Mono',ui-monospace,monospace}
.lp a:focus-visible,.lp button:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.lp .nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:24px;height:60px;padding:0 clamp(16px,4vw,56px);background:rgba(248,245,239,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.lp .brand{display:flex;align-items:baseline;gap:14px;background:none;border:0;padding:0;cursor:pointer;color:var(--ink);font-family:inherit}
.lp .brand b{font-size:23px;font-weight:700;letter-spacing:-.02em}
.lp .brand span{font:11px 'IBM Plex Mono',monospace;color:var(--red);letter-spacing:.05em}
.lp .links{display:flex;align-items:center;gap:26px}
.lp .links a{font-size:17px;color:var(--ink);text-decoration:none;border-bottom:2px solid transparent;padding:4px 0}
.lp .links a:hover,.lp .links a.on{color:var(--red);border-color:var(--red)}
.lp .cta{font:inherit;font-size:17px;padding:10px 22px;background:#0d0c0b;color:#fff;border:1px solid #0d0c0b;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:background .15s}
.lp .cta:hover{background:var(--red);border-color:var(--red)}
.lp .cta.ghost{background:transparent;color:var(--ink);border-color:var(--ink)}
.lp .cta.ghost:hover{background:var(--ink);color:#fff}
.lp .sec{padding:84px clamp(16px,6vw,96px);scroll-margin-top:60px}
.lp .sec.alt{background:var(--tan)}
.lp .lab{font:12.5px 'IBM Plex Mono',monospace;color:var(--red);margin:0 0 14px;letter-spacing:.05em;text-transform:uppercase}
.lp h2{font-size:clamp(32px,4.2vw,54px);font-weight:600;letter-spacing:-.035em;line-height:1.05;margin:0 0 16px;max-width:16em;text-wrap:balance}
.lp .lede{font-size:20px;color:#4a443b;max-width:38em;margin:0 0 40px}
.lp .note{font:13px/1.55 'IBM Plex Mono',monospace;color:var(--mut);max-width:60em;margin:18px 0 0}
.lp .tag{display:inline-block;font:11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);border:1px solid var(--line);padding:2px 8px;background:var(--paper)}

/* hero */
.lp .hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,470px);gap:56px;align-items:center;padding:64px clamp(16px,6vw,96px) 72px;min-height:min(80vh,780px)}
.lp .hero h1{font-size:clamp(42px,5vw,74px);font-weight:600;letter-spacing:-.045em;line-height:.98;margin:0 0 26px;text-wrap:balance}
.lp .hero h1 em{font-style:italic;font-weight:400;color:var(--red);letter-spacing:-.03em}
.lp .hero .sub{font-size:21px;color:#4a443b;max-width:31em;margin:0 0 30px}
.lp .btns{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:38px}
.lp .facts{display:flex;flex-wrap:wrap;row-gap:14px}
.lp .facts div{padding:0 22px;border-left:1px solid var(--ink)}
.lp .facts div:first-child{padding-left:0;border-left:0}
.lp .facts b{display:block;font-size:30px;letter-spacing:-.02em}
.lp .facts span{font:11.5px 'IBM Plex Mono',monospace;color:var(--mut)}

/* case card (the recorded run) */
.lp .case{background:#fdfbf6;border:1px solid #cfc3aa;box-shadow:0 26px 44px -30px rgba(60,45,20,.6);font-family:'IBM Plex Mono',monospace}
.lp .case.bad{border-color:#d9a9a4}
.lp .ch{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;border-bottom:3px double #cfc3aa;font-size:11.5px}
.lp .ch .st{font-size:10.5px;letter-spacing:.06em;color:var(--ok)}
.lp .ch .st.bad{color:var(--red)}
.lp .cb{padding:16px}
.lp .tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.lp .tabs button{font:12px 'IBM Plex Mono',monospace;padding:6px 12px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer}
.lp .tabs button[aria-pressed=true]{background:var(--ink);color:#fff}
.lp .tabs button:hover:not([aria-pressed=true]){background:var(--tan)}
.lp .tk{display:grid;grid-template-columns:34px 1fr 62px;gap:10px;align-items:center;min-height:30px;font-size:12px}
.lp .tk .tn,.lp .tk .ts{color:var(--mut)}.lp .tk .ts{text-align:right}
.lp .tk.timeout .ts{color:var(--red)}
.lp .tb{position:relative;height:14px;background:repeating-linear-gradient(90deg,#d8cdb6 0 1px,transparent 1px 25%),var(--tan)}
.lp .tb i{position:absolute;top:0;bottom:0;background:var(--ok);transform-origin:left;animation:grow .9s cubic-bezier(.2,.7,.2,1) both;animation-delay:var(--dl,0s)}
.lp .tk.timeout .tb i{background:repeating-linear-gradient(45deg,var(--red) 0 3px,#fce4e0 3px 7px)}
.lp .tk.timeout .tb i:after{content:'';position:absolute;right:-1px;top:-3px;bottom:-3px;width:2px;background:var(--red)}
@keyframes grow{from{transform:scaleX(0)}}
.lp .sla{position:absolute;top:-4px;bottom:-4px;width:0;border-left:1px dashed var(--red)}
.lp .axis{display:grid;grid-template-columns:34px 1fr 62px;gap:10px;font-size:10px;color:#8a7350;margin-top:2px}
.lp .axis div{position:relative;height:14px}.lp .axis em{position:absolute;font-style:normal}
.lp .ev{margin-top:14px;padding-top:10px;border-top:1px solid var(--line)}
.lp .ev h6,.lp .vd small{margin:0 0 4px;font:400 10px 'IBM Plex Mono',monospace;color:#8a7350;letter-spacing:.08em;text-transform:uppercase;display:block}
.lp .ev p{display:flex;gap:8px;margin:0;padding:4px 0;border-bottom:1px dashed var(--line);font-size:12px;line-height:1.4;color:#3b352d}
.lp .ev p b{flex:none;font-weight:500;color:var(--red)}
.lp .vd{margin-top:12px;padding:10px 12px;background:#eef3ee;border:1px solid #cddccd}
.lp .case.bad .vd{background:#fce4e0;border-color:#f3c3bc}
.lp .vd b{display:block;font-size:20px;font-weight:600;color:var(--ok);margin:2px 0 6px}
.lp .case.bad .vd b{color:#B5261C}
.lp .lf{display:flex;align-items:baseline;font-size:12px;line-height:1.7}.lp .lf i{flex:1;border-bottom:1px dotted #b8ad97;margin:0 6px}.lp .lf b{display:inline;font-size:12px;margin:0;font-weight:500;color:inherit}
.lp .cfoot{padding:8px 16px;border-top:1px solid var(--line);font-size:10.5px;color:#8a7350;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}

/* tables */
.lp .tbl{width:100%;border-collapse:collapse;font-size:16px}
.lp .tbl th{font:11.5px 'IBM Plex Mono',monospace;text-align:left;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:400;padding:10px 14px 10px 0;border-bottom:1px solid var(--ink)}
.lp .tbl td{padding:12px 14px 12px 0;border-bottom:1px solid var(--line);vertical-align:top}
.lp .tbl td.k{font:13px 'IBM Plex Mono',monospace;white-space:nowrap}
.lp .tbl td.n{font:13px 'IBM Plex Mono',monospace;color:var(--mut);width:36px}
.lp .tbl .miss{color:var(--red)}
.lp .tbl .hit{color:var(--ok)}
.lp .scroll{overflow-x:auto}

/* grids */
.lp .two{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start}
.lp .lim{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink);margin-top:40px}
.lp .lim div{padding:16px 22px 18px 0;margin-right:22px;border-bottom:1px solid var(--line)}
.lp .lim h3{font-size:19px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}
.lp .lim p{font-size:16px;margin:0;color:#4a443b}
.lp .verd{border:1px solid var(--ink);background:#fbf9f4;padding:18px 22px;margin-bottom:28px}
.lp .verd small{font:11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--red)}
.lp .verd p{font-size:24px;font-weight:600;letter-spacing:-.02em;margin:4px 0 0}
.lp .ab td.c{font:13px 'IBM Plex Mono',monospace;white-space:nowrap}
.lp .ab td.w{font-weight:600;color:var(--ok)}
.lp .rules{margin:0;padding-left:20px;font-size:16px;color:#3b352d}
.lp .rules li{margin-bottom:8px}
.lp .stat{border-top:1px solid var(--ink);padding-top:12px;margin-bottom:22px}
.lp .stat b{display:block;font-size:34px;letter-spacing:-.025em;line-height:1.1}
.lp .stat b s{text-decoration:none;color:var(--mut);font-size:22px}
.lp .stat span{font-size:15.5px;color:#4a443b}
.lp .read{border:1px solid var(--line);background:#fdfbf6;padding:6px 18px;font:13px 'IBM Plex Mono',monospace}
.lp .read div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px dashed var(--line)}
.lp .read div:last-child{border:0}
.lp .read span{color:var(--mut)}

.lp .band{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:52px clamp(16px,6vw,96px);background:var(--red);color:#fff}
.lp .band p{font-size:clamp(26px,3.4vw,40px);font-weight:700;letter-spacing:-.025em;margin:0;max-width:20em}
.lp .band .cta{background:#fff;color:#0d0c0b;border-color:#fff}.lp .band .cta:hover{background:#0d0c0b;color:#fff}
.lp .foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:20px clamp(16px,6vw,96px);font:13px 'IBM Plex Mono',monospace;color:var(--mut)}

.lp [data-rv]{opacity:0;transform:translateY(20px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}
.lp [data-rv].in{opacity:1;transform:none}

@media(max-width:1000px){.lp .hero{grid-template-columns:1fr;gap:40px}.lp .two{grid-template-columns:1fr;gap:40px}.lp .lim{grid-template-columns:1fr 1fr}.lp .brand span{display:none}}
@media(max-width:760px){.lp .links a{display:none}.lp .sec{padding:60px 20px}.lp .lim{grid-template-columns:1fr}.lp .lim div{margin-right:0}}
@media(prefers-reduced-motion:reduce){.lp *{animation:none!important;transition:none!important}.lp [data-rv]{opacity:1;transform:none}}
`;

const money = (v) => '$' + v.toFixed(6);
const secs = (v) => v.toFixed(3) + 's';
const pct = (v) => Math.round(v * 100) + '%';

/* One recorded run: a timeline of the three stages, the evidence, the verdict and the cost. */
function RunCard({ initial = 'timeout', compact = false }) {
  const [key, setKey] = useState(initial);
  const r = RUNS[key];
  const bad = r.category !== 'ok';
  const ticks = [0, 0.25, 0.5, 0.75].map((f) => Math.round(f * r.span));
  const llmSla = 8; // LLM limit in seconds, measured from the LLM stage start
  const llm = r.stages.find((s) => s.id === 'llm');
  return (
    <aside className={`case ${bad ? 'bad' : ''}`} aria-label={`Recorded run: ${r.label}`}>
      <div className="ch">
        <b style={{ fontWeight: 500 }}>Recorded run</b>
        <span className={`st ${bad ? 'bad' : ''}`}>{bad ? 'FAILED' : 'COMPLETED'}</span>
      </div>
      <div className="cb">
        <div className="tabs" role="group" aria-label="Choose a recorded run">
          {Object.entries(RUNS).map(([k, v]) => (
            <button key={k} aria-pressed={k === key} onClick={() => setKey(k)}>{v.label}</button>
          ))}
        </div>
        <div key={key}>
          {r.stages.map((s, j) => (
            <div key={s.id} className={`tk ${s.status}`}>
              <span className="tn">{s.name}</span>
              <div className="tb">
                <i style={{ left: `${(s.start / r.span) * 100}%`, width: `${((s.end - s.start) / r.span) * 100}%`, '--dl': `${j * 0.35}s` }} />
                {s.id === 'llm' && bad && <span className="sla" style={{ left: `${((llm.start + llmSla) / r.span) * 100}%` }} title="LLM limit (8 s)" />}
              </div>
              <span className="ts">{secs(s.end - s.start)}</span>
            </div>
          ))}
          <div className="axis"><span /><div>{ticks.map((t, i) => <em key={i} style={{ left: `${(t / r.span) * 100}%` }}>{t}s</em>)}</div><span /></div>
        </div>
        {!compact && (
          <div className="ev">
            <h6>Evidence</h6>
            {r.evidence.map((e, i) => <p key={e}><b>E{i + 1}</b>{e}</p>)}
          </div>
        )}
        <div className="vd">
          <small>Diagnosis</small>
          <b>{r.verdict}</b>
          <div className="lf"><span>Rule result</span><i /><b>{r.reason}</b></div>
          <div className="lf"><span>Rule confidence</span><i /><b>{r.confidence.toFixed(2)}</b></div>
          <div className="lf"><span>Total cost</span><i /><b>{money(r.total)}</b></div>
        </div>
      </div>
      <div className="cfoot"><span>{r.fault ? `injected fault: ${r.fault}` : 'no fault injected'}</span><span>measured 30 Sep 2026</span></div>
    </aside>
  );
}

function Hero({ enter }) {
  return (
    <section className="hero" id="top">
      <div>
        <h1>Your voice agent failed. <em>Find out exactly why.</em></h1>
        <p className="sub">
          CallAutopsy sends a call through speech-to-text, the language model and text-to-speech with a fault injected, or reads a call you upload.
          It names the stage that broke, shows the evidence and reports what the call cost.
        </p>
        <div className="btns">
          <button className="cta" onClick={enter}>Run an autopsy →</button>
          <a className="cta ghost" href="#real-run">See a real one</a>
        </div>
        <div className="facts">
          <div><b>7</b><span>injectable faults</span></div>
          <div><b>18 / 18</b><span>rule-based faults diagnosed</span></div>
          <div><b>{money(RUNS.clean.total).slice(0, 7)}</b><span>measured cost, one call</span></div>
        </div>
      </div>
      <RunCard initial="timeout" compact />
    </section>
  );
}

function Detection() {
  return (
    <section className="sec alt" id="detection">
      <p className="lab" data-rv>How it decides</p>
      <h2 data-rv>Seven detectors, checked in a fixed order.</h2>
      <p className="lede" data-rv>
        The first detector that fires names the cause, so a call gets one primary diagnosis. The order matters: a reply that is too slow is called a timeout before anything else can be blamed.
      </p>
      <div className="scroll" data-rv>
        <table className="tbl">
          <thead><tr><th>#</th><th>Cause</th><th>What triggers it</th><th>Decided by</th><th>Confidence</th></tr></thead>
          <tbody>
            {DETECTORS.map((d, i) => (
              <tr key={d.k}>
                <td className="n">{i + 1}</td>
                <td className="k">{d.k}</td>
                <td>{d.signal}</td>
                <td className="k">{d.by}</td>
                <td className="k">{d.conf.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" data-rv>
        Confidence is the fixed value of the rule that fired, not a probability. Only the hallucination check uses a second model; every other detector is arithmetic on measured times, confidences and signals.
        A call that trips none of them is reported as healthy.
      </p>
    </section>
  );
}

function RealRun() {
  return (
    <section className="sec" id="real-run">
      <p className="lab" data-rv>One call, end to end</p>
      <h2 data-rv>The same call, healthy and with a timeout injected.</h2>
      <p className="lede" data-rv>
        Both runs use the same recording: a caller reporting a duplicate charge. The only difference is the fault. Switch between them and compare the stage times, the evidence and the cost.
      </p>
      <div className="two">
        <div data-rv><RunCard initial="timeout" /></div>
        <div data-rv>
          <p className="lab">What to notice</p>
          <div className="stat"><b>13.350s <s>vs 1.435s</s></b><span>the LLM stage with the fault and without it</span></div>
          <div className="stat"><b>$0.003960 <s>vs $0.003611</s></b><span>total cost with the fault and without it. The failed call still cost money.</span></div>
          <div className="stat"><b>14.6s</b><span>when the late reply reached text-to-speech. TTS still ran and succeeded, so the failure shows only in the timings.</span></div>
          <p className="note">
            Each call also runs a parallel analysis of the audio ({RUNS.timeout.analysis.seconds.toFixed(3)}s, {money(RUNS.timeout.analysis.cost)}). It is included in the total but is not part of the call's pipeline time.
          </p>
        </div>
      </div>
    </section>
  );
}

function Accuracy() {
  return (
    <section className="sec alt" id="accuracy">
      <p className="lab" data-rv>Measured accuracy</p>
      <h2 data-rv>18 of 18 for the rule-based faults. 0 of 3 for hallucination.</h2>
      <p className="lede" data-rv>
        Each fault was injected into three different calls through the live pipeline, and the diagnosis was compared with the fault that was injected.
      </p>
      <div className="scroll" data-rv>
        <table className="tbl">
          <thead><tr><th>Injected</th><th>Call 1</th><th>Call 2</th><th>Call 3</th></tr></thead>
          <tbody>
            {CONFUSION.map((row) => (
              <tr key={row.k}>
                <td className="k">{row.k}</td>
                {row.got.map((g, i) => <td key={i} className={`k ${g === row.k ? 'hit' : 'miss'}`}>{g === row.k ? '✓ ' : '✕ '}{g}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" data-rv>Injected faults and calibration control calls are the only calls that can be scored, because only they have a known right answer. Real production calls have none.</p>
      <div className="lim" data-rv>
        {LIMITS.map(([t, d]) => <div key={t}><h3>{t}</h3><p>{d}</p></div>)}
      </div>
    </section>
  );
}

function Compare() {
  return (
    <section className="sec" id="compare">
      <p className="lab" data-rv>Compare two stacks</p>
      <h2 data-rv>A winner only when the gap is real.</h2>
      <p className="lede" data-rv>
        A live comparison on the same call, {AB.runs} runs per side: {AB.a.stack} against {AB.b.stack}.
      </p>
      <div className="two">
        <div data-rv>
          <div className="verd"><small>Verdict</small><p>{AB.headline}</p></div>
          <div className="scroll">
            <table className="tbl ab">
              <thead><tr><th>Measure</th><th>A</th><th>B</th><th>Counts?</th></tr></thead>
              <tbody>
                {AB.rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}<div className="note" style={{ margin: '4px 0 0' }}>{r.why}</div></td>
                    <td className={`c ${r.counts === 'A' ? 'w' : ''}`}>{r.a}</td>
                    <td className={`c ${r.counts === 'B' ? 'w' : ''}`}>{r.b}</td>
                    <td className="c">{r.counts ? `Yes, ${r.counts} wins` : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Config B failed one of its three calls with a timeout. The rules did not count that, because one failure in three is smaller than the required gap. It also means three runs is too few to trust the speed and cost result for anything but a quick check.</p>
        </div>
        <div data-rv>
          <p className="lab">The rules the verdict follows</p>
          <ol className="rules">{AB.rules.map((r) => <li key={r}>{r}</li>)}</ol>
        </div>
      </div>
    </section>
  );
}

function Analysis() {
  const a = FACTS.analysisCall;
  return (
    <section className="sec alt" id="analysis">
      <p className="lab" data-rv>What it reads from a call</p>
      <h2 data-rv>Beyond the fault: who spoke, how it sounded, what was said.</h2>
      <p className="lede" data-rv>Every call, including one you upload, gets an audio analysis that does not depend on a failure.</p>
      <div className="two">
        <div data-rv>
          <div className="stat"><b>{FACTS.speakers[0]} <s>vs {FACTS.speakers[1]}</s></b><span>calls with the speaker count right, CallAutopsy against the speech recogniser alone</span></div>
          <div className="stat"><b>{FACTS.wordSpeaker[0]} <s>vs {FACTS.wordSpeaker[1]}</s></b><span>word-level speaker accuracy on the four two-voice calls. Tuned on those same calls, so read it as a ceiling.</span></div>
          <div className="stat"><b>{FACTS.interruptions}</b><span>scripted interruptions found, with no false alarms. Mono audio hides most overlap, so the count is a lower bound.</span></div>
          <div className="stat"><b>{FACTS.audioQuality}</b><span>labelled recording conditions identified (in-sample).</span></div>
        </div>
        <div data-rv>
          <p className="lab">The clean call, as analysed</p>
          <div className="read">
            <div><span>Speakers</span><b>{a.speakers}</b></div>
            <div><span>Words · pace</span><b>{a.words} · {a.wpm} wpm</b></div>
            <div><span>Signal-to-noise · condition</span><b>{a.snr} dB · {a.condition}</b></div>
            <div><span>Overlap</span><b>{a.overlap}s</b></div>
            <div><span>Finding</span><b style={{ textAlign: 'right', fontWeight: 400 }}>{a.finding}</b></div>
            <div><span>Delivery</span><b style={{ textAlign: 'right', fontWeight: 400 }}>{a.tone}</b></div>
          </div>
          <p className="note">The delivery reading describes how the voice sounds, not how the caller feels. The demo calls use synthetic voices with scripted delivery styles.</p>
        </div>
      </div>
    </section>
  );
}

export default function LandingHome() {
  const nav = useNavigate();
  const root = useRef(null);
  const [active, setActive] = useState('');

  useEffect(() => {
    const el = root.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const items = [...el.querySelectorAll('[data-rv]')];
    if (reduce || !('IntersectionObserver' in window)) { items.forEach((n) => n.classList.add('in')); }
    const rv = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rv.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    if (!reduce) items.forEach((n) => rv.observe(n));
    const so = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: '-40% 0px -55% 0px' });
    NAV.forEach((n) => { const t = document.getElementById(n.id); if (t) so.observe(t); });
    return () => { rv.disconnect(); so.disconnect(); };
  }, []);

  const enter = () => nav('/app');
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="lp" ref={root}>
      <style>{CSS}</style>
      <header className="nav">
        <button className="brand" onClick={top} aria-label="CallAutopsy, back to top">
          <b>CallAutopsy</b>
          <span>Find the failing stage. See what it cost.</span>
        </button>
        <nav className="links" aria-label="Sections">
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`} className={active === n.id ? 'on' : ''}>{n.label}</a>)}
          <button className="cta" onClick={enter}>Run an autopsy →</button>
        </nav>
      </header>

      <Hero enter={enter} />
      <Detection />
      <RealRun />
      <Accuracy />
      <Compare />
      <Analysis />

      <section className="band">
        <p>Run it on a call of your own.</p>
        <button className="cta" onClick={enter}>Run an autopsy →</button>
      </section>
      <footer className="foot">
        <span>CallAutopsy</span>
        <span>Figures are measurements from the live pipeline, dated 30 Sep 2026</span>
      </footer>
    </div>
  );
}
