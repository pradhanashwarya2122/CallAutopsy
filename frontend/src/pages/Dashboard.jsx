import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ClipboardIcon, WaveformIcon, AlertIcon, CheckIcon, PlayIcon } from '../components/Icons';
import { Skeleton, TableSkeleton } from '../components/Skeleton';
import headAirway from '../assets/head-airway.png';

const ANATOMY_SRC = '/anatomy-sketch.jpg';
const FULLSCREEN = true;
const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
const NAV = [
  { label: 'Analyze', to: '/analyze' },
  { label: 'A/B', to: '/ab' },
  { label: 'Ops', to: '/ops' },
];
const LANDING_ROUTE = '/';
const HEAD_FLIP = false;

const CAUSES = ['bad_stt', 'hallucination', 'tts_glitch', 'timeout', 'user_hangup', 'network_drop', 'exception'];
const formatUsd = (n) => `$${Number(n || 0).toFixed(6)}`;
const formatClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const formatClockTenth = (s) => `${formatClock(s)}.${Math.floor((s % 1) * 10)}`;
const clock = (iso) => new Date(iso).toISOString().slice(11, 19);
const stamp = (iso) => `${new Date(iso).toISOString().slice(0, 10)} ${new Date(iso).toISOString().slice(11, 19)}Z`;

const RING = { stt: '#1e88ff', llm: '#14a36f', tts: '#6a5cd6' };
const STAGE_ORDER = ['stt', 'llm', 'tts'];
const CAUSE_STAGE = { bad_stt: 'stt', hallucination: 'llm', tts_glitch: 'tts' };

const CAUSE_META = {
  bad_stt: { label: 'Bad transcription', tag: 'bad_stt', tone: 'amber', text: 'Speech-to-text output diverged from what was actually said.' },
  hallucination: { label: 'Hallucination', tag: 'hallucination', tone: 'red', text: 'Model generated incorrect information not grounded in audio.' },
  tts_glitch: { label: 'TTS glitch', tag: 'tts_glitch', tone: 'red', text: 'Synthesized speech contained artifacts or dropouts.' },
  timeout: { label: 'Timeout', tag: 'timeout', tone: 'amber', text: 'A pipeline stage exceeded its latency budget.' },
  user_hangup: { label: 'User hangup', tag: 'user_hangup', tone: 'amber', text: 'Caller disconnected before the response completed.' },
  network_drop: { label: 'Network drop', tag: 'network_drop', tone: 'amber', text: 'Connection was lost mid-call.' },
  exception: { label: 'Exception', tag: 'exception', tone: 'red', text: 'An unhandled error interrupted the pipeline.' },
};
const metaFor = (cause) =>
  CAUSE_META[cause] || { label: String(cause || '').replace(/_/g, ' '), tag: cause, tone: 'red', text: 'Failure detected in this call.' };

const pct = (v) => {
  if (v === undefined || v === null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return Math.round(n <= 1 ? n * 100 : n);
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap');

.ap-root{
  --paper:#f4efe3; --panel:rgba(255,253,247,.78); --line:#d8d2c3; --ink:#15130f; --mute:#6f6a5d;
  --red:#e2372b; --red-bg:#fbd9d3; --red-line:#eb8f86; --green:#12935f; --green-bg:#d8eee2; --amber:#a5620a; --amber-bg:#f7e5bf;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace; --serif:'Newsreader',Georgia,'Times New Roman',serif;
  position:relative; overflow:hidden; overflow:clip; color:var(--ink); font-family:var(--mono); min-height:100%;
  background-color:var(--paper);
  background-image:
    linear-gradient(rgba(120,110,90,.10) 1px,transparent 1px),
    linear-gradient(90deg,rgba(120,110,90,.10) 1px,transparent 1px),
    radial-gradient(ellipse at 50% 0%,rgba(255,255,255,.5),transparent 60%);
  background-size:48px 48px,48px 48px,100% 100%;
  border-radius:4px; --pl:22px; --pr:22px; padding:0 var(--pr) 26px var(--pl);
}
.ap-root.ap-full{position:fixed;inset:0;z-index:1000;overflow-x:hidden;overflow-y:auto;border-radius:0;min-height:0}
.ap-root *{box-sizing:border-box}
.ap-root button{font-family:inherit;cursor:pointer}

.ap-fig{position:absolute;pointer-events:none;background-repeat:no-repeat;mix-blend-mode:multiply;display:none}
.ap-fig-l{left:6px;top:120px;width:196px;height:520px;
  background-image:url(${headAirway});background-size:contain;background-position:center;
  transform:${HEAD_FLIP ? 'scaleX(-1)' : 'none'};
  -webkit-mask-image:linear-gradient(${HEAD_FLIP ? '270deg' : '90deg'},#000 70%,transparent);mask-image:linear-gradient(${HEAD_FLIP ? '270deg' : '90deg'},#000 70%,transparent)}
.ap-fig-r{right:0;top:210px;width:170px;height:330px;
  background-image:url(${ANATOMY_SRC});background-size:auto 620px;background-position:-176px -36px;opacity:.85;
  -webkit-mask-image:linear-gradient(90deg,#000 60%,transparent);mask-image:linear-gradient(90deg,#000 60%,transparent)}
.ap-rail{position:absolute;left:58px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#3b372e;line-height:1.75;display:none}

@media (min-width:1024px){
  .ap-root{--pl:clamp(170px,12.4vw,260px);--pr:clamp(28px,4.4vw,80px);padding:0 var(--pr) 34px var(--pl)}
  .ap-fig,.ap-rail{display:block}
  .ap-bottom{margin-left:calc(-1 * clamp(20px,2.6vw,48px))}
}

.ap-topbar{position:sticky;top:0;z-index:60;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  margin:0 calc(-1 * var(--pr)) 0 calc(-1 * var(--pl));padding:10px var(--pr) 10px var(--pl);
  border-bottom:1px solid rgba(206,198,178,.95);border-radius:0;
  background:rgba(250,246,234,.86);-webkit-backdrop-filter:blur(16px) saturate(150%);backdrop-filter:blur(16px) saturate(150%);
  box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 14px 28px -20px rgba(60,45,20,.5)}
.ap-brand{display:flex;align-items:center;gap:10px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:#2b281f;white-space:nowrap}
.ap-brand i{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#e2372b,#f0a23a)}

.ap-head{display:block;margin-top:22px;position:relative;z-index:1;overflow:hidden;
  padding:22px 28px 22px 32px;border:1px solid rgba(206,198,178,.95);border-radius:14px;
  background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(255,250,236,.52));
  -webkit-backdrop-filter:blur(14px) saturate(140%);backdrop-filter:blur(14px) saturate(140%);
  box-shadow:0 1px 0 rgba(255,255,255,.95) inset,0 22px 44px -26px rgba(60,45,20,.4),0 2px 6px rgba(60,45,20,.06)}
/* removed: left rainbow gradient stripe */
.ap-head::after{content:'';position:absolute;right:-70px;top:-90px;width:300px;height:300px;background:radial-gradient(circle,rgba(226,55,43,.11),transparent 65%);pointer-events:none}
.ap-head > *{position:relative;z-index:1}
.ap-eyebrow{display:flex;align-items:center;gap:12px;font-size:11.5px;letter-spacing:.32em;text-transform:uppercase;color:#4a4536}
.ap-title{font-family:var(--serif);font-weight:500;font-size:48px;line-height:1;letter-spacing:-.028em;margin:10px 0 0;color:var(--ink)}
.ap-title em{font-style:italic;font-weight:400;padding-right:.06em;background:linear-gradient(100deg,#e2372b 0%,#c2410c 55%,#a5620a 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.ap-tagline{margin:12px 0 0;font-size:12px;letter-spacing:.03em;color:var(--mute)}
.ap-nav{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.ap-nav a,.ap-nav .on{font-family:var(--serif);font-size:19px;padding:9px 18px;border-radius:999px;color:var(--ink);text-decoration:none;transition:background .2s,transform .2s}
.ap-nav .on{background:#fff;border:1px solid var(--line);box-shadow:0 6px 14px -8px rgba(60,45,20,.45)}
.ap-nav a:hover{background:rgba(190,182,160,.25)}
.ap-nav .ap-landing{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(180deg,#1b2030,#0b0e15);color:#f7f3e8;margin-left:12px;padding:12px 22px;border-radius:10px;box-shadow:0 12px 24px -12px rgba(11,14,21,.75),0 1px 0 rgba(255,255,255,.14) inset}
.ap-nav .ap-landing:hover{background:linear-gradient(180deg,#232a3f,#000);transform:translateY(-1px)}

.ap-panel.lit{position:relative;overflow:hidden;box-shadow:0 18px 34px -26px rgba(60,45,20,.45)}
.ap-panel.lit::before{content:'';position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--a1,#1e88ff),var(--a2,#6a5cd6))}

.ap-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 0;position:relative;z-index:1}
.ap-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:3px;padding:4px 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
.ap-pill.bad{border-color:var(--red-line);color:var(--red)}
.ap-stat{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--mute);letter-spacing:.04em;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.6);border:1px solid var(--line)}
.ap-stat::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--dot,#8b8577)}
.ap-stat b{color:var(--ink);font-weight:600;margin-left:4px}
.ap-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px;border:1px solid var(--red-line);background:rgba(251,217,211,.55);border-radius:4px;padding:10px 14px;color:var(--red);font-size:12px;position:relative;z-index:1}
.ap-banner a{margin-left:auto;border:1px solid var(--red-line);border-radius:3px;padding:5px 10px;color:var(--red);text-decoration:none;font-size:12px}

.ap-top{display:grid;grid-template-columns:1fr;gap:14px;margin-top:18px;position:relative;z-index:1}
.ap-right{display:flex;flex-direction:column;gap:14px;min-width:0}
.ap-mid{display:grid;grid-template-columns:1fr;gap:14px}
.ap-bottom{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px;position:relative;z-index:1}
@media (min-width:1024px){
  .ap-top{grid-template-columns:246px minmax(0,1fr)}
  .ap-mid{grid-template-columns:1.12fr 1fr}
  .ap-bottom{grid-template-columns:1.12fr 1.05fr .95fr}
}

.ap-panel{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:16px 18px;min-width:0}
.ap-h{font-size:13px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:#211f18;margin:0}
.ap-sub{color:var(--mute)}

.ap-feed{padding:0}
.ap-feed .ap-h{padding:16px 16px 12px}
.ap-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:0;border-top:1px solid var(--line);padding:11px 14px 11px 16px;color:inherit}
.ap-row:hover{background:rgba(190,182,160,.16)}
.ap-row:focus-visible{outline:1px solid var(--ink);outline-offset:-2px}
.ap-row.sel.bad{background:var(--red-bg)}
.ap-row.sel.ok{background:var(--green-bg)}
.ap-row{border-left:3px solid transparent;padding-left:13px}
.ap-row.t-red{border-left-color:var(--red)}
.ap-row.t-amber{border-left-color:#e0a030}
.ap-row.t-green{border-left-color:var(--green)}
.ap-row .id{font-size:14.5px;font-weight:500}
.ap-row .t{margin-left:auto;font-size:12px;color:var(--mute);padding-left:6px}
.ap-row .body{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}
.ap-row .top{display:flex;align-items:baseline}
.ap-tag{align-self:flex-start;font-size:13px;padding:2px 9px;border-radius:3px}
.ap-tag.red{background:var(--red-bg);color:#c0301f}
.ap-tag.amber{background:var(--amber-bg);color:var(--amber)}
.ap-tag.green{background:var(--green-bg);color:#16794f}
.ap-radio{flex:none;width:20px;height:20px;border-radius:50%;border:1.6px solid #15130f;display:grid;place-items:center}
.ap-radio::after{content:'';width:7px;height:7px;border-radius:50%;background:#15130f}
.ap-radio.red{border-color:var(--red)}.ap-radio.red::after{background:var(--red)}
.ap-radio.amber{border-color:#e0a030}.ap-radio.amber::after{background:#e0a030}
.ap-radio.ok{background:var(--green);border-color:var(--green)}
.ap-radio.ok::after{background:#fff;width:6px;height:6px}
.ap-rec{border-top:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:12px}
.ap-recbtn{flex:none;width:34px;height:34px;border-radius:50%;border:1px solid #b9b2a0;background:transparent;display:grid;place-items:center}
.ap-recbtn:disabled{opacity:.4}
.ap-recbtn span{display:block;background:var(--red)}

.ap-dhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.ap-pn{display:flex;align-items:center;gap:14px;font-size:13px}
.ap-pn button{display:inline-flex;align-items:center;gap:6px;background:none;border:0;color:var(--ink);padding:2px 4px;font-size:13px}
.ap-pn button:disabled{opacity:.35;cursor:default}
.ap-facts{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;border:1px solid var(--line);border-radius:3px;padding:14px 8px;background:rgba(255,255,255,.35)}
@media (min-width:768px){.ap-facts{grid-template-columns:1.9fr 1.5fr .8fr .9fr .7fr}}
.ap-fact{padding:0 14px;border-left:1px solid var(--line);min-width:0}
.ap-fact:first-child{border-left:0}
.ap-fact small{display:block;font-size:11.5px;color:var(--mute);margin-bottom:6px;letter-spacing:.03em}
.ap-fact div{font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-fact .bad{color:var(--red)} .ap-fact .ok{color:var(--green)}

.ap-cod{display:grid;grid-template-columns:1fr;gap:16px;border:1px solid var(--red-line);background:linear-gradient(135deg,var(--red-bg),#fde6e1);border-radius:8px;padding:20px 22px;box-shadow:0 18px 34px -24px rgba(226,55,43,.55)}
.ap-cod.ok{border-color:#8ccaa9;background:var(--green-bg)}
@media (min-width:768px){.ap-cod{grid-template-columns:auto 1fr 300px}}
.ap-cod .k{font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:var(--red)}
.ap-cod.ok .k{color:var(--green)}
.ap-cod h3{font-family:var(--serif);font-weight:500;font-size:40px;line-height:1.05;margin:4px 0 10px;color:var(--red);letter-spacing:-.01em}
.ap-cod.ok h3{color:var(--green)}
.ap-cod p{margin:0;font-size:14px;line-height:1.45;color:#2b281f;max-width:420px}
.ap-cod .side{border-left:1px solid rgba(226,55,43,.28);padding-left:22px;display:flex;flex-direction:column;justify-content:space-between;gap:12px}
.ap-cod .kv{display:flex;gap:30px}
.ap-cod .kv small{display:block;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--red)}
.ap-cod .kv b{font-family:var(--serif);font-weight:500;font-size:34px;color:var(--red);line-height:1.15}
.ap-cod .kv > div + div{border-left:1px solid rgba(226,55,43,.28);padding-left:26px}
.ap-report{display:flex;align-items:center;justify-content:center;gap:10px;border:1px solid var(--red);border-radius:3px;padding:10px 14px;color:var(--red);font-family:var(--serif);font-size:19px;text-decoration:none;background:rgba(255,255,255,.2)}
.ap-report:hover{background:rgba(255,255,255,.5)}
@media (max-width:767px){.ap-cod .side{border-left:0;padding-left:0}}

.ap-stages{display:flex;align-items:center;gap:10px;margin-top:14px}
.ap-stage{position:relative;overflow:hidden;flex:1;min-width:0;border:1px solid var(--line);background:linear-gradient(180deg,color-mix(in srgb,var(--sc,#888) 12%,#fff),rgba(255,255,255,.55));border-radius:6px;padding:16px 14px 16px}
.ap-stage::before{content:'';position:absolute;left:0;right:0;top:0;height:4px;background:var(--sc,#888)}
.ap-stage.bad{border-color:var(--red);background:linear-gradient(180deg,var(--red-bg),#fde9e5)}
.ap-stage .bar{height:5px;border-radius:3px;background:rgba(21,19,15,.08);margin-top:14px;overflow:hidden}
.ap-stage .bar i{display:block;height:100%;border-radius:3px;background:var(--sc,#888)}
.ap-stage .n{font-size:17px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--sc,var(--ink))}
.ap-stage .l{font-size:19px;font-weight:500;margin-top:14px}
.ap-stage .c{font-size:13.5px;color:var(--mute);margin-top:2px}
.ap-stage .s{display:flex;align-items:center;gap:6px;font-size:14.5px;margin-top:16px;color:var(--green);white-space:nowrap}
.ap-stage.bad .s{color:var(--red)}
.ap-arrow{flex:none;color:#2b281f}

.ap-tabs{display:flex;border-bottom:1px solid var(--line);margin-top:14px}
.ap-tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:9px 20px;font-family:var(--serif);font-size:18px;color:var(--mute);margin-bottom:-1px}
.ap-tabs button.on{color:var(--ink);border-bottom-color:var(--ink);background:rgba(255,255,255,.55);border-radius:3px 3px 0 0}
.ap-wave{display:flex;align-items:center;gap:14px;margin-top:22px;min-width:0}
.ap-play{flex:none;width:48px;height:48px;border-radius:50%;border:1px solid #b9b2a0;background:rgba(255,255,255,.55);display:grid;place-items:center}
.ap-play:disabled{opacity:.4}
.ap-play.on{border:0;color:#fff;background:linear-gradient(135deg,#1e88ff,#6a5cd6);box-shadow:0 10px 20px -8px rgba(90,80,210,.7)}
.ap-play.on:disabled{opacity:.9}
.ap-bars{flex:1;min-width:0;overflow:hidden;display:flex;align-items:center;gap:2px;height:64px}
.ap-bars i{display:block;flex:1 1 0;min-width:1px;max-width:4px;border-radius:2px;background:linear-gradient(180deg,#8fb8ff,#c3a9f2)}
.ap-bars i.p{background:linear-gradient(180deg,#1e88ff,#6a5cd6)}
.ap-bars.idle i{background:#8b8577}
.ap-times{display:flex;justify-content:space-between;font-size:13px;margin-top:16px;color:#2b281f}
.ap-transcript{margin-top:16px;font-size:13px;line-height:1.6;max-height:130px;overflow:auto;white-space:pre-wrap;color:#2b281f}

.ap-select{position:relative;margin-top:14px}
.ap-select select{width:100%;appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:4px;padding:11px 36px 11px 14px;font-family:var(--mono);font-size:15px;color:var(--ink)}
.ap-select svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none}
.ap-slider{display:flex;align-items:center;gap:14px;font-size:15px;margin-top:16px}
.ap-slider .lb{width:118px;flex:none;font-family:var(--serif);font-size:18px}
.ap-slider .v{width:46px;text-align:right;flex:none}
.ap-range{-webkit-appearance:none;appearance:none;flex:1;height:3px;border-radius:2px;background:linear-gradient(to right,var(--c,#15130f) var(--pct),#cdc7b7 var(--pct));outline:none;min-width:0}
.ap-range::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border-radius:50%;background:var(--c,#0f1219);border:0;box-shadow:0 0 0 3px rgba(255,253,247,.95),0 2px 6px rgba(0,0,0,.25)}
.ap-range::-moz-range-thumb{width:17px;height:17px;border-radius:50%;background:var(--c,#0f1219);border:0}
.ap-range:focus-visible{outline:1px solid var(--ink);outline-offset:6px}

.ap-cost{display:flex;align-items:center;gap:20px;margin-top:14px}
.ap-donut{position:relative;flex:none;width:136px;height:136px;border-radius:50%}
.ap-donut::after{content:'';position:absolute;inset:22px;border-radius:50%;background:#f7f3e8}
.ap-legend{min-width:0;font-size:14px}
.ap-legend .tot{font-size:19px;font-weight:600}
.ap-legend .lb{margin-bottom:10px}
.ap-legend .r{display:grid;grid-template-columns:12px 38px 44px auto;align-items:center;gap:6px;margin-top:8px;white-space:nowrap}
.ap-legend .r i{width:12px;height:12px;border-radius:50%}
.ap-legend .r span:last-child{text-align:right}

.ap-samples-h{display:flex;align-items:center;justify-content:space-between}
.ap-samples-h .ap-h,.ap-samples-h a{white-space:nowrap}
.ap-samples-h a{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--mute);text-decoration:none}
.ap-samples-h a:hover{color:var(--ink)}
.ap-sample{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:rgba(255,255,255,.45);border-radius:4px;padding:11px 14px;margin-top:10px;font-size:14px}
.ap-sample:first-of-type{margin-top:14px}
.ap-sample button{flex:none;width:30px;height:30px;border-radius:50%;border:0;color:#fff;background:linear-gradient(135deg,#1e88ff,#6a5cd6);box-shadow:0 6px 12px -6px rgba(90,80,210,.7);display:grid;place-items:center}
.ap-sample .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ap-sample .du{margin-left:auto;padding-left:8px;color:#2b281f}
.ap-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 8px;text-align:center;font-size:12px;color:var(--mute)}
.ap-err{color:var(--red);font-size:12px;margin-top:6px;padding:0 16px 12px}

.ap-features{display:grid;grid-template-columns:1fr;gap:0;margin:72px calc(-1 * var(--pr)) 0 calc(-1 * var(--pl));padding:44px clamp(40px,6vw,100px) 44px clamp(40px,6vw,100px);border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(255,253,247,.4),rgba(244,239,227,.2));position:relative;z-index:1}
@media (min-width:768px){.ap-features{grid-template-columns:repeat(2,1fr);gap:0}}
@media (min-width:1200px){.ap-features{grid-template-columns:repeat(4,1fr)}}
.ap-feat{display:flex;gap:18px;align-items:flex-start;padding:8px 28px;min-width:0;position:relative}
@media (min-width:1200px){.ap-feat + .ap-feat::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:1px;background:var(--line)}}
.ap-feat-icon{flex:none;width:44px;height:44px;border:1.4px solid var(--red);border-radius:6px;display:grid;place-items:center;color:var(--red);background:rgba(255,255,255,.5)}
.ap-feat-body{min-width:0}
.ap-feat-t{font-family:var(--serif);font-weight:600;font-size:20px;line-height:1.2;margin:0 0 8px;letter-spacing:-.005em;color:var(--ink)}
.ap-feat-body p{margin:0;font-size:13.5px;color:var(--mute);line-height:1.55}

.ap-hiw{display:grid;grid-template-columns:1fr;gap:44px;margin-top:48px;padding-top:8px;position:relative;z-index:1}
@media (min-width:1024px){.ap-hiw{grid-template-columns:1.02fr 1fr;gap:52px}}
.ap-hiw-left,.ap-hiw-right{min-width:0}
.ap-hiw-eyebrow{display:inline-flex;align-items:center;gap:12px;font-size:11.5px;letter-spacing:.32em;text-transform:uppercase;color:#4a4536}
.ap-hiw-eyebrow b{color:var(--ink);font-weight:600}
.ap-hiw-eyebrow i{display:inline-block;width:48px;height:1px;background:var(--red)}
.ap-hiw-title{font-family:var(--serif);font-weight:600;font-size:56px;line-height:1;letter-spacing:-.028em;margin:22px 0 14px;color:var(--ink)}
.ap-hiw-tag{color:#3b372e;font-size:15px;margin:0 0 38px;max-width:580px;line-height:1.55}
.ap-steps{display:grid;grid-template-columns:1fr;gap:22px}
@media (min-width:640px){.ap-steps{grid-template-columns:repeat(2,1fr)}}
@media (min-width:1024px){.ap-steps{grid-template-columns:repeat(4,1fr);gap:14px}}
.ap-step{display:flex;gap:12px;align-items:flex-start;position:relative;min-width:0}
.ap-step-n{flex:none;width:38px;height:38px;border-radius:50%;background:#15130f;color:#f4efe3;display:grid;place-items:center;font-family:var(--serif);font-size:13.5px;font-weight:500;letter-spacing:.02em}
.ap-step:first-child .ap-step-n{background:var(--red)}
.ap-step-body{min-width:0}
.ap-step-t{font-family:var(--serif);font-weight:600;font-size:17px;margin-bottom:6px;letter-spacing:-.005em;line-height:1.2;color:var(--ink)}
.ap-step-body p{margin:0;font-size:13px;color:var(--mute);line-height:1.5}
.ap-step-arrow{position:absolute;right:-10px;top:12px;color:#b9b2a0;display:none}
@media (min-width:1024px){.ap-step-arrow{display:block}}

.ap-mini-row{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:32px;align-items:stretch}
@media (min-width:1024px){.ap-mini-row{grid-template-columns:1fr 20px 1fr 20px 1fr 20px 1fr;gap:0}}
.ap-mini-sep{display:none;color:#b9b2a0;align-self:center;justify-self:center}
@media (min-width:1024px){.ap-mini-sep{display:block}}
.ap-mini{border:1px solid var(--line);background:rgba(255,255,255,.55);border-radius:6px;padding:14px 15px;min-height:160px;display:flex;flex-direction:column;min-width:0}
.ap-mini-h{font-size:13px;color:var(--ink);margin-bottom:12px;font-weight:500;font-family:var(--mono)}
.ap-mini-select{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line);border-radius:4px;padding:9px 11px;font-size:12.5px;background:#fff;color:var(--ink);font-family:var(--mono)}
.ap-mini-slider-label{font-size:11px;color:var(--mute);margin:16px 0 8px;letter-spacing:.02em;font-family:var(--mono)}
.ap-mini-range{position:relative;height:3px;background:#cdc7b7;border-radius:2px}
.ap-mini-range i{position:absolute;left:0;top:0;bottom:0;background:#1e88ff;border-radius:2px}
.ap-mini-range::after{content:'';position:absolute;left:calc(var(--pos,50%) - 7px);top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;background:#1e88ff;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.25)}
.ap-mini-slider-val{display:flex;justify-content:flex-end;margin-top:6px;font-size:10.5px;color:var(--mute);font-family:var(--mono)}
.ap-mini-rec{display:flex;align-items:center;gap:12px;padding:4px 0;flex:1}
.ap-mini-recdot{width:36px;height:36px;border-radius:50%;background:var(--red);flex:none;box-shadow:0 0 0 4px rgba(226,55,43,.15);position:relative}
.ap-mini-recdot::after{content:'';position:absolute;inset:11px;background:#fff;border-radius:50%}
.ap-mini-recwave{flex:1;height:26px;display:flex;align-items:center;gap:1.5px;overflow:hidden}
.ap-mini-recwave i{flex:1;background:#3b372e;border-radius:1px;min-width:1px;max-width:2.5px}
.ap-mini-timeline{display:flex;gap:2px;height:11px;border-radius:3px;overflow:hidden;margin-bottom:12px}
.ap-mini-timeline span{display:block}
.ap-mini-stages{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;font-size:10.5px}
.ap-mini-stages > div{border:1px dashed var(--line);border-radius:3px;padding:7px 6px;background:transparent;display:flex;flex-direction:column;gap:2px;min-width:0;overflow:hidden;font-family:var(--mono)}
.ap-mini-stages b{font-weight:600;font-size:11px;color:var(--ink)}
.ap-mini-stages span{color:#3b372e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}
.ap-mini-cod{display:flex;gap:10px;align-items:flex-start;flex:1;padding-top:2px}
.ap-mini-cod-icon{flex:none;width:36px;height:36px;border-radius:5px;background:var(--red-bg);border:1px solid var(--red-line);display:grid;place-items:center;color:var(--red)}
.ap-mini-cod b{font-family:var(--serif);font-weight:600;font-size:16px;color:var(--red);display:block;margin-bottom:4px;line-height:1.15}
.ap-mini-cod p{margin:0;font-size:12px;color:#2b281f;line-height:1.4}

.ap-hiw-rhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap}
.ap-hiw-rhead a{color:var(--red);font-size:12.5px;text-decoration:none;letter-spacing:.02em;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;font-family:var(--mono)}
.ap-hiw-rhead a:hover{text-decoration:underline}
.ap-case{border:1px solid var(--line);background:rgba(255,253,247,.85);border-radius:8px;padding:22px 24px;box-shadow:0 22px 40px -28px rgba(60,45,20,.4);position:relative;overflow:hidden}
.ap-case-h{margin-bottom:16px}
.ap-case-h h3{font-family:var(--serif);font-weight:600;font-size:30px;margin:0 0 6px;letter-spacing:-.015em;line-height:1.1}
.ap-case-h span{font-size:12.5px;color:var(--mute);font-family:var(--mono);letter-spacing:.02em}
.ap-case-top{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px}
@media (min-width:640px){.ap-case-top{grid-template-columns:1fr auto auto}}
.ap-case-cod{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--red-line);background:linear-gradient(135deg,var(--red-bg),#fde6e1);border-radius:6px;padding:14px 16px}
.ap-case-cod-icon{flex:none;width:38px;height:38px;border-radius:6px;background:rgba(255,255,255,.6);border:1px solid var(--red-line);display:grid;place-items:center;color:var(--red)}
.ap-case-cod small{display:block;font-size:11.5px;color:var(--red);margin-bottom:3px;font-family:var(--mono);letter-spacing:.01em}
.ap-case-cod b{font-family:var(--serif);font-weight:600;font-size:22px;color:var(--red);display:block;margin-bottom:6px;line-height:1.1}
.ap-case-cod p{margin:0;font-size:12.5px;color:#2b281f;line-height:1.5;font-family:var(--mono)}
.ap-case-metric{border:1px solid var(--line);border-radius:6px;padding:10px 14px;background:rgba(255,255,255,.6);min-width:110px;font-family:var(--mono)}
.ap-case-metric small{display:block;font-size:11px;color:var(--mute);margin-bottom:4px;letter-spacing:.01em}
.ap-case-metric b{font-size:15px;color:var(--ink);font-weight:600}
.ap-case-providers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.ap-case-providers > div{border:1px solid var(--line);border-radius:6px;padding:9px 12px;background:rgba(255,255,255,.6);min-width:0;font-family:var(--mono)}
.ap-case-providers small{display:block;font-size:10.5px;color:var(--mute);margin-bottom:3px;letter-spacing:.02em}
.ap-case-providers b{display:block;font-size:13px;font-weight:600;margin-bottom:3px;color:var(--ink)}
.ap-case-providers span{font-size:11px;color:var(--mute)}
.ap-case-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
.ap-case-tabs button{background:none;border:0;padding:9px 12px;font-size:12.5px;color:var(--mute);border-bottom:2px solid transparent;margin-bottom:-1px;font-family:var(--mono)}
.ap-case-tabs button.on{color:var(--ink);border-bottom-color:var(--ink);font-weight:500}
.ap-case-body{min-height:120px}
.ap-case-transcript{display:grid;grid-template-columns:1fr;gap:10px;align-items:stretch}
@media (min-width:640px){.ap-case-transcript{grid-template-columns:1fr 24px 1fr}}
.ap-case-bubble{border:1px solid var(--line);background:rgba(255,255,255,.7);border-radius:6px;padding:12px 14px;min-width:0;display:flex;flex-direction:column;gap:8px}
.ap-case-bubble.bad{border-color:var(--red-line);background:linear-gradient(135deg,var(--red-bg),#fde6e1)}
.ap-case-bubble small{display:block;font-size:11px;color:var(--mute);letter-spacing:.02em;font-family:var(--mono)}
.ap-case-bubble.bad small{color:var(--red)}
.ap-case-wavemini{height:24px;display:flex;align-items:center;gap:1.5px;overflow:hidden}
.ap-case-wavemini i{flex:1;background:#3b372e;border-radius:1px;min-width:1px;max-width:2.5px}
.ap-case-bubble.bad .ap-case-wavemini i{background:var(--red)}
.ap-case-bubble p{margin:0;font-size:12.5px;line-height:1.5;color:#2b281f;font-family:var(--mono)}
.ap-case-bubble.bad p{color:#7a2418}
.ap-case-arrow{color:#b9b2a0;justify-self:center;align-self:center}
.ap-case-simple{padding:18px;font-size:13px;color:#2b281f;border:1px dashed var(--line);border-radius:6px;line-height:1.55;background:rgba(255,255,255,.35);font-family:var(--mono)}
`;

const Svg = ({ children, size = 16, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);
const ArrowRight = (p) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const ArrowLeft = (p) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
const ChevL = (p) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>;
const ChevR = (p) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
const ChevDown = (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
const WarnTri = (p) => <Svg {...p} strokeWidth="1.6"><path d="M12 3.5l9.5 16.5h-19L12 3.5z" /><path d="M12 10v4.5M12 17.4v.1" /></Svg>;
const XCircle = (p) => (
  <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Tick = (p) => <Svg {...p} strokeWidth="2.4"><path d="M4 12.5l5 5L20 6.5" /></Svg>;
const PlaySolid = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
);
const StopSolid = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>
);

function SlaPill({ stats }) {
  if (!stats) return <Skeleton className="h-6 w-20" />;
  const breached = stats.failure_rate > stats.sla_target_rate;
  return (
    <span className={`ap-pill ${breached ? 'bad' : ''}`}>
      {breached ? <AlertIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
      {breached ? 'SLA breach' : 'SLA OK'}
    </span>
  );
}

function SlaBanner({ stats }) {
  if (!stats) return null;
  if (stats.failure_rate <= stats.sla_target_rate) return null;
  return (
    <div className="ap-banner">
      <AlertIcon className="h-5 w-5" />
      <strong style={{ letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>SLA breach</strong>
      <span>Failure rate {stats.failure_rate.toFixed(1)}% exceeds target {stats.sla_target_rate}%</span>
      <Link to="/analyze?tab=calibration">View failed calls</Link>
    </div>
  );
}

function StatsRibbon({ stats }) {
  if (!stats) return <Skeleton className="h-4 w-64" />;
  return (
    <>
      <span className="ap-stat" style={{ '--dot': '#1e88ff' }}>Total calls<b>{stats.total_calls.toLocaleString()}</b></span>
      <span className="ap-stat" style={{ '--dot': '#e2372b' }}>Failures<b>{stats.failures.toLocaleString()} ({stats.failure_rate.toFixed(1)}%)</b></span>
      <span className="ap-stat" style={{ '--dot': '#6a5cd6' }}>Avg latency<b>{stats.avg_latency_s.toFixed(2)}s</b></span>
      <span className="ap-stat" style={{ '--dot': '#f0a23a' }}>Total cost<b>${stats.total_cost_usd.toFixed(6)}</b></span>
    </>
  );
}

function LiveRecorder({ fault, onComplete }) {
  const [status, setStatus] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  useEffect(() => {
    if (status !== 'recording') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);
  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus('uploading');
        api.submitRecording(new Blob(chunks.current, { type: rec.mimeType }), fault)
          .then(onComplete)
          .catch(() => setError('Upload failed. Check your connection and record again.'))
          .finally(() => { setStatus('idle'); setSeconds(0); });
      };
      recorder.current = rec;
      setSeconds(0);
      rec.start();
      setStatus('recording');
    } catch {
      setStatus('error');
      setError('Microphone blocked. Allow access in your browser settings, then try again.');
    }
  };
  const stop = () => recorder.current?.stop();
  const recording = status === 'recording';
  return (
    <>
      <div className="ap-rec">
        <button
          type="button"
          className="ap-recbtn"
          onClick={recording ? stop : start}
          disabled={status === 'uploading'}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
        >
          <span style={recording ? { width: 12, height: 12, borderRadius: 2 } : { width: 13, height: 13, borderRadius: '50%' }} />
        </button>
        <WaveformIcon className={`h-6 flex-1 ${recording ? 'animate-pulse' : ''}`} style={{ color: recording ? '#15130f' : '#a19a88' }} />
        <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{formatClock(seconds)}</span>
      </div>
      <p className="ap-sub" role="status" style={{ fontSize: 11.5, padding: '0 16px 12px', margin: 0 }}>
        {status === 'uploading' ? 'Analyzing call…' : recording ? 'Recording' : 'Ready to record'}
      </p>
      {error && <p className="ap-err" role="alert">{error}</p>}
    </>
  );
}

function RecentCalls({ cases, selectedId, onSelect, fault, onRecorded }) {
  return (
    <section className="ap-panel ap-feed">
      <h2 className="ap-h">Recent calls</h2>
      {cases === null ? (
        <div style={{ padding: '0 16px 12px' }}><TableSkeleton /></div>
      ) : cases.length === 0 ? (
        <div className="ap-empty" style={{ borderTop: '1px solid var(--line)' }}>
          <ClipboardIcon className="h-6 w-6" />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)' }}>No calls yet</p>
          <p style={{ margin: 0 }}>Record a call or run a sample to see it here.</p>
        </div>
      ) : (
        <div>
          {cases.map((c) => {
            const failed = !!c.cause_of_death;
            const meta = failed ? metaFor(c.cause_of_death) : null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`ap-row t-${failed ? meta.tone : 'green'} ${c.id === selectedId ? `sel ${failed ? 'bad' : 'ok'}` : ''}`}
              >
                <span className={`ap-radio ${failed ? meta.tone : 'ok'}`} />
                <span className="body">
                  <span className="top">
                    <span className="id">{c.id.slice(0, 8)}</span>
                    <span className="t">{clock(c.created_at)}</span>
                  </span>
                  <span className={`ap-tag ${failed ? meta.tone : 'green'}`}>{failed ? meta.tag : 'success'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <LiveRecorder fault={fault} onComplete={onRecorded} />
    </section>
  );
}

function CallDetails({ detail, loading, cases, selectedId, onSelect }) {
  const idx = cases ? cases.findIndex((c) => c.id === selectedId) : -1;
  const prev = idx > 0 ? cases[idx - 1] : null;
  const next = idx >= 0 && cases && idx < cases.length - 1 ? cases[idx + 1] : null;
  const total = detail?.duration_s ?? detail?.stages?.reduce((n, s) => n + s.latency_s, 0) ?? 0;
  const cost = detail?.cost_usd ?? detail?.stages?.reduce((n, s) => n + s.cost_usd, 0) ?? 0;
  const failed = !!detail?.cause_of_death;

  return (
    <section className={`ap-panel ${detail && !loading ? 'lit' : ''}`} style={{ '--a1': '#1e88ff', '--a2': '#6a5cd6' }}>
      <div className="ap-dhead">
        <h2 className="ap-h">Call details</h2>
        <div className="ap-pn">
          <button type="button" disabled={!prev} onClick={() => prev && onSelect(prev.id)}><ChevL size={14} /> Prev</button>
          <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
          <button type="button" disabled={!next} onClick={() => next && onSelect(next.id)}>Next <ChevR size={14} /></button>
        </div>
      </div>
      {loading || !detail ? (
        loading ? <Skeleton className="h-14 w-full" /> : (
          <div className="ap-empty"><WaveformIcon className="h-6 w-6" /><span>Select a call to see its case file.</span></div>
        )
      ) : (
        <div className="ap-facts">
          <div className="ap-fact"><small>Call ID</small><div title={detail.id}>{detail.id}</div></div>
          <div className="ap-fact"><small>Time</small><div>{stamp(detail.created_at)}</div></div>
          <div className="ap-fact"><small>Duration</small><div style={{ color: '#1e6fd9' }}>{total.toFixed(2)}s</div></div>
          <div className="ap-fact"><small>Cost</small><div style={{ color: '#5b4bc4' }}>{formatUsd(cost)}</div></div>
          <div className="ap-fact"><small>Status</small><div className={failed ? 'bad' : 'ok'}>{failed ? 'Failed' : 'Success'}</div></div>
        </div>
      )}
    </section>
  );
}

function CauseOfDeath({ detail, loading, selectedId }) {
  if (loading || !detail) return null;
  if (!detail.cause_of_death) {
    return (
      <section className="ap-cod ok">
        <CheckIcon className="h-12 w-12" style={{ color: 'var(--green)' }} />
        <div>
          <div className="k">Verdict</div>
          <h3>Healthy</h3>
          <p>No fault detected across the STT, LLM and TTS stages of this call.</p>
        </div>
        <div />
      </section>
    );
  }
  const meta = metaFor(detail.cause_of_death);
  const confidence = pct(detail.confidence ?? detail.cause_confidence);
  const impact = detail.impact ?? detail.severity ?? 'High';
  const text = detail.cause_explanation || detail.explanation || detail.summary || meta.text;
  return (
    <section className="ap-cod">
      <WarnTri size={62} style={{ color: 'var(--red)', alignSelf: 'center' }} />
      <div>
        <div className="k">Cause of death</div>
        <h3>{meta.label}</h3>
        <p>{text}</p>
      </div>
      <div className="side">
        <div className="kv">
          <div><small>Confidence</small><b>{confidence === null ? '—' : `${confidence}%`}</b></div>
          <div><small>Impact</small><b style={{ textTransform: 'capitalize' }}>{impact}</b></div>
        </div>
        <Link to={`/analyze?case=${selectedId}`} className="ap-report">View full report <ArrowRight size={18} /></Link>
      </div>
    </section>
  );
}

function StageTimeline({ detail, loading }) {
  const total = detail?.stages?.reduce((n, s) => n + s.latency_s, 0) ?? 0;
  const failStage = detail?.cause_of_death ? CAUSE_STAGE[detail.cause_of_death] : null;
  const ordered = useMemo(() => {
    if (!detail?.stages) return [];
    return [...detail.stages].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }, [detail]);

  return (
    <section className={`ap-panel ${detail && total > 0 && !loading ? 'lit' : ''}`} style={{ '--a1': '#14a36f', '--a2': '#1e88ff' }}>
      <h2 className="ap-h">Stage timeline &amp; metrics</h2>
      {loading ? (
        <div style={{ marginTop: 14 }}><Skeleton className="h-24 w-full" /></div>
      ) : !detail || total === 0 ? (
        <div className="ap-empty">
          <WaveformIcon className="h-6 w-6" />
          <span>Select a call in the feed to see where its time and money went.</span>
        </div>
      ) : (
        <div className="ap-stages" role="img" aria-label={`Total ${total.toFixed(3)} seconds`}>
          {ordered.map((s, i) => {
            const bad = s.stage === failStage || s.status === 'failed' || !!s.error;
            return (
              <div key={s.stage} style={{ display: 'contents' }}>
                <div className={`ap-stage ${bad ? 'bad' : ''}`} style={{ '--sc': bad ? '#e2372b' : RING[s.stage] }} title={s.provider}>
                  <div className="n">{s.stage}</div>
                  <div className="l">{s.latency_s.toFixed(3)}s</div>
                  <div className="c">{formatUsd(s.cost_usd)}</div>
                  <div className="s">
                    {bad ? <XCircle size={17} /> : <Tick size={17} />}
                    {bad ? metaFor(detail.cause_of_death).label : 'Success'}
                  </div>
                  <div className="bar" title={`${Math.round((s.latency_s / total) * 100)}% of call time`}><i style={{ width: `${Math.max(4, Math.round((s.latency_s / total) * 100))}%` }} /></div>
                </div>
                {i < ordered.length - 1 && <ArrowRight size={20} className="ap-arrow" />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function seededBars(seed, n = 44) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = [];
  for (let i = 0; i < n; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const r = ((h >>> 0) % 1000) / 1000;
    const env = Math.sin((i / (n - 1)) * Math.PI) * 0.55 + 0.35;
    out.push(Math.max(0.1, Math.min(1, r * env * 1.4)));
  }
  return out;
}

function WaveformPanel({ detail, loading }) {
  const [tab, setTab] = useState('audio');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audio = useRef(null);
  const src = detail?.audio_url || detail?.audio || null;
  const duration = detail?.duration_s ?? detail?.stages?.reduce((n, s) => n + s.latency_s, 0) ?? 0;
  const bars = useMemo(() => seededBars(detail?.id || 'none'), [detail?.id]);

  useEffect(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
    setProgress(0);
  }, [detail?.id]);
  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    if (!src) return;
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    if (!audio.current) {
      const a = new Audio(src);
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => { setPlaying(false); setProgress(0); };
      audio.current = a;
    }
    audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const transcript = Array.isArray(detail?.transcript)
    ? detail.transcript.map((t) => (typeof t === 'string' ? t : `${t.speaker ? `${t.speaker}: ` : ''}${t.text}`)).join('\n')
    : detail?.transcript;

  return (
    <section className={`ap-panel ${detail && !loading ? 'lit' : ''}`} style={{ '--a1': '#6a5cd6', '--a2': '#d24fa0' }}>
      <h2 className="ap-h">Waveform &amp; transcript</h2>
      <div className="ap-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'audio'} className={tab === 'audio' ? 'on' : ''} onClick={() => setTab('audio')}>Audio</button>
        <button type="button" role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>Transcript</button>
      </div>
      {loading ? (
        <div style={{ marginTop: 20 }}><Skeleton className="h-16 w-full" /></div>
      ) : tab === 'audio' ? (
        <>
          <div className="ap-wave">
            <button type="button" className={`ap-play ${detail ? 'on' : ''}`} onClick={toggle} disabled={!src} aria-label={playing ? 'Pause audio' : 'Play audio'}>
              {playing ? <StopSolid size={16} /> : <PlaySolid size={20} />}
            </button>
            <div className={`ap-bars ${detail ? '' : 'idle'}`} aria-hidden="true">
              {bars.map((b, i) => (
                <i key={i} className={i / bars.length < progress ? 'p' : ''} style={{ height: `${Math.round(b * 100)}%` }} />
              ))}
            </div>
          </div>
          <div className="ap-times">
            <span>{formatClock(progress * duration)}</span>
            <span>{formatClockTenth(duration)}</span>
          </div>
        </>
      ) : (
        <div className="ap-transcript">{transcript || 'No transcript available for this call.'}</div>
      )}
    </section>
  );
}

function Slider({ label, min, max, step, value, suffix = '', color, onChange }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <label className="ap-slider">
      <span className="lb">{label}</span>
      <input
        className="ap-range"
        type="range" min={min} max={max} step={step} value={value}
        style={{ '--pct': `${p}%`, '--c': color }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="v">{value}{suffix}</span>
    </label>
  );
}

function FaultInjection({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <section className="ap-panel">
      <h2 className="ap-h">Fault injection</h2>
      <div className="ap-select">
        <select value={value.fault} onChange={(e) => set('fault', e.target.value)} aria-label="Fault type">
          {CAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <ChevDown size={16} />
      </div>
      <Slider label="Temperature"  min={0} max={2}    step={0.1} value={value.temperature}    color="#f08a24" onChange={(v) => set('temperature', v)} />
      <Slider label="Corruption %" min={0} max={100}  step={1}   value={value.corruption_pct} suffix="%" color="#e2372b" onChange={(v) => set('corruption_pct', v)} />
      <Slider label="Delay (ms)"   min={0} max={5000} step={50}  value={value.delay_ms}       color="#1e88ff" onChange={(v) => set('delay_ms', v)} />
    </section>
  );
}

function CostBreakdown({ detail, loading }) {
  const total = detail?.stages?.reduce((n, s) => n + s.cost_usd, 0) ?? 0;
  const ordered = detail?.stages
    ? [...detail.stages].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
    : [];
  let ring = '#e4dfd0';
  if (detail && total > 0) {
    let acc = 0;
    ring = `conic-gradient(${ordered.map((s) => {
      const from = acc;
      acc += (s.cost_usd / total) * 100;
      return `${RING[s.stage]} ${from}% ${acc}%`;
    }).join(', ')})`;
  }
  return (
    <section className={`ap-panel ${detail && total > 0 && !loading ? 'lit' : ''}`} style={{ '--a1': '#f0a23a', '--a2': '#e2372b' }}>
      <h2 className="ap-h">Cost breakdown</h2>
      {loading ? (
        <div style={{ marginTop: 14 }}><Skeleton className="h-28 w-full" /></div>
      ) : !detail || total === 0 ? (
        <p className="ap-sub" style={{ fontSize: 12, marginTop: 16 }}>No cost data for this call yet.</p>
      ) : (
        <div className="ap-cost">
          <div className="ap-donut" style={{ background: ring }} role="img" aria-label={`Total cost ${formatUsd(total)}`} />
          <div className="ap-legend">
            <div className="tot">{formatUsd(total)}</div>
            <div className="lb">Total Cost</div>
            {ordered.map((s) => (
              <div key={s.stage} className="r">
                <i style={{ background: RING[s.stage] }} />
                <span style={{ textTransform: 'uppercase' }}>{s.stage}</span>
                <span>{Math.round((s.cost_usd / total) * 100)}%</span>
                <span>{formatUsd(s.cost_usd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SampleLibrary({ samples }) {
  const [playingId, setPlayingId] = useState(null);
  const audio = useRef(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (s) => {
    audio.current?.pause();
    if (playingId === s.id) return setPlayingId(null);
    const a = new Audio(s.url);
    a.onended = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
    audio.current = a;
    setPlayingId(s.id);
  };
  return (
    <section className="ap-panel">
      <div className="ap-samples-h">
        <h2 className="ap-h">Sample library</h2>
        <Link to="/app">View all <ArrowRight size={14} /></Link>
      </div>
      {samples === null ? (
        <div style={{ marginTop: 14 }} className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : samples.length === 0 ? (
        <p className="ap-sub" style={{ fontSize: 12, marginTop: 16 }}>
          No samples yet. Run <code>npm run seed-samples</code> in the backend.
        </p>
      ) : (
        <div>
          {samples.slice(0, 3).map((s) => (
            <div key={s.id} className="ap-sample">
              <button
                type="button"
                onClick={() => toggle(s)}
                aria-label={`${playingId === s.id ? 'Stop' : 'Play'} ${s.name}`}
              >
                {playingId === s.id ? <StopSolid size={11} /> : <PlayIcon className="h-3 w-3" />}
              </button>
              <span className="nm">{s.name}</span>
              <span className="du">{formatClock(s.duration_s)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}



const DEMO_STATS = { total_calls: 128, failures: 4, failure_rate: 3.1, sla_target_rate: 5, avg_latency_s: 2.31, total_cost_usd: 0.552 };
const DEMO_CASES = [
  ['3e2f9c2a-7b4d-11ee', '14:32:11', 'hallucination'],
  ['a1c8d4f7-2c91-11ee', '14:31:58', 'timeout'],
  ['b7e9c6f1-5d20-11ee', '14:31:44', 'bad_stt'],
  ['d3f4a8e9-8a63-11ee', '14:31:25', null],
  ['4e7f6a8f-1b77-11ee', '14:30:53', 'network_drop'],
  ['6f9d2b1c-9e04-11ee', '14:30:21', 'user_hangup'],
  ['e3c9d4f7-3f18-11ee', '14:29:11', null],
].map(([id, t, cause]) => ({ id, created_at: `2026-09-27T${t}Z`, cause_of_death: cause, stt_provider: 'deepgram', cost_usd: 0.004312 }));
const DEMO_SAMPLES = [
  { id: 's1', name: 'customer_support_01.wav', duration_s: 18, url: '' },
  { id: 's2', name: 'billing_issue_02.wav', duration_s: 27, url: '' },
  { id: 's3', name: 'angry_customer_03.wav', duration_s: 31, url: '' },
];
const demoDetail = (id) => {
  const c = DEMO_CASES.find((x) => x.id === id) || DEMO_CASES[0];
  return {
    id: c.id,
    created_at: c.created_at,
    cause_of_death: c.cause_of_death,
    confidence: 0.92,
    impact: 'High',
    duration_s: 2.46,
    cost_usd: 0.004312,
    stages: [
      { stage: 'stt', provider: 'deepgram', latency_s: 0.821, cost_usd: 0.001231 },
      { stage: 'llm', provider: 'openai', latency_s: 1.183, cost_usd: 0.002441 },
      { stage: 'tts', provider: 'elevenlabs', latency_s: 0.466, cost_usd: 0.00064 },
    ],
    transcript: 'Caller: Hi, I need to check my last invoice.\nBot: Of course. Your plan renewed on the 14th for $49.',
  };
};

const POLL_MS = 5000;

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [cases, setCases] = useState(null);
  const [samples, setSamples] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fault, setFault] = useState({
    fault: 'hallucination',
    temperature: 1.2,
    corruption_pct: 30,
    delay_ms: 0,
  });

  const refresh = useCallback(() => {
    if (DEMO) {
      setStats(DEMO_STATS);
      setCases(DEMO_CASES);
      setSelectedId((cur) => cur ?? DEMO_CASES[0].id);
      return;
    }
    api.getDashboardStats().then(setStats).catch(() => {});
    api.listCases({ limit: 8 }).then((c) => {
      setCases(c);
      setSelectedId((cur) => cur ?? c[0]?.id ?? null);
    }).catch(() => setCases((cur) => cur ?? []));
  }, []);

  useEffect(() => {
    refresh();
    if (DEMO) setSamples(DEMO_SAMPLES);
    else api.listSamples().then(setSamples).catch(() => setSamples([]));
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    if (DEMO) { setDetail(demoDetail(selectedId)); return; }
    let live = true;
    setDetailLoading(true);
    api.getCase(selectedId).then((d) => live && setDetail(d)).catch(() => {}).finally(() => live && setDetailLoading(false));
    return () => { live = false; };
  }, [selectedId]);

  return (
    <div className={`ap-root ${FULLSCREEN ? 'ap-full' : ''}`}>
      <style>{CSS}</style>

      <div className="ap-fig ap-fig-l" aria-hidden="true" />
      <div className="ap-fig ap-fig-r" aria-hidden="true" />
      <div className="ap-rail" style={{ top: 560 }} aria-hidden="true">Voice<br />Diagnostics<br />Autopsy</div>
      <div className="ap-rail" style={{ top: 680, fontSize: 10.5 }} aria-hidden="true">STT<br />LLM<br />TTS<br />Analyze<br />Fix</div>

      <div className="ap-topbar">
        <div className="ap-brand"><i />CallAutopsy</div>
        <nav className="ap-nav" aria-label="Primary">
          <span className="on" aria-current="page">Dashboard</span>
          {NAV.map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
          <Link to={LANDING_ROUTE} className="ap-landing"><ArrowLeft size={17} /> Landing</Link>
        </nav>
      </div>

      <header className="ap-head">
        <div>
          <div className="ap-eyebrow">Case File</div>
          <h1 className="ap-title">Call<em>Autopsy</em></h1>
          <p className="ap-tagline">Trace every failed call to the stage that broke it.</p>
        </div>
      </header>

      <div className="ap-meta">
        <SlaPill stats={stats} />
        <StatsRibbon stats={stats} />
      </div>
      <SlaBanner stats={stats} />

      <div className="ap-top">
        <RecentCalls cases={cases} selectedId={selectedId} onSelect={setSelectedId} fault={fault} onRecorded={refresh} />
        <div className="ap-right">
          <CallDetails detail={detail} loading={detailLoading} cases={cases} selectedId={selectedId} onSelect={setSelectedId} />
          <CauseOfDeath detail={detail} loading={detailLoading} selectedId={selectedId} />
          <div className="ap-mid">
            <StageTimeline detail={detail} loading={detailLoading} />
            <WaveformPanel detail={detail} loading={detailLoading} />
          </div>
        </div>
      </div>

      <div className="ap-bottom">
        <FaultInjection value={fault} onChange={setFault} />
        <CostBreakdown detail={detail} loading={detailLoading} />
        <SampleLibrary samples={samples} />
      </div>

    </div>
  );
}