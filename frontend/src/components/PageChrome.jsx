import { Link } from 'react-router-dom';

/* ============================================================
   Shared case-file chrome for Analyze / A/B / Ops.
   Uses the same visual language as Dashboard.jsx so nav, headers,
   panels, tags, buttons look identical across all pages.
   ============================================================ */

const NAV = [
  { label: 'Dashboard', to: '/app' },
  { label: 'Analyze',   to: '/analyze' },
  { label: 'A/B',       to: '/ab' },
  { label: 'Ops',       to: '/ops' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700&display=swap');

.pc-root{
  --paper:#f4efe3; --panel:rgba(255,253,247,.78); --line:#d8d2c3; --ink:#15130f; --mute:#6f6a5d;
  --red:#e2372b; --red-bg:#fbd9d3; --red-line:#eb8f86;
  --green:#12935f; --green-bg:#d8eee2;
  --amber:#a5620a; --amber-bg:#f7e5bf;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  position:fixed; inset:0; z-index:1000; overflow-x:hidden; overflow-y:auto;
  color:var(--ink); font-family:var(--mono); min-height:100%;
  background-color:var(--paper);
  background-image:
    linear-gradient(rgba(120,110,90,.10) 1px,transparent 1px),
    linear-gradient(90deg,rgba(120,110,90,.10) 1px,transparent 1px),
    radial-gradient(ellipse at 50% 0%,rgba(255,255,255,.5),transparent 60%);
  background-size:48px 48px,48px 48px,100% 100%;
  --pl:22px; --pr:22px; padding:0 var(--pr) 40px var(--pl);
}
.pc-root *{box-sizing:border-box}
.pc-root button{font-family:inherit;cursor:pointer}
@media (min-width:1024px){
  .pc-root{--pl:clamp(48px,4vw,96px); --pr:clamp(48px,4vw,96px)}
}

/* pinned nav bar (same as Dashboard's .ap-topbar) */
.pc-topbar{position:sticky;top:0;z-index:60;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  margin:0 calc(-1 * var(--pr)) 0 calc(-1 * var(--pl));padding:10px var(--pr) 10px var(--pl);
  border-bottom:1px solid rgba(206,198,178,.95);
  background:rgba(250,246,234,.86);-webkit-backdrop-filter:blur(16px) saturate(150%);backdrop-filter:blur(16px) saturate(150%);
  box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 14px 28px -20px rgba(60,45,20,.5)}
.pc-brand{display:flex;align-items:center;gap:10px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:#2b281f;white-space:nowrap;background:none;border:0;padding:0;cursor:pointer}
.pc-brand i{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#e2372b,#f0a23a)}
.pc-nav{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.pc-nav a,.pc-nav .on{font-family:var(--serif);font-size:19px;padding:9px 18px;border-radius:999px;color:var(--ink);text-decoration:none;transition:background .2s,transform .2s}
.pc-nav .on{background:#fff;border:1px solid var(--line);box-shadow:0 6px 14px -8px rgba(60,45,20,.45)}
.pc-nav a:hover{background:rgba(190,182,160,.25)}
.pc-nav .pc-landing{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(180deg,#1b2030,#0b0e15);color:#f7f3e8;margin-left:12px;padding:12px 22px;border-radius:10px;box-shadow:0 12px 24px -12px rgba(11,14,21,.75),0 1px 0 rgba(255,255,255,.14) inset}
.pc-nav .pc-landing:hover{background:linear-gradient(180deg,#232a3f,#000);transform:translateY(-1px)}

/* header */
.pc-head{display:block;margin-top:22px;position:relative;z-index:1;overflow:hidden;
  padding:22px 28px 22px 32px;border:1px solid rgba(206,198,178,.95);border-radius:14px;
  background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(255,250,236,.52));
  -webkit-backdrop-filter:blur(14px) saturate(140%);backdrop-filter:blur(14px) saturate(140%);
  box-shadow:0 1px 0 rgba(255,255,255,.95) inset,0 22px 44px -26px rgba(60,45,20,.4),0 2px 6px rgba(60,45,20,.06)}
.pc-head::after{content:'';position:absolute;right:-70px;top:-90px;width:300px;height:300px;background:radial-gradient(circle,rgba(226,55,43,.11),transparent 65%);pointer-events:none}

.pc-head > *{position:relative;z-index:1}
.pc-eyebrow{display:flex;align-items:center;gap:12px;font-size:11.5px;letter-spacing:.32em;text-transform:uppercase;color:#4a4536}
.pc-title{font-family:var(--serif);font-weight:500;font-size:48px;line-height:1;letter-spacing:-.028em;margin:10px 0 0;color:var(--ink)}
.pc-title em{font-style:italic;font-weight:400;padding-right:.06em;background:linear-gradient(100deg,#e2372b 0%,#c2410c 55%,#a5620a 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.pc-tagline{margin:12px 0 0;font-size:13px;letter-spacing:.03em;color:var(--mute)}

/* body */
.pc-body{margin-top:22px;position:relative;z-index:1}

/* panels */
.pc-panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:18px 20px;min-width:0}
.pc-h{font-size:13px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:#211f18;margin:0 0 14px}
.pc-sub{color:var(--mute);font-size:13px}

/* pills / tags */
.pc-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:3px;padding:4px 10px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);background:rgba(255,255,255,.6)}
.pc-pill.bad{border-color:var(--red-line);color:var(--red);background:rgba(251,217,211,.4)}
.pc-pill.ok{border-color:#8ccaa9;color:var(--green);background:rgba(216,238,226,.5)}
.pc-tag{display:inline-block;font-family:var(--mono);font-size:12px;padding:3px 10px;border-radius:3px}
.pc-tag.red{background:var(--red-bg);color:#c0301f}
.pc-tag.amber{background:var(--amber-bg);color:var(--amber)}
.pc-tag.green{background:var(--green-bg);color:#16794f}
.pc-tag.blue{background:#dfeaff;color:#1e5aa0}
.pc-tag.violet{background:#e6dfff;color:#5a4bc4}

/* buttons */
.pc-btn{display:inline-flex;align-items:center;gap:8px;background:#15130f;color:#fff;border:0;border-radius:6px;padding:9px 16px;font-family:var(--serif);font-size:15px;transition:transform .12s,filter .12s,background .12s}
.pc-btn:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px)}
.pc-btn:disabled{opacity:.5;cursor:not-allowed}
.pc-btn.ghost{background:transparent;color:var(--ink);border:1px solid #b9b2a0}
.pc-btn.ghost:hover:not(:disabled){background:rgba(21,19,15,.06)}
.pc-btn.danger{background:linear-gradient(135deg,#e2372b,#c2410c)}
.pc-btn.small{padding:6px 12px;font-size:13px}

/* chips (segmented + selectable) */
.pc-chip{font-family:var(--mono);font-size:12px;padding:5px 11px;border-radius:3px;border:1px solid var(--line);background:rgba(255,255,255,.55);color:var(--ink);cursor:pointer;transition:background .15s}
.pc-chip:hover{background:rgba(190,182,160,.25)}
.pc-chip.on{background:#15130f;color:#fff;border-color:#15130f}
.pc-chip.on.red{background:var(--red);border-color:var(--red)}

/* tables */
.pc-table{width:100%;border-collapse:collapse;font-size:13px}
.pc-table thead th{text-align:left;font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);font-weight:500;padding:10px 14px;background:rgba(255,255,255,.4);border-bottom:1px solid var(--line)}
.pc-table tbody td{padding:11px 14px;border-bottom:1px solid rgba(216,210,195,.55)}
.pc-table tbody tr:hover{background:rgba(190,182,160,.14)}
.pc-table tbody tr:nth-child(even){background:rgba(255,253,247,.35)}
.pc-table .mono{font-family:var(--mono)}

/* inputs / range */
.pc-input{width:100%;background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:4px;padding:10px 12px;font-family:var(--mono);font-size:14px;color:var(--ink)}
.pc-range{-webkit-appearance:none;appearance:none;width:100%;height:3px;border-radius:2px;background:linear-gradient(to right,#15130f var(--pct,50%),#cdc7b7 var(--pct,50%));outline:none}
.pc-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#15130f;box-shadow:0 0 0 3px rgba(255,253,247,.95),0 2px 6px rgba(0,0,0,.25);border:0}
.pc-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#15130f;border:0}

/* tabs */
.pc-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:22px;padding:0}
.pc-tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:11px 22px;font-family:var(--serif);font-size:18px;color:var(--mute);margin-bottom:-1px;cursor:pointer;transition:color .15s}
.pc-tabs button:hover{color:var(--ink)}
.pc-tabs button.on{color:var(--ink);border-bottom-color:var(--red);background:rgba(255,255,255,.55);border-radius:3px 3px 0 0}

/* status dots */
.pc-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#8b8577}
.pc-dot.ok{background:var(--green)}
.pc-dot.bad{background:var(--red)}
.pc-dot.amber{background:#e0a030}

/* headline meta card */
.pc-meta-card{border:1px solid var(--line);background:rgba(255,255,255,.5);border-radius:6px;padding:16px 18px}
.pc-meta-card .k{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--mute);margin:0}
.pc-meta-card .v{font-family:var(--serif);font-size:32px;font-weight:500;line-height:1.1;margin:6px 0 4px;color:var(--ink)}
.pc-meta-card .h{font-size:12px;color:var(--mute)}

/* grid helpers */
.pc-grid{display:grid;gap:14px}
.pc-grid.g2{grid-template-columns:1fr}
.pc-grid.g3{grid-template-columns:1fr}
.pc-grid.g4{grid-template-columns:repeat(2,1fr)}
@media(min-width:768px){
  .pc-grid.g2{grid-template-columns:repeat(2,1fr)}
  .pc-grid.g3{grid-template-columns:repeat(3,1fr)}
  .pc-grid.g4{grid-template-columns:repeat(4,1fr)}
}

/* progress bars */
.pc-bar{height:6px;background:rgba(21,19,15,.08);border-radius:3px;overflow:hidden}
.pc-bar i{display:block;height:100%;border-radius:3px;background:var(--ink);transition:width .3s ease}
.pc-bar i.red{background:var(--red)}
.pc-bar i.green{background:var(--green)}

/* winner ribbon */
.pc-winner{position:relative;border:2px solid #15130f}
.pc-winner::after{content:'WINNER';position:absolute;top:-11px;right:16px;background:#15130f;color:#fff;font-family:var(--mono);font-size:10px;letter-spacing:.18em;padding:3px 9px;border-radius:3px}

/* section spacing */
.pc-section{margin-top:22px}
.pc-section:first-child{margin-top:0}

/* confusion matrix cell */
.pc-cell-good{background:var(--green-bg);color:var(--green)}
.pc-cell-bad{background:var(--red-bg);color:var(--red)}

@media (prefers-reduced-motion:reduce){.pc-root *{animation:none!important;transition:none!important}}
`;

export default function PageChrome({ active, eyebrow, title, titleEm, tagline, children }) {
  return (
    <div className="pc-root">
      <style>{CSS}</style>

      <div className="pc-topbar">
        <Link to="/" className="pc-brand" style={{ textDecoration: 'none' }}>
          <i /> CallAutopsy
        </Link>
        <nav className="pc-nav" aria-label="Primary">
          {NAV.map((n) => (
            active === n.label
              ? <span key={n.to} className="on" aria-current="page">{n.label}</span>
              : <Link key={n.to} to={n.to}>{n.label}</Link>
          ))}
          <Link to="/" className="pc-landing">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            Landing
          </Link>
        </nav>
      </div>

      <header className="pc-head">
        <div className="pc-eyebrow">{eyebrow || 'Case File'}</div>
        <h1 className="pc-title">
          {title}
          {titleEm && <> <em>{titleEm}</em></>}
        </h1>
        {tagline && <p className="pc-tagline">{tagline}</p>}
      </header>

      <div className="pc-body">{children}</div>
    </div>
  );
}
