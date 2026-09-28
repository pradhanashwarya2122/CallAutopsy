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
`;

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

  const NATIVE_HEIGHT = 1030;
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