import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// Assets live in frontend/src/assets. Rename the ChatGPT figure to hero-pipeline.png
// (or change this one import line to its actual filename).
// If this file is not in src/pages, adjust '../assets' to the right relative path.
import HERO_IMG from '../assets/hero-pipeline.png';
import IMG_AIRWAY from '../assets/head-airway.png';
import IMG_TAX from '../assets/bg-taxonomy.png';
import IMG_BRAIN from '../assets/bg-brain.png';
import IMG_SPINE from '../assets/bg-spine.png';
import IMG_LARYNX from '../assets/bg-larynx.png';
import IMG_LUNGS from '../assets/bg-lungs.png';
import { AB, RECORDED } from '../lib/landingData.js';

// Native landing page (the /landing.html iframe is no longer used).
// Every CTA routes to /app. Every figure is measured on the live pipeline: the per-fault values in F are medians of injected runs
// (n is shown on the card), the A/B and recorded-run figures come from lib/landingData.js, measured 2026-09-30.

const NAV = [
  { id: 'product', label: 'Autopsy' },
  { id: 'features', label: 'Failures' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'use-cases', label: 'Compare' },
  { id: 'case-studies', label: 'Cases' },
];
const STG = ['STT', 'LLM', 'TTS'];
const PROV = ['Deepgram', 'OpenAI', 'OpenAI'];

// Median of the injected runs in the workspace's call history (Postgres, 2026-09-30); n = runs behind each value.
//   s   stage where the cause sits (0 STT, 1 LLM, 2 TTS)            st   median stage times [STT, LLM, TTS] in seconds
//   l   seconds until the failing stage finished                     lat  median pipeline time, STT + LLM + TTS
//   c   the detector's fixed confidence (0-100). It is the value of the rule that fired, not a probability.
//   after  whether the stages after the failing one still ran
const F = [
  { k: 'bad_stt', n: 'Bad STT', s: 0, c: 90, cost: 0.00225, st: [0.84, 0.82, 1.53], l: 0.84, lat: 3.43, N: 38, after: 'ran', p: 'Corrupt 100% of the audio frames', w: 'Transcript no longer matches the audio', x: 'STT confidence below its threshold', ev: ['Average STT confidence fell below the provider threshold', 'The transcript drifted from what was said', 'LLM and TTS still ran on the damaged transcript'], r: 'Add domain vocabulary to the STT model, or ask the caller to repeat when confidence is low.' },
  { k: 'hallucination', n: 'Hallucination', s: 1, c: 85, cost: 0.009659, st: [0.4, 1.72, 2.98], l: 2.12, lat: 5.22, N: 17, after: 'ran', p: 'Aggressive prompt, temperature 0.9', w: 'Reply states things the question never supported', x: 'reply not supported by the question', ev: ['A second model judged the reply unsupported by the question', 'Caught in 17 of 33 injected runs: the model does not always invent', 'Checked after the time rule, so a slow reply is called a timeout first'], r: 'Add grounding validation before the reply is voiced.' },
  { k: 'timeout', n: 'Timeout', s: 1, c: 95, cost: 0.004572, st: [0.85, 12.03, 1.79], l: 12.88, lat: 15.02, N: 30, after: 'ran', p: 'LLM delayed 3 s past its 8 s limit', w: 'LLM passed its 8 s limit', x: 'stage past its limit', ev: ['The LLM stage ran 12.0 s; its limit is 8 s', 'STT finished in 0.85 s, so it is cleared', 'TTS still ran afterwards (1.8 s)'], r: 'Stream the reply and play a filler line while the model thinks.' },
  { k: 'tts_glitch', n: 'TTS glitch', s: 2, c: 80, cost: 0.003685, st: [0.82, 1.14, 1.4], l: 3.36, lat: 3.59, N: 22, after: 'ran', p: 'Keep 30% of the reply text', w: 'Synthesized audio does not match the reply', x: 'audio length does not fit the text', ev: ['The synthesized audio length did not match the reply text', 'STT and LLM finished normally', 'TTS ran 1.4 s'], r: 'Check the audio length against the text and retry synthesis once.' },
  { k: 'network_drop', n: 'Network drop', s: 0, c: 100, cost: 0.000165, st: [0, 0, 0], l: 0, lat: 0, N: 24, after: 'skip', p: 'Connection dropped at the STT stage', w: 'Connection closed before the stage could answer', x: 'websocket closed', ev: ['A websocket close event was received', 'The STT stage ended in an error at once', 'LLM and TTS were never reached'], r: 'Retry with backoff and fail over to a second region.' },
  { k: 'user_hangup', n: 'User hangup', s: 0, c: 100, cost: 0.000174, st: [0, 0, 0], l: 0, lat: 0, N: 24, after: 'skip', p: 'Caller cancels at the STT stage', w: 'Caller left before the call could finish', x: 'caller cancelled', ev: ['A user cancellation signal was received', 'The STT stage stopped at once', 'LLM and TTS never ran'], r: 'Shorten the time to first audio and add a filler phrase while the model thinks.' },
  { k: 'exception', n: 'Exception', s: 0, c: 95, cost: 0.000183, st: [0, 0, 0], l: 0, lat: 0, N: 29, after: 'skip', p: 'Null payload at the STT stage', w: 'Unhandled error inside the stage', x: 'unhandled error', ev: ['An unhandled error was caught in the stage', 'The STT stage ended in an error', 'LLM and TTS never ran'], r: 'Catch stage errors, log the payload and return a safe reply.' },
];

// The animation replays a failure in at most ANIM_MAX seconds; a longer real failure (a 13 s timeout) is sped up and labelled.
const ANIM_MAX = 4.5;
const animOf = (f) => Math.max(0.6, Math.min(f.l, ANIM_MAX));
const spanOf = (f) => Math.max(3, Math.ceil(f.lat));

const WALK = [
  { t: 'Inject a failure', d: 'Pick one of seven faults to inject.' },
  { t: 'Run a voice call', d: 'Audio moves through STT, LLM and TTS.' },
  { t: 'Watch it break', d: 'The failing stage shows up in the timings.' },
  { t: 'Read the autopsy', d: 'Cause, evidence, cost and a suggested fix.' },
];

const EVIDENCE = [
  ['Audio', '“Hi. I’m calling because I was charged twice for the same order.” A 15 s demo call, timeout injected.'],
  ['Transcript', 'Deepgram heard 33 words at 0.999 average confidence, so speech-to-text is cleared.'],
  ['LLM stage', 'gpt-4o-mini took 13.350 s. The stage limit is 8 s.'],
  ['TTS stage', 'Text-to-speech still ran (4.191 s), so the failure shows only in the timings.'],
  ['Verdict', 'Timeout in the LLM stage. Rule confidence 0.95: a fixed value, not a probability.'],
];

const USE_CASES = [
  { t: 'STT bake-off', d: 'Deepgram vs Whisper on the same clip, with or without a fault.' },
  { t: 'LLM cost vs quality', d: 'gpt-4o-mini vs gpt-4o, with failures and cost per call side by side.' },
  { t: 'Regression check', d: 'Run the same demo call again after a config change.' },
  { t: 'Resilience testing', d: 'See which injected fault hurts your stack most.' },
];

const STUDIES = [
  { t: 'Fast and cheap vs premium', d: 'Deepgram with gpt-4o-mini against Whisper with gpt-4o. Run 3 calls per side, read the verdict, and decide if the premium stack earns its price.', m: '3 runs per side: 4.1 s vs 5.7 s, $0.0036 vs $0.0050' },
  { t: 'Hallucination is the hard one', d: 'Force fabricated answers and see how often the classifier catches them. It depends on the model actually inventing something, and on the reply not being slow first.', m: 'caught in 17 of 33 injected runs' },
  { t: 'Timeout autopsy', d: 'Delay a stage past its limit and use the timings to see which stage gave out first.', m: 'LLM 12.0 s against an 8 s limit (median of 30 runs)' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
.lp{--paper:#F8F5EF;--tan:#f3ecdc;--line:#e3d9c7;--ink:#141210;--mut:#6b6357;--red:#d0161c;--ok:#2f6b4f;font-family:'Newsreader',Georgia,serif;color:var(--ink);background:var(--paper);min-height:100vh}
.lp *{box-sizing:border-box}
.lp .mono,.lp .m{font-family:'IBM Plex Mono',ui-monospace,monospace}
.lp .nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:24px;height:64px;padding:0 clamp(16px,3vw,48px);background:rgba(248,245,239,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.lp .brand{display:flex;align-items:baseline;gap:16px;background:none;border:0;padding:0;cursor:pointer;color:var(--ink);font-family:inherit}
.lp .brand b{font-size:24px;font-weight:700;letter-spacing:-.02em}
.lp .brand span{font:11px 'IBM Plex Mono',monospace;letter-spacing:.06em;color:var(--red)}
.lp .links{display:flex;align-items:center;gap:28px}
.lp .links a{font-size:17px;color:var(--ink);text-decoration:none;padding:4px 0;border-bottom:2px solid transparent;transition:border-color .15s,color .15s}
.lp .links a:hover{color:var(--red);border-color:var(--red)}
.lp .cta{font-family:'Newsreader',serif;font-size:17px;padding:10px 22px;background:#0d0c0b;color:#fff;border:1px solid #0d0c0b;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:background .15s,transform .1s}
.lp .cta:hover{background:var(--red);border-color:var(--red)}
.lp .cta:active{transform:scale(.985)}
.lp .cta.ghost{background:transparent;color:var(--ink);border-color:var(--ink)}
.lp .cta.ghost:hover{background:var(--ink);color:#fff}
.lp a:focus-visible,.lp button:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.lp .sec{padding:80px clamp(16px,6vw,96px);scroll-margin-top:64px}
.lp .sec.alt{background:var(--tan)}
.lp .lab{font:12.5px 'IBM Plex Mono',monospace;color:var(--red);margin:0 0 14px;letter-spacing:.05em}
.lp h2{font-size:clamp(34px,4.4vw,58px);font-weight:600;letter-spacing:-.035em;line-height:1.04;margin:0 0 16px;max-width:15em}
.lp .lede{font-size:21px;color:#4a443b;max-width:34em;margin:0 0 44px;line-height:1.5}
.lp .cols{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start}

/* trace divider */
.lp .trace{position:relative;height:50px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:repeating-linear-gradient(90deg,transparent 0 39px,rgba(20,18,16,.06) 39px 40px)}
.lp .trace svg{width:100%;height:100%;display:block}
.lp .trace path{fill:none;stroke:var(--ink);stroke-width:1.2;vector-effect:non-scaling-stroke}
.lp .trace .cut{stroke:var(--red);stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.lp .trace span{position:absolute;top:4px;margin-left:8px;font:10.5px 'IBM Plex Mono',monospace;color:var(--red);background:var(--paper);padding:0 4px;white-space:nowrap}

/* hero */
.lp .hero{--H:clamp(700px,54vw,820px);position:relative;min-height:var(--H);display:flex;align-items:center;padding:56px clamp(16px,6vw,96px);overflow:hidden;background:var(--paper)}
.lp .hero:before{content:'';position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,var(--paper) 0,var(--paper) 30%,rgba(248,245,239,0) 56%)}
.lp .art{position:absolute;right:0;top:0;height:var(--H);aspect-ratio:3/2}
.lp .art img{width:100%;height:100%;display:block;object-fit:cover;mix-blend-mode:multiply;-webkit-mask-image:linear-gradient(90deg,transparent,#000 16%),linear-gradient(180deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 16%),linear-gradient(180deg,transparent,#000 6%,#000 94%,transparent);-webkit-mask-composite:source-in;mask-composite:intersect}
.lp .ov{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.lp .ov .wash{transition:opacity .9s}
.lp .sg{fill:none;stroke-linecap:round}
.lp .sg.base{stroke:rgba(20,18,16,.3);stroke-width:2;stroke-dasharray:2 7}
.lp .sg.halo{stroke:#fff;stroke-width:11;opacity:.85}
.lp .sg.on{stroke:var(--ink);stroke-width:4}.lp .sg.on.ok{stroke:var(--ok)}.lp .sg.on.bad{stroke:var(--red)}
.lp .nd .core{fill:var(--paper);stroke:var(--ink);stroke-width:3}
.lp .nd text{font:600 15px 'IBM Plex Mono',monospace;fill:var(--ink)}
.lp .nd rect{fill:var(--paper);stroke:var(--ink);stroke-width:1}
.lp .nd.ok .core{stroke:var(--ok);fill:#e6f0ea}.lp .nd.ok text{fill:var(--ok)}.lp .nd.ok rect{stroke:var(--ok)}
.lp .nd.fail .core{stroke:var(--red);fill:#fce4e0}.lp .nd.fail text{fill:var(--red)}.lp .nd.fail rect{stroke:var(--red)}
.lp .nd.wait,.lp .nd.skip{opacity:.55}
.lp .nd .pulse,.lp .nd .ping{fill:none;stroke-width:3;transform-box:fill-box;transform-origin:center;animation:ping 1.2s ease-out infinite}
.lp .nd .pulse{stroke:var(--ink)}.lp .nd .ping{stroke:var(--red)}.lp .nd .p2{animation-delay:.55s}
@keyframes ping{from{transform:scale(.7);opacity:.9}to{transform:scale(3.4);opacity:0}}
.lp .lock{fill:none;stroke:var(--red);stroke-width:3;transform-box:fill-box;transform-origin:center;animation:lk .5s cubic-bezier(.2,1.4,.4,1)}
@keyframes lk{from{transform:scale(2.6);opacity:0}}
.lp .lead{fill:none;stroke:var(--red);stroke-width:2;stroke-dasharray:8 6;animation:dash .8s linear infinite}
@keyframes dash{to{stroke-dashoffset:-14}}
.lp .copy{position:relative;z-index:2;max-width:min(540px,44vw)}
.lp .hero h1{font-size:clamp(42px,4.6vw,72px);font-weight:600;letter-spacing:-.045em;line-height:.98;margin:0 0 26px}
.lp .hero h1 em{font-style:italic;font-weight:400;letter-spacing:-.03em;color:var(--red)}
.lp .hero .sub{font-size:21px;line-height:1.5;color:#4a443b;max-width:30em;margin:0 0 30px}
.lp .btns{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:36px}
.lp .facts{display:flex;flex-wrap:wrap}
.lp .facts div{padding:0 22px;border-left:1px solid var(--ink)}.lp .facts div:first-child{padding-left:0;border-left:0}
.lp .facts b{display:block;font-size:30px;letter-spacing:-.02em}
.lp .facts span{font:11.5px 'IBM Plex Mono',monospace;color:var(--mut)}
.lp .wave{display:flex;gap:2px;align-items:center}
.lp .wave i{flex:1;height:var(--h);background:var(--ink);animation:wv 1s ease-in-out infinite;animation-delay:var(--d)}
@keyframes wv{50%{transform:scaleY(.3)}}

/* hero case (light, printed-report look) */
.lp .case{position:absolute;z-index:2;right:clamp(16px,4vw,64px);top:50%;translate:0 -50%;width:min(420px,34vw);min-width:350px;background:#fdfbf6;color:var(--ink);border:1px solid #cfc3aa;box-shadow:0 26px 44px -30px rgba(60,45,20,.6);font-family:'IBM Plex Mono',monospace;transition:border-color .3s}
.lp .case.bad{border-color:#d9a9a4}
.lp .case.hit .cbody{animation:hit .4s}
@keyframes hit{25%{transform:translateX(-5px)}50%{transform:translateX(4px)}75%{transform:translateX(-2px)}}
.lp .ch{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:3px double #cfc3aa;font-size:11.5px}
.lp .ch b{font-weight:500}
.lp .sts{font-size:10.5px;letter-spacing:.06em;color:var(--mut)}.lp .sts.bad{color:var(--red)}.lp .sts.ok{color:var(--ok)}
.lp .cbody{padding:14px 16px 10px}
.lp .clock{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px}
.lp .clock>span{font-size:38px;font-weight:500;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.lp .clock small{font-size:15px;color:var(--mut);margin-left:2px}
.lp .scope{width:130px;height:36px;border:1px solid var(--line);background:linear-gradient(var(--line),var(--line)) 0 50%/100% 1px no-repeat}
.lp .scope path{fill:none;stroke:var(--ink);stroke-width:1.4}.lp .scope.dead path{stroke:var(--red)}
.lp .tk,.lp .axis{display:grid;grid-template-columns:32px 1fr 60px;gap:10px;align-items:center}
.lp .tk{height:27px;font-size:12px}
.lp .tk .tn,.lp .tk .ts{color:var(--mut)}.lp .tk .ts{text-align:right}
.lp .tk.ok .ts{color:var(--ok)}.lp .tk.fail .ts{color:var(--red)}.lp .tk.skip{opacity:.4}
.lp .tb{position:relative;height:12px;background:repeating-linear-gradient(90deg,#d8cdb6 0 1px,transparent 1px 27.78%),#f3ecdc}
.lp .tb i{position:absolute;top:0;bottom:0;background:var(--ink);transition:width .4s}
.lp .tk.ok .tb i{background:var(--ok)}
.lp .tk.run .tb i:after,.lp .tk.fail .tb i:after{content:'';position:absolute;right:-1px;top:-3px;bottom:-3px;width:2px;background:var(--red)}
.lp .tk.fail .tb i{background:repeating-linear-gradient(45deg,var(--red) 0 3px,#fce4e0 3px 7px);background-size:9.9px 9.9px;animation:hz .5s linear infinite}
@keyframes hz{to{background-position:9.9px 0}}
.lp .axis{font-size:10px;color:#8a7350}.lp .axis div{position:relative;height:14px}.lp .axis em{position:absolute;font-style:normal}
.lp .evd{position:relative;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);min-height:98px}
.lp .evd h6{margin:0 0 4px;font:400 10px 'IBM Plex Mono',monospace;color:#8a7350;letter-spacing:.08em;text-transform:uppercase}
.lp .evd p{display:flex;gap:8px;margin:0;padding:4px 0;border-bottom:1px dashed var(--line);font-size:12px;line-height:1.35;color:#3b352d;opacity:0;transform:translateY(4px);transition:opacity .35s,transform .35s}
.lp .evd p.on{opacity:1;transform:none}.lp .evd p b{flex:none;font-weight:500;color:var(--red)}
.lp .stamp{position:absolute;right:0;top:2px;border:2px solid var(--red);color:var(--red);padding:1px 9px;font:600 11.5px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;rotate:-4deg;mix-blend-mode:multiply;animation:stp .28s cubic-bezier(.2,1.5,.4,1)}
@keyframes stp{from{scale:1.8;opacity:0}}
.lp .vd{margin-top:10px;background:#fce4e0;border:1px solid #f3c3bc;padding:10px 12px;min-height:126px;opacity:0;transition:opacity .4s}.lp .vd.on{opacity:1}
.lp .vd small{display:block;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#a12a26}
.lp .vd .cod b{display:block;font-size:20px;font-weight:600;color:#B5261C;margin:2px 0 6px;min-height:26px}
.lp .meter{display:flex;gap:2px;margin-bottom:8px}.lp .meter i{flex:1;height:8px;background:#f0c9c3}.lp .meter i.on{background:var(--red)}
.lp .lf{display:flex;align-items:baseline;font-size:12px;color:#7d2419;line-height:1.7}.lp .lf i{flex:1;border-bottom:1px dotted #c98d86;margin:0 6px}.lp .lf b{font-weight:500;color:#B5261C}
.lp .cfoot{display:flex;justify-content:space-between;padding:7px 16px;border-top:1px solid var(--line);font-size:10px;color:#8a7350}

/* anatomical background art */
.lp .sec,.lp .con{position:relative;overflow:hidden}
.lp .sec>*,.lp .con>*{position:relative;z-index:1}
.lp .bgart{--mx:linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent);--my:linear-gradient(180deg,transparent,#000 12%,#000 45%,transparent 100%)}
.lp .bgart.r{--mx:linear-gradient(90deg,transparent,#000 14%)}
.lp .bgart.l{--mx:linear-gradient(90deg,#000 86%,transparent)}
.lp .bgart.t{--my:linear-gradient(180deg,transparent,#000 8%,#000 92%,transparent)}
.lp .sec>.bgart,.lp .con>.bgart{position:absolute;z-index:0;display:block;height:auto;max-width:none;pointer-events:none;user-select:none;mix-blend-mode:multiply;filter:brightness(1.07);opacity:.5;-webkit-mask-image:var(--mx),var(--my);mask-image:var(--mx),var(--my);-webkit-mask-composite:source-in;mask-composite:intersect}
.lp .con>.bgart{--mx:linear-gradient(#000,#000);mix-blend-mode:screen;filter:invert(1) hue-rotate(180deg)}

/* taxonomy */
.lp .tax{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--ink);border-left:1px solid var(--line)}
.lp .tax button{all:unset;box-sizing:border-box;cursor:pointer;padding:20px 20px 18px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px;min-height:150px;transition:background .15s}
.lp .tax button:hover{background:#fbf7ee}
.lp .tax button:focus-visible{outline:2px solid var(--red);outline-offset:-2px}
.lp .tax .top{display:flex;justify-content:space-between;font:11px 'IBM Plex Mono',monospace;color:var(--mut)}
.lp .tax h3{font-size:23px;font-weight:600;margin:6px 0 0;letter-spacing:-.01em}
.lp .tax .x{font:12.5px 'IBM Plex Mono',monospace;color:var(--red)}
.lp .tax .cf{margin-top:auto;height:3px;background:var(--line)}.lp .tax .cf i{display:block;height:100%;background:var(--ink)}
.lp .tax .note{display:flex;align-items:center;font-size:17px;color:var(--mut);padding:20px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);grid-column:span 1}

/* walkthrough */
.lp .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
.lp .chip{font:12px 'IBM Plex Mono',monospace;padding:6px 11px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;transition:background .15s,color .15s}
.lp .chip.on{background:var(--red);border-color:var(--red);color:#fff}
.lp .chip:hover:not(.on){background:var(--ink);color:#fff}
.lp .stp{all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:14px;width:100%;padding:14px 0 14px 16px;border-left:2px solid var(--line);opacity:.55;transition:opacity .2s,border-color .2s}
.lp .stp.on{opacity:1;border-color:var(--red)}
.lp .stp:focus-visible{outline:2px solid var(--red)}
.lp .stp .n{flex:none;width:32px;height:32px;border-radius:50%;background:#1a1815;color:#fff;display:grid;place-items:center;font:13px 'IBM Plex Mono',monospace}
.lp .stp.on .n{background:#8F1414}
.lp .stp h4{font-size:19px;font-weight:600;margin:4px 0 2px}
.lp .stp p{font-size:15px;color:#4a443b;margin:0}
.lp .rep{background:#fbf9f4;border:1px solid #d9cfba;box-shadow:0 20px 40px -26px rgba(60,45,20,.4);min-height:430px}
.lp .rep .bar{display:flex;justify-content:space-between;padding:10px 18px;background:#0d0c0b;color:#e9e2d2;font:11.5px 'IBM Plex Mono',monospace}
.lp .rep .bar i{font-style:normal;color:#ff6b62}
.lp .rep .body{padding:20px 22px}
.lp .rep .row{display:grid;grid-template-columns:44px 1fr 90px;gap:12px;align-items:center;margin-bottom:14px;font:13px 'IBM Plex Mono',monospace}
.lp .rep .row em{font-style:normal;text-align:right;color:var(--mut)}
.lp .pb{height:9px;background:var(--line);position:relative}
.lp .pb i{position:absolute;inset:0 auto 0 0;width:0;background:var(--ok);animation:fill var(--dur,1.4s) ease-out forwards;animation-delay:var(--dl,0s)}
.lp .pb i.bad{background:var(--red)}
@keyframes fill{to{width:var(--to,100%)}}
.lp .segs{display:flex;gap:3px;margin:8px 0 22px}.lp .segs i{flex:1;height:12px;background:var(--line)}.lp .segs i.on{background:var(--red)}
.lp .rep h5{font:11px 'IBM Plex Mono',monospace;color:var(--mut);margin:0 0 6px;font-weight:400;letter-spacing:.06em;text-transform:uppercase}
.lp .rep .big{font-size:26px;font-weight:600;letter-spacing:-.015em;margin:0 0 4px}
.lp .rep ul{margin:0 0 16px;padding-left:18px;font-size:15.5px;line-height:1.5;color:#3b352d}
.lp .rep .kv{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);margin-bottom:16px}
.lp .rep .kv div{padding:8px 12px;border-left:1px solid var(--line)}.lp .rep .kv div:first-child{border-left:0}
.lp .rep .kv b{display:block;font:500 15px 'IBM Plex Mono',monospace;color:#B5261C}
.lp .rep .rec{border-left:3px solid var(--ok);background:#eef3ee;padding:9px 12px;font-size:15.5px}

/* evidence chain */
.lp .chain{position:relative;padding-left:44px}
.lp .chain .ln{position:absolute;left:11px;top:8px;bottom:26px;width:2px;background:var(--red);transform:scaleY(0);transform-origin:top;transition:transform 2s ease}
.lp .chain.seen .ln{transform:scaleY(1)}
.lp .ev{position:relative;padding-bottom:24px;opacity:.25;transition:opacity .5s}
.lp .chain.seen .ev{opacity:1}
.lp .ev:before{content:'';position:absolute;left:-40px;top:3px;width:12px;height:12px;border:2px solid var(--red);background:var(--paper);border-radius:50%}
.lp .ev.last:before{background:var(--red)}
.lp .ev small{font:11.5px 'IBM Plex Mono',monospace;color:var(--red)}
.lp .ev p{margin:2px 0 0;font-size:18px;line-height:1.4;max-width:520px}
.lp .ev.last p{font-weight:600}

/* before / after */
.lp .ba{border:1px solid var(--ink);background:#fbf9f4}
.lp .ba>div{padding:20px 22px}
.lp .ba>div+div{border-top:1px solid var(--ink);background:#fce4e0}
.lp .ba h5{font:11px 'IBM Plex Mono',monospace;margin:0 0 12px;font-weight:400;color:var(--mut);letter-spacing:.06em;text-transform:uppercase}
.lp .ba ol{list-style:none;margin:0;padding:0}
.lp .ba li{font:13px 'IBM Plex Mono',monospace;padding:6px 0;border-bottom:1px dashed var(--line);color:var(--mut);display:flex;justify-content:space-between}
.lp .ba li:last-child{border:0;color:var(--red)}
.lp .ba .res b{font:600 18px 'IBM Plex Mono',monospace;color:#B5261C;display:block;margin-bottom:4px}
.lp .ba .res span{font:12.5px 'IBM Plex Mono',monospace;color:#7d2419}

/* battle */
.lp .bt{display:grid;grid-template-columns:120px 1fr 1fr;gap:10px 18px;align-items:center;margin-bottom:28px}
.lp .bt .h{font:11.5px 'IBM Plex Mono',monospace;color:var(--mut)}
.lp .bt .k{font:12.5px 'IBM Plex Mono',monospace}
.lp .bt .b{height:28px;background:rgba(20,18,16,.06);position:relative}
.lp .bt .b i{position:absolute;inset:0 auto 0 0;width:0;background:var(--ink);transition:width 1.3s cubic-bezier(.2,.7,.2,1)}
.lp .bt .b.r i{background:#8a7350}
.lp .bt .b em{position:absolute;left:8px;top:0;line-height:28px;font:500 12.5px 'IBM Plex Mono',monospace;font-style:normal;color:#fff;mix-blend-mode:normal;text-shadow:0 0 3px rgba(0,0,0,.4)}
.lp .seen .bt .b i{width:var(--w)}
.lp .uc{display:grid;grid-template-columns:repeat(4,1fr);margin-top:48px;border-top:1px solid var(--ink)}
.lp .uc div{padding:16px 20px 0 0;margin-right:20px}
.lp .uc div+div{border-left:1px solid var(--line);padding-left:20px}
.lp .uc h3{font-size:20px;margin:0 0 4px;font-weight:600}.lp .uc p{font-size:15.5px;margin:0;color:#4a443b;line-height:1.45}

/* console */
.lp .con{background:#0d0c0b;color:#e9e2d2;padding:64px clamp(16px,6vw,96px)}
.lp .con h2{color:#fff}
.lp .con .live{display:flex;justify-content:space-between;font:12px 'IBM Plex Mono',monospace;color:#9c9484;border-bottom:1px solid #2b2925;padding-bottom:10px;margin-top:28px}
.lp .con .live b{font-weight:400;color:#ff6b62}.lp .con .live b:before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff6b62;margin-right:8px;animation:pl 1.4s infinite}
@keyframes pl{50%{opacity:.25}}
.lp .lg{display:grid;grid-template-columns:90px 130px 1fr 90px 90px;gap:12px;padding:10px 0;border-bottom:1px solid #1c1a17;font:13px 'IBM Plex Mono',monospace;animation:in .5s}
@keyframes in{from{background:#2a1512;transform:translateX(-8px)}}
.lp .lg span:nth-child(1){color:#8b8578}.lp .lg span:nth-child(3){color:#ff8b83}.lp .lg span:nth-child(4),.lp .lg span:nth-child(5){text-align:right;color:#9c9484}

/* cases */
.lp .cs{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink)}
.lp .cs>div{padding:22px 26px 0 0;margin-right:26px;display:flex;flex-direction:column;gap:8px}
.lp .cs>div+div{border-left:1px solid var(--line);padding-left:26px}
.lp .cs h3{font-size:24px;font-weight:600;margin:0;letter-spacing:-.01em}.lp .cs p{font-size:17px;line-height:1.45;color:#4a443b;margin:0}
.lp .cs .m{color:var(--red);font-size:13px;margin-top:auto;padding-top:8px}

.lp .band{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:48px clamp(16px,6vw,96px);background:var(--red);color:#fff}
.lp .band p{font-size:clamp(26px,3.4vw,40px);font-weight:700;letter-spacing:-.025em;margin:0}
.lp .band .cta{background:#fff;color:#0d0c0b;border-color:#fff}.lp .band .cta:hover{background:#0d0c0b;color:#fff}
.lp .foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:20px clamp(16px,6vw,96px);font:13px 'IBM Plex Mono',monospace;color:var(--mut)}

/* typography + motion */
.lp{font-size:18px;line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-optical-sizing:auto}
.lp h1,.lp h2,.lp h3{text-wrap:balance;font-feature-settings:'kern','liga','lnum'}
.lp p{text-wrap:pretty}
.lp .nav:after{content:'';position:absolute;left:0;bottom:-1px;width:100%;height:2px;background:var(--red);transform:scaleX(var(--p,0));transform-origin:left}
.lp .links a.on{color:var(--red);border-color:var(--red)}
.lp .cta .ar{display:inline-block;font-style:normal;transition:transform .25s cubic-bezier(.2,.8,.2,1)}.lp .cta:hover .ar{transform:translateX(5px)}
.lp .lab:before{content:'';display:inline-block;width:26px;height:1px;background:var(--red);vertical-align:middle;margin-right:10px;transform:scaleX(0);transform-origin:left;transition:transform .9s .25s cubic-bezier(.2,.8,.2,1)}.lp .lab.in:before{transform:none}
.lp.js [data-rv]{opacity:0;transform:translateY(28px);filter:blur(6px);transition:opacity 1.2s cubic-bezier(.16,1,.3,1),transform 1.2s cubic-bezier(.16,1,.3,1),filter 1.2s cubic-bezier(.16,1,.3,1)}
.lp.js [data-rv].in{opacity:1;transform:none;filter:none}
.lp.js h2[data-rv]{opacity:1;transform:none;filter:none}
.lp.js [data-stag]>*,.lp.js .tax[data-stag]>button{opacity:0;transform:translateY(32px);transition:opacity 1s cubic-bezier(.16,1,.3,1) var(--d,0s),transform 1.1s cubic-bezier(.16,1,.3,1) var(--d,0s),background .15s}
.lp.js [data-stag].in>*,.lp.js .tax[data-stag].in>button{opacity:1;transform:none}
.lp.js .trace svg{clip-path:inset(0 100% 0 0);transition:clip-path 2.6s cubic-bezier(.5,0,.15,1)}.lp .trace.in svg{clip-path:inset(0)}
.lp.js .trace span{opacity:0;transition:opacity .6s 2.1s}.lp .trace.in span{opacity:1}
.lp .sec>.bgart,.lp .con>.bgart{transform:translate3d(0,var(--py,0px),0);will-change:transform}
.lp .hero h1 .ln{display:block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em}
.lp .hero h1 .ln>*{display:block;animation:rise 1.1s cubic-bezier(.2,.8,.2,1) both}.lp .hero h1 .ln:nth-child(2)>*{animation-delay:.14s}
@keyframes rise{from{transform:translateY(105%)}}
.lp .copy>.sub,.lp .copy>.btns,.lp .copy>.facts{animation:fup .9s cubic-bezier(.2,.8,.2,1) both}.lp .copy>.sub{animation-delay:.35s}.lp .copy>.btns{animation-delay:.5s}.lp .copy>.facts{animation-delay:.65s}
@keyframes fup{from{opacity:0;transform:translateY(16px)}}
.lp .art img{animation:artIn 1.8s ease both}@keyframes artIn{from{opacity:0}}
.lp .case{animation:print 1s cubic-bezier(.3,.7,.2,1) .5s both}
@keyframes print{from{clip-path:inset(0 -80px 100% -80px)}to{clip-path:inset(-80px)}}
.lp .rep .body{animation:swap .45s cubic-bezier(.2,.8,.2,1)}@keyframes swap{from{opacity:0;transform:translateY(8px)}}

/* before / after */
.lp .ba2{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--ink)}
.lp .bef,.lp .aft{padding:22px;min-height:350px;display:flex;flex-direction:column}
.lp .aft{background:#0d0c0b;color:#f3ecdc}
.lp .ba2 h5{margin:0 0 20px;font:400 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}.lp .aft h5{color:#9c9484}
.lp .bef ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.lp .bef li{display:flex;align-items:baseline;gap:10px;font:13px 'IBM Plex Mono',monospace;color:var(--mut)}
.lp .bef li b{font:600 46px/1 'Newsreader',serif;letter-spacing:-.03em;color:#b3a993;min-width:1.6ch}
.lp .bef li.q b{color:var(--red);font-size:64px}
.lp .aft .one{font:600 58px/1 'Newsreader',serif;letter-spacing:-.04em}
.lp .aft .cod{font:600 17px 'IBM Plex Mono',monospace;color:#ff6b62;margin:14px 0 12px;text-transform:uppercase}
.lp .aft .m{margin:0;font:13.5px/1.75 'IBM Plex Mono',monospace;color:#d8cfbb}
.lp .aft .tags{margin-top:auto;padding-top:18px;display:flex;flex-wrap:wrap;gap:4px 12px;font:12px 'IBM Plex Mono',monospace;color:#f3ecdc}

/* neutral trade-off note */
.lp .trade{border:1px solid var(--ink);background:var(--paper);padding:20px 24px;max-width:560px}
.lp .trade small{font:11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--red)}
.lp .trade .tw{display:flex;gap:40px;margin:12px 0;flex-wrap:wrap}
.lp .trade .tw span{font:12.5px 'IBM Plex Mono',monospace;color:var(--mut)}
.lp .trade strong{display:block;font:600 42px/1 'Newsreader',serif;letter-spacing:-.03em;color:var(--ink)}
.lp .trade p{margin:0;font-size:17px;line-height:1.45;color:#4a443b}
@media(max-width:560px){.lp .ba2{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.lp [data-rv],.lp [data-stag]>*,.lp .tax[data-stag]>button{opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important}.lp .trace svg,.lp .trace span{clip-path:none!important;opacity:1!important}.lp .lab:before{transform:none}}

/* premium pass */
.lp h2 .w{display:inline-block;overflow:hidden;vertical-align:top;padding:0 .04em .14em;margin:0 -.04em -.14em}
.lp h2 .w>span{display:inline-block;transform:translateY(115%);transition:transform 1.2s cubic-bezier(.16,1,.3,1)}
.lp h2.in .w>span{transform:none}
.lp .cta{position:relative;isolation:isolate;overflow:hidden}
.lp .cta:before{content:'';position:absolute;inset:0;z-index:-1;background:var(--red);transform:translateY(101%);transition:transform .5s cubic-bezier(.16,1,.3,1)}
.lp .cta:hover:before{transform:none}
.lp .cta:hover{background:#0d0c0b;border-color:var(--red)}
.lp .cta.ghost:before{background:var(--ink)}.lp .cta.ghost:hover{background:transparent;color:#fff;border-color:var(--ink)}
.lp .band .cta:before{display:none}
.lp .tax .cf i{width:0;transition:width 1.6s cubic-bezier(.16,1,.3,1) calc(var(--d,0s) + .35s)}.lp .tax.in .cf i{width:var(--w)}
.lp .art{transform-origin:62% 50%;animation:kb 28s ease-in-out infinite alternate}
@keyframes kb{to{transform:scale(1.03) translate3d(-8px,-5px,0)}}
.lp .nav{transition:background .4s,box-shadow .4s,height .4s cubic-bezier(.16,1,.3,1)}
.lp.sc .nav{height:56px;background:rgba(248,245,239,.8);backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 12px 28px -22px rgba(60,45,20,.55)}
@media(prefers-reduced-motion:reduce){.lp h2 .w>span{transform:none!important}.lp .tax .cf i{width:var(--w)!important}}

@media(max-width:1100px){.lp .brand span{display:none}.lp .cols{grid-template-columns:1fr;gap:48px}.lp .hero{display:block;padding:48px 20px 40px}.lp .hero:before{display:none}.lp .art{position:relative;height:auto;width:calc(100% + 40px);margin:28px -20px 0}.lp .copy{max-width:640px}.lp .case{position:relative;right:auto;top:auto;translate:none;width:min(440px,100%);min-width:0;margin:-24px auto 0}.lp .tax{grid-template-columns:repeat(2,1fr)}.lp .uc{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){.lp .links a{display:none}.lp .sec{padding:56px 20px}.lp .bgart{opacity:.2!important;width:44vw!important}.lp .cs,.lp .uc{grid-template-columns:1fr}.lp .cs>div,.lp .uc div{margin:0;padding:18px 0!important;border-left:0!important;border-bottom:1px solid var(--line)}.lp .lg{grid-template-columns:70px 1fr 70px}.lp .lg span:nth-child(2),.lp .lg span:nth-child(5){display:none}.lp .bt{grid-template-columns:1fr 1fr}.lp .bt .k{grid-column:span 2}.lp .bt .h:first-child{display:none}.lp .verd{grid-template-columns:1fr 1fr}.lp .verd .p{text-align:left}}
@media(max-width:560px){.lp .tax{grid-template-columns:1fr}}
@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media(prefers-reduced-motion:reduce){.lp *{animation:none!important;transition:none!important}.lp .pb i{width:var(--to,100%)}.lp .chain .ln{transform:none}.lp .chain .ev{opacity:1}.lp .bt .b i{width:var(--w)}}
`;

/* ---------- helpers ---------- */
const hex = (n) => ((n * 2654435761) >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
const money = (v) => '$' + v.toFixed(6);

const useReduced = () => {
  const [r, s] = useState(false);
  useEffect(() => { s(window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  return r;
};
const useSeen = () => {
  const ref = useRef(null);
  const [seen, set] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { set(true); return; }
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { set(true); o.disconnect(); } }, { threshold: 0.2 });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return [ref, seen];
};

// Divider: a seeded audio trace that goes flat where the "signal" dies.
function Trace({ seed }) {
  const d = useMemo(() => {
    let s = seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const n = 140, sp = Math.floor(n * (0.4 + r() * 0.45));
    let p = '';
    for (let i = 0; i < n; i++) {
      const env = i > sp ? 0.06 : 0.25 + 0.75 * Math.abs(Math.sin(i * 0.31 + seed));
      p += `${i ? 'L' : 'M'}${i * 10},${25 + (r() - 0.5) * env * 34 + (i === sp ? 20 : 0)} `;
    }
    return { p, sp, t: (0.6 + r() * 2.4).toFixed(2) };
  }, [seed]);
  return (
    <div className="trace" aria-hidden="true" data-trace>
      <svg viewBox="0 0 1400 50" preserveAspectRatio="none">
        <path d={d.p} />
        <line className="cut" x1={d.sp * 10} x2={d.sp * 10} y1="0" y2="50" />
      </svg>
      <span style={{ left: `${d.sp / 1.4}%` }}>signal lost at {d.t}s</span>
    </div>
  );
}

const Wave = ({ dead, n = 34 }) => (
  <div className={`wave ${dead ? 'dead' : ''}`} aria-hidden="true">
    {Array.from({ length: n }).map((_, i) => (
      <i key={i} style={{ '--h': `${18 + Math.abs(Math.sin(i * 0.8) * Math.cos(i * 0.31)) * 82}%`, '--d': `${(i % 9) * 0.11}s` }} />
    ))}
  </div>
);

const Bg = ({ src, cls = '', style }) => <img className={`bgart ${cls}`} src={src} alt="" aria-hidden="true" style={style} />;

/* ---------- hero: the figure, with a live-animated case laid over it ---------- */
const NODES = [[645, 254], [646, 411], [620, 562]]; // stage nodes in the figure's 1536x1024 space
const SEGS = ['M645,254C600,290 590,340 646,411', 'M646,411C662,470 626,520 620,562', 'M620,562C612,620 620,680 617,741'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
const GL = { ok: '✓', run: '', fail: '✕', wait: '', skip: '' };

const trace = (T, runEnd, failed) => {
  const e = failed ? clamp(1 - (T - runEnd) / 300, 0, 1) : 1;
  let p = '';
  for (let k = 0; k < 56; k++) {
    const a = e * (5 + 11 * Math.abs(Math.sin(k * 0.5 + T / 260)));
    p += `${k ? 'L' : 'M'}${((k * 140) / 55).toFixed(1)},${(18 + Math.sin(k * 1.7 + T / 90) * a).toFixed(1)}`;
  }
  return p;
};

function derive(T, f) {
  const animS = animOf(f);
  const rate = f.l / animS; // real seconds per animated second (1 unless the failure is long)
  const simT = clamp(((T - 300) / 1000) * rate, 0, f.l);
  const starts = [0, f.st[0], f.st[0] + f.st[1]];
  const runEnd = 300 + animS * 1000;
  const failed = T >= runEnd;
  const durs = starts.map((s0, j) => (j < f.s ? f.st[j] : j === f.s ? f.l - s0 : 0));
  const w = starts.map((s0, j) => (j > f.s && f.after === 'ran' ? (failed ? f.st[j] : 0) : clamp(simT - s0, 0, durs[j])));
  const st = starts.map((s0, j) => {
    if (j > f.s) return failed ? (f.after === 'ran' ? 'ok' : 'skip') : 'wait';
    if (j === f.s) return failed ? 'fail' : simT >= s0 ? 'run' : 'wait';
    return simT < s0 ? 'wait' : simT >= s0 + durs[j] ? 'ok' : 'run';
  });
  const p = w.map((x, j) => (j > f.s ? 0 : durs[j] ? (x / durs[j]) * (j === f.s ? 0.62 : 1) : 0));
  return { simT, starts, runEnd, failed, w, st, p, rate, animS };
}

function Hero({ enter }) {
  const reduced = useReduced();
  const [i, setI] = useState(2);
  const [T, setT] = useState(0);
  const f = F[i % F.length];
  const total = 300 + animOf(f) * 1000 + 500 + 2600 + 2200;
  useEffect(() => {
    if (reduced) { setI(2); setT(1e5); return; }
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      const el = now - t0;
      if (el >= total) { setI((v) => v + 1); setT(0); return; }
      setT(el);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [i, reduced, total]);

  const d = derive(T, f);
  const aT = T - d.runEnd - 500;            // autopsy clock
  const evN = clamp(Math.floor(aT / 700) + 1, 0, 3);
  const vT = aT - 2100;                     // verdict clock
  const vp = ease(vT / 900);
  const verdict = vT > 0;
  const hit = T >= d.runEnd && T < d.runEnd + 450;
  const status = !d.failed ? 'RUNNING' : aT < 0 ? 'FAILURE DETECTED' : !verdict ? 'ANALYZING' : 'AUTOPSY COMPLETE';
  const pc = !d.failed ? '' : verdict ? 'ok' : 'bad';
  const [fx, fy] = NODES[f.s];
  const cause = f.n.slice(0, Math.ceil(f.n.length * clamp(vT / 500, 0, 1)));

  return (
    <section className="hero" id="top">
      <div className="art" aria-hidden="true">
        <img src={HERO_IMG} alt="" />
        <svg className="ov" viewBox="0 0 1536 1024">
          <defs>
            <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F8F5EF" stopOpacity="0" />
              <stop offset=".25" stopColor="#F8F5EF" stopOpacity=".78" />
              <stop offset="1" stopColor="#F8F5EF" stopOpacity=".92" />
            </linearGradient>
          </defs>
          <rect className="wash" x="450" y={fy + 16} width="360" height={1010 - fy} fill="url(#wash)" style={{ opacity: d.failed ? 1 : 0 }} />
          {SEGS.map((s, j) => (
            <g key={j}>
              <path className="sg base" d={s} />
              {d.p[j] > 0.002 && (
                <>
                  <path className="sg halo" d={s} pathLength="1" strokeDasharray="1 2" strokeDashoffset={1 - d.p[j]} />
                  <path className={`sg on ${j === f.s && d.failed ? 'bad' : j < f.s ? 'ok' : ''}`} d={s} pathLength="1" strokeDasharray="1 2" strokeDashoffset={1 - d.p[j]} />
                </>
              )}
            </g>
          ))}
          {d.failed && <path className="lead" d={`M${fx + 24},${fy}H1010`} />}
          {NODES.map(([x, y], j) => (
            <g key={j} transform={`translate(${x} ${y})`}>
              <g className={`nd ${d.st[j]}`}>
                {d.st[j] === 'run' && <circle className="pulse" r="16" />}
                {d.st[j] === 'fail' && <><circle className="ping" r="16" /><circle className="ping p2" r="16" /></>}
                <circle className="core" r="15" />
                <text y="5" textAnchor="middle">{GL[d.st[j]]}</text>
                <g transform="translate(26 -11)"><rect width="56" height="22" /><text x="28" y="15" textAnchor="middle">{STG[j]}</text></g>
              </g>
            </g>
          ))}
          {d.failed && (
            <g transform={`translate(${fx} ${fy})`}><path className="lock" d="M-38,-20V-38H-20M20,-38H38V-20M38,20V38H20M-20,38H-38V20" /></g>
          )}
        </svg>
      </div>

      <div className="copy">
        <h1><span className="ln"><span>Your voice agent failed.</span></span><span className="ln"><em>Find out exactly why.</em></span></h1>
        <p className="sub">CallAutopsy runs a call through STT, LLM and TTS with a fault injected, or reads a call you upload. It names the stage that broke, shows the evidence, and reports what the call cost.</p>
        <div className="btns">
          <button className="cta" onClick={enter}>Run an autopsy <i className="ar" aria-hidden="true">→</i></button>
          <a className="cta ghost" href="#product">See a sample autopsy</a>
        </div>
        <div className="facts">
          <div><b>7</b><span>injectable faults</span></div>
          <div><b>3</b><span>pipeline stages</span></div>
          <div><b>&lt;$0.01</b><span>measured cost per call</span></div>
        </div>
      </div>

      <aside className={`case ${d.failed ? 'bad' : ''} ${hit ? 'hit' : ''}`} aria-label="Animated example of a failed call being diagnosed">
        <div className="ch"><b>Case {hex(i + 7)}</b><span className={`sts ${pc}`}>{status}</span></div>
        <div className="cbody">
          <div className="clock">
            <span>{d.simT.toFixed(3)}<small>s</small></span>
            <svg className={`scope ${d.failed ? 'dead' : ''}`} viewBox="0 0 140 36" aria-hidden="true"><path d={trace(T, d.runEnd, d.failed)} /></svg>
          </div>
          <div className="trk">
            {[0, 1, 2].map((j) => (
              <div key={j} className={`tk ${d.st[j]}`}>
                <span className="tn">{STG[j]}</span>
                <div className="tb"><i style={{ left: `${(d.starts[j] / spanOf(f)) * 100}%`, width: `${(d.w[j] / spanOf(f)) * 100}%` }} /></div>
                <span className="ts">{d.st[j] === 'ok' ? `${f.st[j].toFixed(3)}s` : d.st[j] === 'fail' ? 'dead' : d.st[j] === 'skip' ? 'skipped' : d.st[j] === 'run' ? '…' : ''}</span>
              </div>
            ))}
            <div className="axis"><span /><div>{[0, 0.25, 0.5, 0.75].map((q) => <em key={q} style={{ left: `${q * 100}%` }}>{Math.round(q * spanOf(f))}s</em>)}</div><span /></div>
          </div>
          <div className="evd">
            <h6>Evidence</h6>
            {d.failed && <span key={verdict ? 'v' : 'f'} className="stamp">{verdict ? 'Cause found' : 'Flagged'}</span>}
            {f.ev.map((e, k) => <p key={e} className={k < evN ? 'on' : ''}><b>E{k + 1}</b>{e}</p>)}
          </div>
          <div className={`vd ${verdict ? 'on' : ''}`}>
            <div className="cod"><small>Cause of failure</small><b>{cause}</b></div>
            <div className="meter">{Array.from({ length: 10 }).map((_, k) => <i key={k} className={k < Math.round((f.c * vp) / 10) ? 'on' : ''} />)}</div>
            <div className="lf"><span>Rule confidence</span><i /><b>{((f.c * vp) / 100).toFixed(2)}</b></div>
            <div className="lf"><span>Cost</span><i /><b>{money(f.cost * vp)}</b></div>
            <div className="lf"><span>Pipeline time</span><i /><b>{(f.lat * vp).toFixed(2)}s</b></div>
          </div>
        </div>
        <div className="cfoot"><span>{f.k} · median of {f.N} runs</span><span>{d.rate > 1.05 ? `replayed ${d.rate.toFixed(1)}× faster` : 'measured values'}</span></div>
      </aside>
    </section>
  );
}

/* ---------- what can die ---------- */
function Taxonomy({ fault, pick }) {
  return (
    <section className="sec" id="features">
      <Bg src={IMG_TAX} cls="r t" style={{ top: 16, right: 0, width: 'min(72vw,940px)', opacity: 0.4 }} />
      <p className="lab" data-rv>Failure types</p>
      <h2 data-rv>Seven ways a voice call dies.</h2>
      <p className="lede" data-rv>Each one has its own detector, checked in a fixed order. Pick one to load it into the walkthrough above. The bar is the detector’s fixed confidence, not a probability.</p>
      <div className="tax" data-stag>
        {F.map((x, i) => (
          <button key={x.k} onClick={() => pick(i)} aria-label={`Load ${x.n} into the walkthrough`}>
            <div className="top"><span>{x.k}</span><span>{STG[x.s]}</span></div>
            <h3>{x.n}</h3>
            <div className="x">{x.x}</div>
            <div className="cf" title={`rule confidence ${(x.c / 100).toFixed(2)}`}><i style={{ '--w': `${x.c}%` }} /></div>
          </button>
        ))}
        <div className="note">A faulty call gets one primary cause, picked by rule order.</div>
      </div>
    </section>
  );
}

/* ---------- interactive walkthrough ---------- */
function Walk({ fi, setFi, enter }) {
  const reduced = useReduced();
  const [ref, seen] = useSeen();
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const f = F[fi];
  useEffect(() => {
    if (!auto || !seen || reduced) return;
    const id = setInterval(() => setStep((s) => (s + 1) % 4), 3600);
    return () => clearInterval(id);
  }, [auto, seen, reduced]);

  const go = (s) => { setAuto(false); setStep(s); };
  const status = ['CONFIGURING', 'RUNNING', 'FAILED', 'AUTOPSY COMPLETE'][step];
  const bar = (j) => {
    const dies = j === f.s, live = j <= f.s;
    return (
      <div className="row" key={j}>
        <span>{STG[j]}</span>
        <div className="pb"><i className={dies ? 'bad' : ''} style={{ '--to': !live ? '0%' : dies ? '62%' : '100%', '--dur': '1.2s', '--dl': `${j * 0.9}s` }} /></div>
        <em>{step === 1 ? (!live ? 'waiting' : dies ? 'stalling' : 'ok') : ''}</em>
      </div>
    );
  };

  return (
    <section className="sec alt" id="product" ref={ref}>
      <Bg src={IMG_BRAIN} cls="r" style={{ top: 0, right: 0, width: 'min(34vw,430px)' }} />
      <div id="how-it-works" />
      <p className="lab" data-rv>How it works</p>
      <h2 data-rv>Inject. Run. Diagnose. Compare.</h2>
      <p className="lede" data-rv>Choose a fault and watch its autopsy assemble from measured values.</p>
      <div className="cols">
        <div>
          <div className="chips" role="group" aria-label="Fault to inject">
            {F.map((x, i) => (
              <button key={x.k} className={`chip ${i === fi ? 'on' : ''}`} onClick={() => { setFi(i); go(1); }}>{x.n}</button>
            ))}
          </div>
          {WALK.map((w, i) => (
            <button key={w.t} className={`stp ${i === step ? 'on' : ''}`} onClick={() => go(i)}>
              <span className="n">0{i + 1}</span>
              <span><h4>{w.t}</h4><p>{w.d}</p></span>
            </button>
          ))}
        </div>

        <div className="rep" aria-live="polite" data-rv>
          <div className="bar"><span>case #{hex(fi + 7)}</span><i>{status}</i></div>
          <div className="body" key={`${step}-${fi}`}>
            {step === 0 && (
              <>
                <h5>Fault</h5>
                <p className="big">{f.n}</p>
                <h5>Default setting</h5>
                <p className="big" style={{ fontSize: 19, marginBottom: 18 }}>{f.p}</p>
                <h5>Target stage</h5>
                <p className="big">{STG[f.s]} · {PROV[f.s]}</p>
                <button className="cta" onClick={() => go(1)}>Replay this fault</button>
              </>
            )}
            {(step === 1 || step === 2) && (
              <>
                <h5>{step === 1 ? 'Call in progress' : 'Failure flagged'}</h5>
                {step === 1 ? [0, 1, 2].map(bar) : (
                  <>
                    {[0, 1, 2].map((j) => (
                      <div className="row" key={j} style={{ color: j === f.s ? '#B5261C' : j < f.s ? 'var(--ok)' : 'var(--mut)' }}>
                        <span>{STG[j]}</span>
                        <span>{j < f.s ? '✓ passed' : j === f.s ? `✕ ${f.n.toLowerCase()}` : f.after === 'ran' ? '• ran anyway' : '— not reached'}</span>
                        <em>{j < f.s || (j > f.s && f.after === 'ran') ? `${f.st[j].toFixed(2)}s` : ''}</em>
                      </div>
                    ))}
                    <p className="rec" style={{ borderColor: 'var(--red)', background: '#fce4e0' }}>Flagged at {STG[f.s]}: {f.w.toLowerCase()}.</p>
                  </>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <h5>Cause</h5>
                <p className="big" style={{ color: '#B5261C' }}>{f.n}</p>
                <div className="kv">
                  <div><h5>Rule confidence</h5><b>{(f.c / 100).toFixed(2)}</b></div>
                  <div><h5>Cost</h5><b>{money(f.cost)}</b></div>
                  <div><h5>Pipeline time</h5><b>{f.lat.toFixed(2)}s</b></div>
                </div>
                <h5>Evidence · median of {f.N} injected runs</h5>
                <ul>{f.ev.map((e) => <li key={e}>{e}</li>)}</ul>
                <div className="rec"><b style={{ fontWeight: 600 }}>Suggested fix. </b>{f.r}</div>
              </>
            )}
          </div>
        </div>
      </div>
      <p style={{ marginTop: 28 }}><button className="cta" onClick={enter}>Run an autopsy <i className="ar" aria-hidden="true">→</i></button></p>
    </section>
  );
}

/* ---------- evidence chain + before/after ---------- */
function Evidence() {
  const [ref, seen] = useSeen();
  return (
    <section className="sec" id="evidence" ref={ref}>
      <Bg src={IMG_SPINE} cls="l t" style={{ top: 0, left: 0, height: '100%', width: 'min(19vw,260px)', objectFit: 'cover', objectPosition: 'left top', opacity: 0.4 }} />
      <div className="cols">
        <div>
          <p className="lab" data-rv>Evidence</p>
          <h2 data-rv>It shows its work.</h2>
          <p className="lede" data-rv>A label alone is not a diagnosis. This is the chain behind one recorded timeout, from a real run on 30 Sep 2026.</p>
          <div className={`chain ${seen ? 'seen' : ''}`}>
            <div className="ln" />
            {EVIDENCE.map(([a, b], i) => (
              <div key={a} className={`ev ${i === EVIDENCE.length - 1 ? 'last' : ''}`} style={{ transitionDelay: `${i * 0.35}s` }}>
                <small>{a}</small><p>{b}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="lab" data-rv>Before and after</p>
          <h2 data-rv>From one recording to one answer.</h2>
          <div className="ba2" data-stag>
            <div className="bef">
              <h5>Before</h5>
              <ul>
                <li><b>1</b>recording</li>
                <li><b>1</b>total time</li>
                <li><b>1</b>invoice line</li>
                <li><b>0</b>causes</li>
                <li className="q"><b>?</b></li>
              </ul>
            </div>
            <div className="aft">
              <h5>After</h5>
              <div className="one">1 call</div>
              <div className="cod">LLM timeout</div>
              <p className="m">13.350 s against an 8 s limit</p>
              <p className="m">rule confidence 0.95</p>
              <p className="m">$0.003960</p>
              <div className="tags"><span>[ Evidence ]</span><span>[ Cause ]</span><span>[ Suggested fix ]</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- config comparison + use cases ---------- */
function Battle() {
  const [ref, seen] = useSeen();
  const pct = (a, b) => [Math.round((a / Math.max(a, b)) * 100), Math.round((b / Math.max(a, b)) * 100)];
  const rows = [
    ['Failed calls', [`${AB.a.failed} of ${AB.runs}`, `${AB.b.failed} of ${AB.runs}`], [AB.a.failed ? 100 : 2, AB.b.failed ? 100 : 2]],
    ['Pipeline time', [`${AB.a.latency.toFixed(1)}s`, `${AB.b.latency.toFixed(1)}s`], pct(AB.a.latency, AB.b.latency)],
    ['Cost per call', [`$${AB.a.cost.toFixed(4)}`, `$${AB.b.cost.toFixed(4)}`], pct(AB.a.cost, AB.b.cost)],
  ];
  const faster = Math.round((1 - AB.a.latency / AB.b.latency) * 100);
  const cheaper = Math.round((1 - AB.a.cost / AB.b.cost) * 100);
  return (
    <section className={`sec alt ${seen ? 'seen' : ''}`} id="use-cases" ref={ref}>
      <Bg src={IMG_LARYNX} cls="r" style={{ top: 0, right: 0, width: 'min(40vw,520px)' }} />
      <p className="lab" data-rv>Compare</p>
      <h2 data-rv>Same call. Two stacks. A verdict with rules.</h2>
      <p className="lede" data-rv>A real comparison: {AB.runs} runs per side on one demo call, measured 30 Sep 2026.</p>
      <div className="bt">
        <span className="h" />
        <span className="h">Config A: Deepgram + gpt-4o-mini</span>
        <span className="h">Config B: Whisper + gpt-4o</span>
        {rows.map(([k, v, w]) => [
          <span className="k" key={k}>{k}</span>,
          <div className="b" key={k + 'a'}><i style={{ '--w': `${w[0]}%` }} /><em style={w[0] < 25 ? { color: 'var(--ink)', textShadow: 'none', left: `calc(${w[0]}% + 8px)` } : undefined}>{v[0]}</em></div>,
          <div className="b r" key={k + 'b'}><i style={{ '--w': `${w[1]}%` }} /><em style={w[1] < 25 ? { color: 'var(--ink)', textShadow: 'none', left: `calc(${w[1]}% + 8px)` } : undefined}>{v[1]}</em></div>,
        ])}
      </div>
      <div className="trade" data-rv>
        <small>Verdict</small>
        <div className="tw"><span><strong>{faster}%</strong>faster with A</span><span><strong>{cheaper}%</strong>cheaper with A</span></div>
        <p>{AB.headline} Config B also failed one of its three calls (a timeout). The rules did not count that: one failure in three is below the gap they require, and three runs is a quick check, not proof.</p>
      </div>
      <div className="uc" data-stag>
        {USE_CASES.map((u) => <div key={u.t}><h3>{u.t}</h3><p>{u.d}</p></div>)}
      </div>
    </section>
  );
}

/* ---------- recorded runs, replayed ---------- */
function Stream() {
  const reduced = useReduced();
  const [n, setN] = useState(6);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setN((v) => v + 1), 2200);
    return () => clearInterval(id);
  }, [reduced]);
  const rows = Array.from({ length: 6 }, (_, k) => ({ key: n - k, r: RECORDED[(n - k) % RECORDED.length] }));
  return (
    <section className="con">
      <Bg src={IMG_AIRWAY} style={{ top: -20, right: '2%', width: 'min(24vw,300px)' }} />
      <p className="lab" style={{ color: '#ff6b62' }}>Recorded runs</p>
      <h2 data-rv>Every call, one row.</h2>
      <div className="live"><b>replay of {RECORDED.length} real runs</b><span>30 Sep 2026 · demo calls, not customer data</span></div>
      {rows.map(({ key, r }) => (
        <div className="lg" key={key}>
          <span>{r[2]}</span><span>{r[0]}</span><span style={r[1] === 'ok' ? { color: '#8fd0a8' } : undefined}>{r[1] === 'ok' ? 'healthy' : r[1]} · ${r[4].toFixed(5)}</span><span>total</span><span>{r[3]}s</span>
        </div>
      ))}
    </section>
  );
}

export default function LandingHome() {
  const nav = useNavigate();
  const [fi, setFi] = useState(2);
  const [active, setActive] = useState('');
  const root = useRef(null);

  useLayoutEffect(() => { root.current.classList.add('js'); }, []);

  // Scroll motion: word-mask headings, position-based reveals, active nav link, progress bar, parallax.
  useEffect(() => {
    const el = root.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.querySelectorAll('h2[data-rv]').forEach((h) => {
      if (h.dataset.sp) return;
      h.dataset.sp = '1';
      const words = h.textContent.trim().split(/\s+/);
      h.textContent = '';
      words.forEach((w, k) => {
        const o = document.createElement('span'); o.className = 'w';
        const n = document.createElement('span'); n.textContent = w; n.style.transitionDelay = `${k * 60}ms`;
        o.appendChild(n); h.appendChild(o);
        if (k < words.length - 1) h.appendChild(document.createTextNode(' '));
      });
    });
    el.querySelectorAll('[data-stag]').forEach((g) => [...g.children].forEach((c, k) => c.style.setProperty('--d', `${k * 80}ms`)));
    let pending = [...el.querySelectorAll('[data-rv],[data-stag],[data-trace]')];
    const so = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: '-40% 0px -55% 0px' });
    NAV.forEach((n) => { const t = document.getElementById(n.id); if (t) so.observe(t); });
    let raf = 0;
    const tick = () => {
      raf = 0;
      const h = document.documentElement;
      const vh = window.innerHeight;
      el.style.setProperty('--p', String(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)));
      el.classList.toggle('sc', h.scrollTop > 24);
      pending = pending.filter((n) => { if (n.getBoundingClientRect().top < vh * 0.92) { n.classList.add('in'); return false; } return true; });
      if (!reduce) el.querySelectorAll('.bgart').forEach((b) => { b.style.setProperty('--py', `${clamp(-b.parentElement.getBoundingClientRect().top * 0.05, -40, 40)}px`); });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    const t = setTimeout(tick, 350);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(tick);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { so.disconnect(); clearTimeout(t); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf); };
  }, []);
  const enter = () => nav('/app');
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const pick = (i) => { setFi(i); document.getElementById('product')?.scrollIntoView({ behavior: 'smooth' }); };

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
          <button className="cta" onClick={enter}>Run an autopsy <i className="ar" aria-hidden="true">→</i></button>
        </nav>
      </header>

      <Hero enter={enter} />
      <Trace seed={7} />
      <Walk fi={fi} setFi={setFi} enter={enter} />
      <Taxonomy fault={fi} pick={pick} />
      <Trace seed={23} />
      <Evidence />
      <Battle />
      <Stream />

      <section className="sec" id="case-studies">
      <Bg src={IMG_LUNGS} cls="r" style={{ top: 0, right: 0, width: 'min(28vw,340px)' }} />
        <p className="lab" data-rv>Case studies</p>
        <h2 data-rv>Three cases you can reproduce.</h2>
        <p className="lede" data-rv>Each one can be run in the live demo. The figures are from real runs.</p>
        <div className="cs" data-stag>
          {STUDIES.map((s) => (
            <div key={s.t}>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              <span className="m">{s.m}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <p>Find the failing stage.</p>
        <button className="cta" onClick={enter}>Run an autopsy <i className="ar" aria-hidden="true">→</i></button>
      </section>

      <footer className="foot">
        <span>CallAutopsy</span>
        <span>Figures are measurements from the live pipeline, 30 Sep 2026</span>
      </footer>
    </div>
  );
}