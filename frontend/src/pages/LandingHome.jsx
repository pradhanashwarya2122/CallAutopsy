import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Standalone landing page. The dashboard is NOT rendered here.
// Visitors reach it via the nav CTA, the section CTAs, or the buttons
// inside the landing.html iframe (which top-navigate to /app).

const NAV = [
  { id: 'product', label: 'Product' },
  { id: 'use-cases', label: 'Use Cases' },
  { id: 'case-studies', label: 'Case Studies' },
];

const PRODUCT = [
  { t: 'Diagnose', d: 'Inject a fault (bad STT, hallucination, timeout, TTS glitch, network drop) and see which stage of the voice pipeline died.' },
  { t: 'Debug', d: 'Per-call detail, failed-stage timeline and latency percentiles show where a call broke and how slow the survivors were.' },
  { t: 'Reduce costs', d: 'Run the same fault through two configs and compare real cost and failure rate side by side before you ship a change.' },
];

const USE_CASES = [
  { t: 'STT bake-off', d: 'Deepgram vs Whisper on the same clip, under the same fault.' },
  { t: 'LLM cost vs quality', d: 'gpt-4o-mini vs gpt-4o head to head, with failure rate next to cost per call.' },
  { t: 'Regression check', d: 'Re-run a saved scenario after a config change and confirm nothing got worse.' },
  { t: 'Resilience testing', d: 'Find out which fault your bot handles worst before your callers do.' },
];

const STUDIES = [
  { tag: 'Walkthrough', t: 'Fast and cheap vs premium', d: 'Deepgram with gpt-4o-mini against Whisper with gpt-4o. Run 10 calls per side, read the verdict, decide if the premium stack earns its price.' },
  { tag: 'Walkthrough', t: 'Hallucination under load', d: 'Force fabricated answers on both configs and compare how often each one fails, and at what cost per call.' },
  { tag: 'Walkthrough', t: 'Timeout autopsy', d: 'Delay a stage past its deadline and use the cause-of-death timeline to see which stage gave out first.' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
.lp{--paper:#F8F5EF;--line:#e3d9c7;--ink:#141210;--mut:#6b6357;--red:#d0161c;font-family:'Newsreader',Georgia,serif;color:var(--ink);background:var(--paper);min-height:100vh}
.lp *{box-sizing:border-box}
.lp .mono{font-family:'IBM Plex Mono',ui-monospace,monospace}
.lp .nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:24px;height:64px;padding:0 clamp(16px,3vw,48px);background:rgba(248,245,239,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.lp .brand{display:flex;align-items:baseline;gap:16px;background:none;border:0;padding:0;cursor:pointer;color:var(--ink);font-family:inherit;text-align:left}
.lp .brand b{font-size:24px;font-weight:700;letter-spacing:-.02em}
.lp .brand span{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--red);white-space:nowrap}
.lp .links{display:flex;align-items:center;gap:28px}
.lp .links a{font-size:17px;color:var(--ink);text-decoration:none;padding:4px 0;border-bottom:2px solid transparent;transition:border-color .15s,color .15s}
.lp .links a:hover{color:var(--red);border-color:var(--red)}
.lp .cta{font-family:'Newsreader',serif;font-size:17px;padding:9px 20px;background:#0d0c0b;color:#fff;border:0;border-radius:3px;cursor:pointer;transition:background .15s,transform .1s}
.lp .cta:hover{background:var(--red)}
.lp .cta:active{transform:scale(.985)}
.lp .cta.ghost{background:transparent;color:var(--ink);border:1px solid var(--ink)}
.lp .cta.ghost:hover{background:var(--ink);color:#fff}
.lp a:focus-visible,.lp button:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.lp .sec{padding:72px clamp(16px,6vw,96px);border-top:1px solid var(--line);scroll-margin-top:64px}
.lp .sec.alt{background:#f3ecdc}
.lp .eyebrow{font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--red);margin:0 0 10px}
.lp h2{font-size:clamp(32px,4vw,46px);font-weight:700;letter-spacing:-.03em;line-height:1.08;margin:0 0 12px}
.lp .lede{font-size:20px;color:#3b352d;max-width:640px;margin:0 0 36px;line-height:1.4}
.lp .grid{display:grid;gap:14px}
.lp .g3{grid-template-columns:repeat(3,1fr)}
.lp .g4{grid-template-columns:repeat(4,1fr)}
.lp .card{background:#fbf7ee;border:1px solid var(--line);padding:20px 22px;box-shadow:0 1px 2px rgba(70,50,15,.06),0 10px 24px -16px rgba(70,50,15,.35)}
.lp .card h3{font-size:24px;font-weight:600;letter-spacing:-.01em;margin:0 0 8px}
.lp .card p{font-size:17px;line-height:1.45;color:#4a443b;margin:0}
.lp .card .tag{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--red);margin:0 0 10px}
.lp .num{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--red);margin:0 0 10px}
.lp .band{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:40px clamp(16px,6vw,96px);background:#0d0c0b;color:#fff}
.lp .band p{font-size:28px;font-weight:600;letter-spacing:-.02em;margin:0}
.lp .band .cta{background:#fff;color:#0d0c0b}
.lp .band .cta:hover{background:var(--red);color:#fff}
.lp .foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:20px clamp(16px,6vw,96px);font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.04em;color:var(--mut);border-top:1px solid var(--line)}
@media(max-width:1100px){.lp .brand span{display:none}.lp .g4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){.lp .links{display:none}.lp .g3,.lp .g4{grid-template-columns:1fr}.lp .sec{padding:48px 20px}}
@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}

/* ---- feature tiles (moved out of iframe, native) ---- */
.lp .features{padding:56px clamp(16px,6vw,96px);border-top:1px solid var(--line);background:var(--paper)}
.lp .features .row{display:grid;grid-template-columns:repeat(4,1fr);gap:0;align-items:start}
.lp .features .col{padding:0 26px;border-left:1px solid var(--line);display:flex;gap:16px}
.lp .features .col:first-child{border-left:0;padding-left:0}
.lp .features .ico{flex:none;width:44px;height:44px;border-radius:8px;border:1px solid #eab8b4;background:#f8ded9;color:var(--red);display:grid;place-items:center}
.lp .features .col h3{font-family:'Newsreader',serif;font-size:22px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px}
.lp .features .col p{font-size:14.5px;line-height:1.5;color:#4a443b;margin:0}
@media(max-width:1100px){.lp .features .row{grid-template-columns:repeat(2,1fr);gap:32px 0}.lp .features .col{border-left:0;padding:0}}
@media(max-width:640px){.lp .features .row{grid-template-columns:1fr}}

/* ---- how-it-works ---- */
.lp .how{padding:72px clamp(16px,6vw,96px);border-top:1px solid var(--line);display:grid;grid-template-columns:1.05fr 1fr;gap:56px;align-items:start;background:#faf6ea}
@media(max-width:1100px){.lp .how{grid-template-columns:1fr;gap:40px}}
.lp .how h2{font-size:clamp(30px,3.4vw,42px);margin:6px 0 10px}
.lp .how .subtitle{font-size:17px;color:#4a443b;margin:0 0 32px;max-width:520px}
.lp .steps{display:grid;grid-template-columns:repeat(2,1fr);gap:26px 20px}
.lp .step{display:flex;gap:14px}
.lp .step .n{flex:none;width:34px;height:34px;border-radius:50%;background:#8F1414;color:#fff;display:grid;place-items:center;font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:14px;letter-spacing:.02em}
.lp .step .n.dark{background:#1a1815}
.lp .step h4{font-family:'Newsreader',serif;font-size:19px;font-weight:600;margin:5px 0 4px;letter-spacing:-.01em}
.lp .step p{font-size:14px;color:#4a443b;margin:0;line-height:1.5}

/* ---- example autopsy card ---- */
.lp .autopsy{background:#fbf9f4;border:1px solid #E2DDD1;border-radius:10px;padding:22px 24px;box-shadow:0 20px 40px -24px rgba(60,45,20,.35)}
.lp .autopsy .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.lp .autopsy .head h3{font-family:'Newsreader',serif;font-weight:600;font-size:24px;letter-spacing:-.01em;margin:0}
.lp .autopsy .head a{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.1em;color:var(--red);text-decoration:none}
.lp .autopsy .ts{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a7350;margin:0 0 14px}
.lp .autopsy .cod{display:grid;grid-template-columns:auto 1fr auto auto;gap:12px;align-items:center;background:#fce4e0;border:1px solid #f3c3bc;border-radius:8px;padding:12px 14px;margin-bottom:14px}
.lp .autopsy .cod .icon{flex:none;width:30px;height:30px;border-radius:5px;background:#E5493E;color:#fff;display:grid;place-items:center}
.lp .autopsy .cod .msg small{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;color:#a12a26;margin-bottom:2px}
.lp .autopsy .cod .msg b{display:block;font-family:'IBM Plex Mono',monospace;font-weight:600;color:#B5261C;font-size:14px;letter-spacing:-.01em;margin-bottom:2px}
.lp .autopsy .cod .msg span{display:block;font-size:11.5px;line-height:1.4;color:#7d2419;max-width:260px}
.lp .autopsy .cod .pill{border-left:1px solid rgba(226,55,43,.22);padding-left:14px;text-align:right}
.lp .autopsy .cod .pill small{display:block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.06em;color:#a12a26;margin-bottom:2px;text-transform:uppercase}
.lp .autopsy .cod .pill b{font-family:'IBM Plex Mono',monospace;font-weight:600;color:#B5261C;font-size:16px}
.lp .autopsy .stages{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid #EFE9DA;border-radius:6px;margin-bottom:14px}
.lp .autopsy .stages > div{padding:9px 12px;border-left:1px solid #EFE9DA}
.lp .autopsy .stages > div:first-child{border-left:0}
.lp .autopsy .stages small{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a7350;letter-spacing:.06em;text-transform:uppercase}
.lp .autopsy .stages b{display:block;font-size:13px;margin-top:2px}
.lp .autopsy .stages span{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#4a443b}
.lp .autopsy .tabs{display:flex;gap:14px;border-bottom:1px solid #EFE9DA;padding-bottom:6px;margin-bottom:12px}
.lp .autopsy .tabs span{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a7350;letter-spacing:.06em}
.lp .autopsy .tabs span.on{color:var(--ink);font-weight:600;border-bottom:2px solid var(--ink);padding-bottom:6px;margin-bottom:-7px}
.lp .autopsy .pair{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:stretch}
.lp .autopsy .pair .arrow{align-self:center;color:#8a7350}
.lp .autopsy .clip{border:1px solid #EFE9DA;border-radius:6px;padding:10px 12px;background:#f4f0e5}
.lp .autopsy .clip.hall{background:#fce4e0;border-color:#f3c3bc}
.lp .autopsy .clip .lbl{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a7350;letter-spacing:.05em;margin:0 0 6px}
.lp .autopsy .clip.hall .lbl{color:#a12a26}
.lp .autopsy .clip .quote{font-size:12px;line-height:1.5;color:#4a443b;margin:6px 0 0}
.lp .autopsy .clip.hall .quote{color:#7d2419}
.lp .autopsy .bars{display:flex;gap:2px;align-items:center;height:30px}
.lp .autopsy .bars i{flex:1;background:#8a7350;border-radius:1px}
.lp .autopsy .clip.hall .bars i{background:#c0301f}
`;

/* ---- inline SVG icon components ---- */
const TriIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.1" /></svg>
);
const DocIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></svg>
);
const ClipIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 11h6M9 15h6" /></svg>
);
const DolIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M14.5 9c-.5-1-1.5-1.5-2.5-1.5S9.5 8.3 9.5 9.5c0 3 5.5 1.5 5.5 4.5 0 1.2-1 2-2.5 2-1.2 0-2.2-.6-2.7-1.6M12 6v1.5M12 16.5V18" /></svg>
);
const RightArrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

const FEATURES = [
  { icon: TriIcon,  t: '7 Realistic Failure Types',  d: 'bad_stt, hallucination, tts_glitch, timeout, user_hangup, network_drop, exception' },
  { icon: DocIcon,  t: 'Automatic Classification',   d: 'Identify root cause across STT, LLM, and TTS with high accuracy.' },
  { icon: ClipIcon, t: 'Detailed Autopsy Reports',   d: 'Human-readable, technical reports with evidence, transcripts, and timelines.' },
  { icon: DolIcon,  t: 'Real Dollar Cost Tracking',  d: 'See the true cost of every failure and reduce wasted spend.' },
];

const STEPS = [
  { n: '01', t: 'Inject a failure',      d: 'Configure fault type and parameters.',    dark: false },
  { n: '02', t: 'Run a voice call',      d: 'Use a sample or record live audio.',      dark: true  },
  { n: '03', t: 'Analyze pipeline',      d: 'STT → LLM → TTS with detailed metrics.', dark: true  },
  { n: '04', t: 'Get autopsy report',    d: 'Root cause, evidence, cost, and recommendations.', dark: true  },
];

export default function LandingHome() {
  const [scale, setScale] = useState(1);
  const nav = useNavigate();

  useEffect(() => {
    const compute = () => setScale(Math.min(1, window.innerWidth / 1536));
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // Listen for postMessage from the iframe if it ever wants to signal us.
  useEffect(() => {
    const onMsg = (e) => {
      if (e?.data?.type === 'enter-app') nav('/app');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [nav]);

  const NATIVE_HEIGHT = 550;
  const height = NATIVE_HEIGHT * scale;
  const enter = () => nav('/app');
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="lp">
      <style>{CSS}</style>

      <header className="nav">
        <button className="brand" onClick={top} aria-label="CallAutopsy, back to top">
          <b>CallAutopsy</b>
          <span>Diagnose · Debug · Reduce Costs</span>
        </button>
        <nav className="links" aria-label="Sections">
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
          <button className="cta" onClick={enter}>Try the Live Demo</button>
        </nav>
      </header>

      <section
        style={{
          width: '100%',
          height,
          overflow: 'hidden',
          position: 'relative',
          background: '#F8F5EF',
        }}
      >
        <iframe
          src="/landing.html"
          scrolling="no"
          title="CallAutopsy landing"
          style={{
            width: '1536px',
            height: `${NATIVE_HEIGHT}px`,
            border: 0,
            display: 'block',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </section>

      {/* ---- feature tiles (extracted from iframe into native React) ---- */}
      <section className="features" id="features">
        <div className="row">
          {FEATURES.map(({ icon: I, t, d }) => (
            <div key={t} className="col">
              <div className="ico"><I /></div>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- how it works + example autopsy report ---- */}
      <section className="how" id="how-it-works">
        <div>
          <p className="eyebrow">01 · How it works</p>
          <h2>Inject. Run. Diagnose. Fix.</h2>
          <p className="subtitle">Simulate real-world failures and get a complete autopsy for every failed call.</p>
          <div className="steps">
            {STEPS.map((s) => (
              <div key={s.n} className="step">
                <span className={`n ${s.dark ? 'dark' : ''}`}>{s.n}</span>
                <div>
                  <h4>{s.t}</h4>
                  <p>{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="autopsy" aria-label="Example autopsy report">
          <p className="eyebrow" style={{ margin: 0 }}>Example autopsy report</p>
          <div className="head">
            <h3>Case #3E2F9C2A</h3>
            <a href="#" onClick={(e) => { e.preventDefault(); enter(); }}>View full report →</a>
          </div>
          <p className="ts">2026-09-27 14:32:11Z</p>

          <div className="cod">
            <div className="icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.1" /></svg>
            </div>
            <div className="msg">
              <small>CAUSE OF DEATH</small>
              <b>Hallucination</b>
              <span>Model generated incorrect information not grounded in audio.</span>
            </div>
            <div className="pill"><small>Total Cost</small><b>$0.004312</b></div>
            <div className="pill"><small>Total Latency</small><b>2.384s</b></div>
          </div>

          <div className="stages">
            <div><small>STT</small><b>Deepgram</b><span>0.821s · $0.001231</span></div>
            <div><small>LLM</small><b>OpenAI</b><span>1.103s · $0.006441</span></div>
            <div><small>TTS</small><b>OpenAI</b><span>0.460s · $0.000640</span></div>
          </div>

          <div className="tabs">
            <span className="on">Transcript</span>
            <span>Timeline</span>
            <span>Technical Details</span>
            <span>Recommendation</span>
          </div>

          <div className="pair">
            <div className="clip">
              <p className="lbl">User (audio)</p>
              <div className="bars" aria-hidden="true">
                {Array.from({ length: 26 }).map((_, i) => (
                  <i key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 0.9)) * 60}%` }} />
                ))}
              </div>
              <p className="quote">"Can you tell me the refund policy?"</p>
            </div>
            <div className="arrow"><RightArrow /></div>
            <div className="clip hall">
              <p className="lbl">Model Response (hallucination)</p>
              <div className="bars" aria-hidden="true">
                {Array.from({ length: 26 }).map((_, i) => (
                  <i key={i} style={{ height: `${20 + Math.abs(Math.cos(i * 1.1)) * 60}%` }} />
                ))}
              </div>
              <p className="quote">"Sure, you are eligible for a 50% refund within 30 days of purchase, and you will also receive a free replacement."</p>
            </div>
          </div>
        </aside>
      </section>

      <section className="sec" id="product">
        <p className="eyebrow">Product</p>
        <h2>Find out why the call failed.</h2>
        <p className="lede">Inject a fault, run two configurations, and get a plain verdict on which one holds up and what it costs.</p>
        <div className="grid g3">
          {PRODUCT.map((p, i) => (
            <div key={p.t} className="card">
              <p className="num">0{i + 1}</p>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sec alt" id="use-cases">
        <p className="eyebrow">Use Cases</p>
        <h2>Compare before you commit.</h2>
        <p className="lede">Every decision about your voice stack becomes a side-by-side run.</p>
        <div className="grid g4">
          {USE_CASES.map((u) => (
            <div key={u.t} className="card">
              <h3>{u.t}</h3>
              <p>{u.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sec" id="case-studies">
        <p className="eyebrow">Case Studies</p>
        <h2>Worked examples.</h2>
        <p className="lede">Three scenarios you can reproduce in the live demo in under a minute.</p>
        <div className="grid g3">
          {STUDIES.map((s) => (
            <div key={s.t} className="card">
              <p className="tag">{s.tag}</p>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <p>Same failure. Two configurations. One clear answer.</p>
        <button className="cta" onClick={enter}>Get Started</button>
      </section>

      <footer className="foot">
        <span>CallAutopsy</span>
        <span>Diagnose · Debug · Reduce Costs</span>
      </footer>
    </div>
  );
}