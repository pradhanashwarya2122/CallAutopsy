import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { getWorkspaceId, isValidWorkspaceId, switchWorkspace } from '../lib/workspace';
import { useLiveCallFeed } from '../hooks/useLiveCallFeed';
import { useSampleLibrary } from '../hooks/useSampleLibrary';
import { ClipboardIcon, WaveformIcon } from '../components/Icons';
import { Skeleton } from '../components/Skeleton';
import CallAnalysisPanels, { Turns } from '../components/CallAnalysis.jsx';
import { CATEGORY_LABEL, GROUP_LABEL } from '../lib/sampleGroups';
import '../styles/dashboard.css';

const NAV = [
  { label: 'Analyze', to: '/analyze' },
  { label: 'A/B', to: '/ab' },
  { label: 'Ops', to: '/ops' },
];

const RING = { stt: '#1e88ff', llm: '#14a36f', tts: '#6a5cd6', analysis: '#d24fa0' };
const STAGE_ORDER = ['stt', 'llm', 'tts'];
const COST_ORDER = ['stt', 'llm', 'tts', 'analysis'];
const STAGE_NAME = { stt: 'Speech-to-text', llm: 'Reply generation', tts: 'Text-to-speech' };
const CAUSE_STAGE = { bad_stt: 'stt', hallucination: 'llm', tts_glitch: 'tts' };

const CAUSE_META = {
  bad_stt: { label: 'Bad transcription', tone: 'amber', text: 'Speech-to-text output diverged from what was actually said.' },
  hallucination: { label: 'Hallucination', tone: 'red', text: 'The model stated details that were not grounded in what the caller said.' },
  tts_glitch: { label: 'TTS glitch', tone: 'red', text: 'The synthesized reply was truncated or contained artifacts.' },
  timeout: { label: 'Timeout', tone: 'amber', text: 'A pipeline stage exceeded its latency budget.' },
  user_hangup: { label: 'User hangup', tone: 'amber', text: 'The caller disconnected before the response completed.' },
  network_drop: { label: 'Network drop', tone: 'amber', text: 'The connection was lost mid-call.' },
  exception: { label: 'Exception', tone: 'red', text: 'An unhandled error interrupted the pipeline.' },
  unknown: { label: 'Unclassified failure', tone: 'red', text: 'The call failed but the classifier could not pin down why.' },
};
const metaFor = (cause) =>
  CAUSE_META[cause] || { label: String(cause || 'Failure').replace(/_/g, ' '), tone: 'red', text: 'Failure detected in this call.' };

const FAULTS = [
  { value: 'none', label: 'Off (analyze my audio as-is)' },
  { value: 'bad_stt', label: 'Garble the audio before transcription' },
  { value: 'hallucination', label: 'Push the model to invent facts' },
  { value: 'tts_glitch', label: 'Cut the spoken reply short' },
  { value: 'timeout', label: 'Make a stage run too slowly' },
  { value: 'user_hangup', label: 'Caller hangs up mid-call' },
  { value: 'network_drop', label: 'Drop the network mid-call' },
  { value: 'exception', label: 'Crash a stage with an error' },
];
const STAGE_FAULTS = ['timeout', 'user_hangup', 'network_drop', 'exception'];
const DEFAULT_FAULT = { type: 'none', stage: 'llm', corruptionPct: 60, intensity: 'aggressive', temperature: 0.9, truncatePct: 30, extraDelayMs: 3000 };

const formatUsd = (n) => {
  const v = Number(n || 0);
  if (v === 0) return '$0.00';
  return v < 0.0001 ? '<$0.0001' : `$${v.toFixed(4)}`;
};
const formatClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const validDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const whenShort = (iso) => {
  const d = validDate(iso);
  if (!d) return '—';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const whenFull = (iso) => {
  const d = validDate(iso);
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
};
const friendlyError = (e) =>
  e instanceof ApiError ? e.message : 'Could not reach the server. Check your connection and try again.';
const looksLikeAudio = (f) => f.type.startsWith('audio/') || /\.(wav|mp3|m4a|mp4|ogg|oga|webm|flac|aac)$/i.test(f.name);

// The stage that broke: the first stage that errored/timed out, else the stage the classifier blames.
function stageOfFailure(detail) {
  if (!detail || !detail.cause_of_death) return null;
  const bad = detail.stages.find((s) => STAGE_ORDER.includes(s.stage) && s.status !== 'ok');
  return bad ? bad.stage : CAUSE_STAGE[detail.cause_of_death] || null;
}

/* ---------- small icons ---------- */
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
const UploadIcon = (p) => <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></Svg>;
const WarnTri = (p) => <Svg {...p} strokeWidth="1.6"><path d="M12 3.5l9.5 16.5h-19L12 3.5z" /><path d="M12 10v4.5M12 17.4v.1" /></Svg>;
const Tick = (p) => <Svg {...p} strokeWidth="2.4"><path d="M4 12.5l5 5L20 6.5" /></Svg>;
const XCircle = (p) => (
  <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const PlaySolid = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
);
const StopSolid = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>
);

/* ---------- workspace (per-browser identity) ---------- */
function WorkspaceChip() {
  const id = getWorkspaceId();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [other, setOther] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr('Copy failed. Select the key and copy it manually.');
    }
  };
  const useKey = () => {
    if (!isValidWorkspaceId(other)) { setErr('That is not a valid workspace key.'); return; }
    if (window.confirm('Switch to that workspace? Save your current key first if you want to come back.')) switchWorkspace(other);
  };
  const fresh = () => {
    if (window.confirm('Start a new empty workspace? Your current calls stay saved under your current key.')) switchWorkspace(null);
  };

  return (
    <span className="ap-ws" ref={ref}>
      <button type="button" className="ap-ws-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Your private workspace">
        My workspace · {id.slice(0, 6)}
      </button>
      {open && (
        <div className="ap-pop" role="dialog" aria-label="Workspace">
          <p><b>Your calls are private to this browser.</b> Nobody else can open them without this key. There is no login, so keep the key safe: clearing site data loses it, and anyone who has it can see your calls.</p>
          <input className="ap-input" readOnly value={id} onFocus={(e) => e.target.select()} aria-label="Workspace key" />
          <div className="row">
            <button type="button" className="ap-btn" onClick={copy}>{copied ? 'Copied' : 'Copy key'}</button>
            <button type="button" className="ap-btn danger" onClick={fresh}>Start fresh</button>
          </div>
          <hr />
          <p>Open a workspace from another device:</p>
          <input className="ap-input" placeholder="Paste a workspace key" value={other} onChange={(e) => { setOther(e.target.value); setErr(''); }} aria-label="Workspace key to switch to" />
          <div className="row"><button type="button" className="ap-btn ghost" onClick={useKey} disabled={!other.trim()}>Switch</button></div>
          {err && <p className="ap-msg err" role="alert">{err}</p>}
        </div>
      )}
    </span>
  );
}

/* ---------- top ribbon ---------- */
function StatsRibbon({ summary }) {
  if (!summary) return <Skeleton className="h-6 w-72" />;
  const finished = summary.total_calls - summary.in_flight;
  const breached = finished >= 5 && summary.failure_rate > summary.sla_target_rate;
  const left = Math.max(0, summary.daily_limit - summary.daily_used);
  return (
    <>
      {finished >= 5 && (
        <span className={`ap-pill ${breached ? 'bad' : ''}`}>{breached ? `Failure rate above ${summary.sla_target_rate}% target` : 'Within failure target'}</span>
      )}
      <span className="ap-stat" style={{ '--dot': '#1e88ff' }}>Calls<b>{summary.total_calls}</b></span>
      <span className="ap-stat" style={{ '--dot': '#e2372b' }}>Failed<b>{summary.failures}{finished > 0 ? ` (${summary.failure_rate.toFixed(0)}%)` : ''}</b></span>
      <span className="ap-stat" style={{ '--dot': '#6a5cd6' }}>Avg time<b>{finished > 0 ? `${summary.avg_latency_s.toFixed(1)}s` : '—'}</b></span>
      <span className="ap-stat" style={{ '--dot': '#f0a23a' }}>Spent<b>{formatUsd(summary.total_cost_usd)}</b></span>
      <span className="ap-ribbon-note">{left} of {summary.daily_limit} analyses left today</span>
    </>
  );
}

/* ---------- analyze: upload / record / demo calls / simulate a failure ---------- */
function DropZone({ disabled, maxBytes, onFile, onReject }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [converting, setConverting] = useState(false); // converting an mp3/m4a/... takes a moment; no second file until it is done
  const take = (files) => {
    const f = files && files[0];
    if (!f) return;
    if (!looksLikeAudio(f)) { onReject('Choose an audio file: wav, mp3, m4a, ogg, webm or flac.'); return; }
    if (f.size > maxBytes) {
      onReject(`That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is ${Math.round(maxBytes / 1048576)} MB.`);
      return;
    }
    // mp3, m4a, ogg, webm and flac cannot be decoded by the server, so they would get no noise/bandwidth/speaker analysis.
    // The browser can, so they are converted to 16 kHz WAV first (the original is sent if that fails or would exceed the limit).
    if (/wav/i.test(f.type) || /\.wav$/i.test(f.name)) { onFile(f); return; }
    setConverting(true);
    recordingToWav16k(f)
      .then((wav) => onFile(wav && wav.size <= maxBytes ? new File([wav], `${f.name.replace(/\.[^.]+$/, '')}.wav`, { type: 'audio/wav' }) : f))
      .finally(() => setConverting(false));
  };
  return (
    <>
      <button
        type="button"
        className={`ap-drop ${over ? 'over' : ''}`}
        disabled={disabled || converting}
        onClick={() => input.current && input.current.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !converting) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && !converting) take(e.dataTransfer.files); }}
      >
        <UploadIcon size={22} />
        <b>{converting ? 'Preparing your file…' : 'Drop an audio file here'}</b>
        <small>or click to browse · wav, mp3, m4a, ogg, webm · up to {Math.round(maxBytes / 1048576)} MB</small>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac"
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />
    </>
  );
}

const MAX_RECORD_SECONDS = 30;
function pickMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

// Browser recordings arrive as webm/mp4. Convert to 16 kHz mono WAV so every recording gets the same signal-level
// analysis (noise, bandwidth) as the demo calls; fall back to the original if the browser cannot decode it.
async function recordingToWav16k(blob) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (ctx.close) ctx.close();
    const frames = Math.max(1, Math.round(decoded.duration * 16000));
    const off = new OfflineAudioContext(1, frames, 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const pcm = rendered.getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i += 1) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i += 1) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new File([buf], 'recording.wav', { type: 'audio/wav' });
  } catch {
    return null;
  }
}

function Recorder({ disabled, onRecorded, onError }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { if (stream.current) stream.current.getTracks().forEach((t) => t.stop()); }, []);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
  }, []);
  useEffect(() => { if (recording && seconds >= MAX_RECORD_SECONDS) stop(); }, [recording, seconds, stop]);

  const start = async () => {
    let s = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = pickMime();
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        const type = (r.mimeType || 'audio/webm').split(';')[0];
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(chunks.current, { type });
        setRecording(false);
        setSeconds(0);
        if (blob.size === 0) { onError('No audio was captured. Try again.'); return; }
        recordingToWav16k(blob).then((wav) => onRecorded(wav || new File([blob], `recording.${ext}`, { type })));
      };
      rec.current = r;
      setSeconds(0);
      r.start();
      setRecording(true);
    } catch (e) {
      if (s) { s.getTracks().forEach((t) => t.stop()); stream.current = null; } // never leave the microphone on after a failed start
      onError(s && e?.name !== 'NotAllowedError' ? 'This browser could not start recording. Upload a file instead.' : 'Microphone blocked or unavailable. Allow access in your browser, or upload a file instead.');
    }
  };

  if (!supported) return <p className="ap-sub" style={{ fontSize: 12, margin: 0 }}>Recording is not supported in this browser. Upload a file instead.</p>;
  return (
    <div className="ap-recrow">
      <button
        type="button"
        className={`ap-recbtn ${recording ? 'live' : ''}`}
        onClick={recording ? stop : start}
        disabled={disabled && !recording}
        aria-label={recording ? 'Stop recording and analyze' : 'Start recording'}
      >
        <span style={recording ? { width: 12, height: 12, borderRadius: 2 } : { width: 13, height: 13, borderRadius: '50%' }} />
      </button>
      <span className="st" role="status">
        {recording ? `Recording ${formatClock(seconds)} · click to stop and analyze` : 'Record your own call (up to 30 s)'}
      </span>
    </div>
  );
}

const prettyIntent = (x) => String(x || '').replace(/_/g, ' ');

// One dropdown for all demo calls. Choosing one shows what it is designed to stress; Analyze runs it through the real pipeline.
function DemoPicker({ samples, error, onRetry, missing, busy, onRun }) {
  const [selectedId, setSelectedId] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const audio = useRef(null);

  const groups = GROUP_LABEL
    .map(([g, label]) => [g, label, (samples || []).filter((x) => (x.group || 'quick') === g)])
    .filter(([, , list]) => list.length);
  const [tab, setTab] = useState('');
  const selected = (samples || []).find((s) => s.id === selectedId) || null;

  useEffect(() => {
    if (samples && samples.length && !selectedId) setSelectedId(samples[0].id);
  }, [samples, selectedId]);
  useEffect(() => {
    const s0 = (samples || []).find((x) => x.id === selectedId);
    if (s0 && !tab) setTab(s0.group || 'quick');
  }, [samples, selectedId, tab]);

  const stopPreview = useCallback(() => {
    if (audio.current) { audio.current.pause(); audio.current = null; }
    setPreviewing(false);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);
  useEffect(() => { stopPreview(); }, [selectedId, stopPreview]);

  const togglePreview = () => {
    if (!selected) return;
    if (previewing) { stopPreview(); return; }
    const a = new Audio(selected.url);
    a.onended = () => setPreviewing(false);
    a.onerror = () => setPreviewing(false);
    audio.current = a;
    setPreviewing(true);
    a.play().catch(() => setPreviewing(false));
  };

  if (samples === null) return <Skeleton className="h-10 w-full" />;
  if (samples.length === 0) return <p className="ap-sub" style={{ fontSize: 12, margin: 0 }}>No demo calls on this server. Record or upload one instead.</p>;

  return (
    <>
      {error && <p className="ap-warn" role="alert">{error} <button type="button" className="ap-btn ghost" onClick={onRetry}>Try again</button></p>}
      {missing > 0 && <p className="ap-warn" role="status">{missing} of these recordings are not on your server yet (it runs an older build), so they are served by this website and analysed as uploaded files. Redeploy the backend to run them as built-in demo calls.</p>}
      <div className="ap-tabs" role="tablist" aria-label="Demo call categories">
        {groups.map(([g, label, list]) => (
          <button key={g} type="button" role="tab" aria-selected={tab === g} className={tab === g ? 'on' : ''} onClick={() => { setTab(g); if (!list.some((x) => x.id === selectedId)) setSelectedId(list[0].id); }}>
            {label} <i>{list.length}</i>
          </button>
        ))}
      </div>
      <div className="ap-demolist" role="listbox" aria-label="Demo calls">
        {(groups.find(([g]) => g === tab)?.[2] ?? []).map((x) => (
          <button key={x.id} type="button" role="option" aria-selected={x.id === selectedId} className={x.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(x.id)}>
            <span className="t">{x.label}</span>
            <span className="m">{x.category ? (CATEGORY_LABEL[x.category] || x.category) : ''}{x.duration_s ? ` · ${Math.round(x.duration_s)}s` : ''}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="ap-demo">
          <div className="hd">
            {selected.category && <span className={`ap-cat ${selected.category}`}>{CATEGORY_LABEL[selected.category] || selected.category}</span>}
            {selected.level && <span className="lvl" title={`Difficulty ${selected.level} of 5`}>{'●'.repeat(selected.level)}<i>{'●'.repeat(5 - selected.level)}</i></span>}
          </div>
          {selected.speaker && <p className="ap-meta-line"><b>Speaker:</b> {selected.speaker}</p>}
          {selected.environment && <p className="ap-meta-line"><b>Recording:</b> {selected.environment}</p>}
          {selected.summary && <p className="sum">{selected.summary}</p>}
          {selected.tags && selected.tags.length > 0 && <div className="ap-tagrow">{selected.tags.map((t) => <span key={t}>{t}</span>)}</div>}
          {selected.challenge && <p className="chal"><b>Designed to stress:</b> {selected.challenge}</p>}
          {selected.says && (
            <details className="says">
              <summary>Script</summary>
              <p>{selected.says}</p>
            </details>
          )}
          <div className="row">
            <button type="button" className="ap-btn ghost" onClick={togglePreview} aria-label={previewing ? 'Stop preview' : `Preview ${selected.label}`}>
              {previewing ? 'Stop' : 'Play'}
            </button>
            <button type="button" className="ap-btn" disabled={busy} onClick={() => onRun(selected)}>Analyze this call</button>
          </div>
        </div>
      )}
    </>
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

function StageSelect({ value, onChange }) {
  return (
    <div className="ap-select">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Stage to break">
        {STAGE_ORDER.map((k) => <option key={k} value={k}>{`At: ${STAGE_NAME[k]}`}</option>)}
      </select>
      <ChevDown size={16} />
    </div>
  );
}

function FaultFold({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const t = value.type;
  return (
    <details className="ap-fold">
      <summary>Simulate a failure <span className="on">{t === 'none' ? 'off' : t}</span></summary>
      <p className="hint">Breaks your next analysis on purpose so you can see how CallAutopsy diagnoses it. It applies to one analysis, then switches itself off.</p>
      <div className="ap-select">
        <select
          value={t}
          onChange={(e) => set({ type: e.target.value, stage: e.target.value === 'timeout' ? 'llm' : 'stt' })}
          aria-label="Failure to simulate"
        >
          {FAULTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <ChevDown size={16} />
      </div>
      {STAGE_FAULTS.includes(t) && <StageSelect value={value.stage} onChange={(stage) => set({ stage })} />}
      {t === 'bad_stt' && <Slider label="Corruption" min={10} max={100} step={5} value={value.corruptionPct} suffix="%" color="#e2372b" onChange={(v) => set({ corruptionPct: v })} />}
      {t === 'tts_glitch' && <Slider label="Reply kept" min={10} max={90} step={5} value={value.truncatePct} suffix="%" color="#6a5cd6" onChange={(v) => set({ truncatePct: v })} />}
      {t === 'timeout' && <Slider label="Extra delay" min={500} max={8000} step={500} value={value.extraDelayMs} suffix="ms" color="#1e88ff" onChange={(v) => set({ extraDelayMs: v })} />}
      {t === 'hallucination' && <Slider label="Temperature" min={0} max={2} step={0.1} value={value.temperature} color="#f08a24" onChange={(v) => set({ temperature: Number(v.toFixed(1)) })} />}
      {t === 'hallucination' && (
        <div className="ap-select">
          <select value={value.intensity} onChange={(e) => set({ intensity: e.target.value })} aria-label="Hallucination intensity">
            <option value="mild">Mild: prefers confident answers</option>
            <option value="aggressive">Aggressive: invents specifics</option>
          </select>
          <ChevDown size={16} />
        </div>
      )}
    </details>
  );
}


// "What is this?" panel: open for a first-time visitor, collapsed once they have calls, and it remembers a manual choice.
function AboutBox({ hasCalls, faultOn }) {
  const KEY = 'callautopsy.aboutOpen';
  const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  const [open, setOpen] = useState(stored === null ? !hasCalls : stored === '1');
  const toggle = () => { const n = !open; setOpen(n); try { localStorage.setItem(KEY, n ? '1' : '0'); } catch { /* storage unavailable */ } };
  return (
    <div className={`ap-about ${open ? 'open' : ''}`}>
      <button type="button" className="ap-about-toggle" aria-expanded={open} onClick={toggle}>
        <span><b>What is this?</b> <em>Find which step of a voice-bot call broke.</em></span>
        <i aria-hidden="true">{open ? 'Hide ▴' : 'Show ▾'}</i>
      </button>
      {open && (
        <div className="ap-about-body">
          <p>A voice bot <b>listens</b> (speech to text), <b>thinks</b> (an AI model writes a reply) and <b>speaks</b> (text to speech). When a call goes wrong it is hard to tell which step failed. CallAutopsy runs a call through all three, names the step that broke and shows the evidence. It is for teams that build or test voice agents.</p>
          <StartGuide hasCalls={hasCalls} faultOn={faultOn} />
        </div>
      )}
    </div>
  );
}

// A four-step path through the product, ticked off as the user does each step, so the order is never a guess.
function StartGuide({ hasCalls, faultOn }) {
  const steps = [
    ['Pick a call', 'Choose a demo recording on the left (or record or upload your own).', true],
    ['Break it on purpose (optional)', 'Turn on “Simulate a failure” and choose one, to see how that failure looks.', !!faultOn],
    ['Press Analyze, then read the verdict', 'You get the step that failed, the evidence, the time and the cost of each step.', hasCalls],
  ];
  return (
    <ol className="ap-steps">
      {steps.map(([t, d, done], i) => (
        <li key={t} className={done && i > 0 ? 'done' : ''}><span>{i + 1}</span><div><b>{t}</b><em>{d}</em></div></li>
      ))}
      <li className={hasCalls ? 'next' : 'locked'}>
        <span>4</span>
        <div><b>Compare two setups</b><em>{hasCalls ? <>Now run the same call on two configurations: <Link to="/ab">open the A/B page →</Link></> : 'After your first analysis, the A/B page runs the same call on two setups and tells you which is better.'}</em></div>
      </li>
    </ol>
  );
}

function AnalyzePanel({ samples, samplesError, onRetrySamples, missingSamples, summary, busy, notice, fault, onFault, onFile, onSample, onNotice }) {
  const maxBytes = summary?.max_upload_bytes || 5 * 1024 * 1024;
  const reject = (msg) => onNotice({ tone: 'err', msg });
  return (
    <section className="ap-panel">
      <h2 className="ap-h">Analyze a call</h2>
      <p className="ap-step">Pick a demo call</p>
      <DemoPicker samples={samples} error={samplesError} onRetry={onRetrySamples} missing={missingSamples} busy={busy} onRun={onSample} />
      <div className="ap-or">or record your own</div>
      <Recorder disabled={busy} onRecorded={(f) => onFile(f, 'recording')} onError={reject} />
      <div className="ap-or">or upload a file</div>
      <DropZone disabled={busy} maxBytes={maxBytes} onFile={onFile} onReject={reject} />
      <FaultFold value={fault} onChange={onFault} />
      {notice && <p className={`ap-msg ${notice.tone}`} role={notice.tone === 'err' ? 'alert' : 'status'}>{notice.msg}</p>}
    </section>
  );
}

/* ---------- recent calls ---------- */
function RecentCalls({ cases, error, selectedId, onSelect, onRetry }) {
  return (
    <section className="ap-panel ap-feed">
      <h2 className="ap-h">Recent calls</h2>
      {cases === null ? (
        <div style={{ padding: '0 16px 16px' }}><Skeleton className="h-10 w-full" /></div>
      ) : cases.length === 0 ? (
        <div className="ap-empty" style={{ borderTop: '1px solid var(--line)' }}>
          {error ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--red)' }}>{error}</p>
              <button type="button" className="ap-btn ghost" onClick={onRetry}>Retry</button>
            </>
          ) : (
            <>
              <ClipboardIcon className="h-6 w-6" />
              <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)' }}>No calls yet</p>
              <p style={{ margin: 0 }}>Analyze a demo call or drop in a recording above.</p>
            </>
          )}
        </div>
      ) : (
        <div>
          {cases.map((c) => {
            const running = c.status === 'queued' || c.status === 'in_progress';
            const failed = c.status === 'failed';
            const aborted = c.status === 'aborted';
            const meta = failed ? metaFor(c.cause_of_death) : null;
            const tone = running ? 'amber' : failed ? meta.tone : aborted ? 'amber' : 'green';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === selectedId ? 'true' : undefined}
                className={`ap-row t-${tone} ${c.id === selectedId ? `sel ${failed ? 'bad' : 'ok'}` : ''}`}
              >
                <span className={`ap-radio ${failed || aborted || running ? tone : 'ok'}`} />
                <span className="body">
                  <span className="top">
                    <span className="id">{c.id.slice(0, 8)}</span>
                    <span className="t">{whenShort(c.created_at)}</span>
                  </span>
                  <span>
                    <span className={`ap-tag ${running ? 'busy' : aborted ? 'grey' : failed ? meta.tone : 'green'}`}>
                      {running ? <><span className="ap-spin" />analyzing</> : aborted ? 'aborted' : failed ? meta.label : 'success'}
                    </span>
                    {c.failover && <span className="ap-badge" title="Deepgram failed, so this call used Whisper">via Whisper</span>}
                    {c.injected_fault && <span className="ap-badge" title="A failure was simulated on purpose">sim: {c.injected_fault}</span>}
                  </span>
                  {c.intent && <span className="ap-intent">{prettyIntent(c.intent)}{c.difficulty ? ` · ${c.difficulty.toLowerCase()}` : ''}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- selected call ---------- */
function CallDetails({ detail, state, cases, selectedId, onSelect }) {
  const idx = cases ? cases.findIndex((c) => c.id === selectedId) : -1;
  const newer = idx > 0 ? cases[idx - 1] : null;
  const older = idx >= 0 && cases && idx < cases.length - 1 ? cases[idx + 1] : null;
  const failed = detail?.status === 'failed';
  const running = detail && !detail.finished;
  return (
    <section className={`ap-panel ${detail && state === 'ready' ? 'lit' : ''}`} style={{ '--a1': '#1e88ff', '--a2': '#6a5cd6' }}>
      <div className="ap-dhead">
        <h2 className="ap-h">Call details</h2>
        <div className="ap-pn">
          <button type="button" disabled={!newer} onClick={() => newer && onSelect(newer.id)}><ChevL size={14} /> Newer</button>
          <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
          <button type="button" disabled={!older} onClick={() => older && onSelect(older.id)}>Older <ChevR size={14} /></button>
        </div>
      </div>
      {state === 'loading' || (!detail && state !== 'error') ? (
        <Skeleton className="h-14 w-full" />
      ) : state === 'error' || !detail ? (
        <div className="ap-empty"><WaveformIcon className="h-6 w-6" /><span>Could not load this call. It may have been removed, or the server is unreachable.</span></div>
      ) : (
        <div className="ap-facts">
          <div className="ap-fact"><small>Call ID</small><div title={detail.id}>{detail.id.slice(0, 13)}…</div></div>
          <div className="ap-fact"><small>Started</small><div>{whenFull(detail.created_at)}</div></div>
          <div className="ap-fact"><small>Duration</small><div style={{ color: '#1e6fd9' }}>{detail.duration_s == null ? '—' : `${detail.duration_s.toFixed(2)}s`}</div></div>
          <div className="ap-fact"><small>Cost</small><div style={{ color: '#5b4bc4' }}>{formatUsd(detail.cost_usd)}</div></div>
          <div className="ap-fact"><small>Status</small><div className={running ? 'busy' : failed ? 'bad' : detail.status === 'completed' ? 'ok' : ''}>{running ? 'Running' : failed ? 'Failed' : detail.status === 'completed' ? 'Success' : 'Aborted'}</div></div>
        </div>
      )}
    </section>
  );
}

function Verdict({ detail, state, onRetry }) {
  if (state === 'loading') return <Skeleton className="h-28 w-full" />;
  if (state === 'error' || !detail) {
    return (
      <div className="ap-msg err" role="alert">
        Could not load the verdict for this call. <button type="button" className="ap-btn ghost" onClick={onRetry} style={{ marginLeft: 8 }}>Retry</button>
      </div>
    );
  }
  const links = (
    <div className="ap-links">
      <Link to={`/calls/${detail.id}`}>Full report <ArrowRight size={16} /></Link>
      <a href={api.pdfUrl(detail.id)} target="_blank" rel="noreferrer">Download PDF</a>
    </div>
  );
  if (!detail.finished) {
    return (
      <section className="ap-verdict busy" aria-live="polite">
        <span className="ap-spin" style={{ width: 34, height: 34, borderWidth: 4, margin: 0 }} />
        <div>
          <div className="k">In progress</div>
          <h3>Analyzing…</h3>
          <p>Running speech-to-text, then the reply, then text-to-speech. Each stage below fills in as it finishes.</p>
        </div>
      </section>
    );
  }
  if (detail.status === 'aborted') {
    return (
      <section className="ap-verdict busy">
        <WarnTri size={48} style={{ color: 'var(--amber)' }} />
        <div>
          <div className="k">Verdict</div>
          <h3>Aborted</h3>
          <p>The server restarted while this call was running, so it never finished. Analyze it again.</p>
        </div>
      </section>
    );
  }
  if (!detail.cause_of_death) {
    const notable = (detail.analysis?.findings || []).filter((f) => f.severity !== 'info');
    const difficulty = detail.analysis?.difficulty;
    return (
      <section className={`ap-verdict ${notable.length ? 'busy' : 'ok'}`}>
        {notable.length ? <WarnTri size={48} style={{ color: 'var(--amber)' }} /> : <Tick size={48} style={{ color: 'var(--green)' }} />}
        <div>
          <div className="k">Verdict</div>
          <h3>{notable.length ? 'Completed, with notes' : 'Healthy'}</h3>
          <p>
            {notable.length
              ? `The pipeline ran without a failure, but ${notable.length === 1 ? 'one thing stands out' : `${notable.length} things stand out`} in this call. See "What we noticed" below.`
              : 'No fault detected across speech-to-text, the reply and text-to-speech, and nothing unusual in the audio or the way the customer spoke.'}
          </p>
          {notable.length > 0 && <div className="meta">{notable.slice(0, 3).map((f) => <span key={f.id}><b>{f.title}</b></span>)}</div>}
          {difficulty && <div className="meta"><span>Call difficulty <b>{difficulty.label}</b></span></div>}
          {detail.injected_fault && <div className="meta"><span>Note: you simulated <b>{detail.injected_fault}</b>, but the classifier did not flag it.</span></div>}
          {links}
        </div>
      </section>
    );
  }
  const meta = metaFor(detail.cause_of_death);
  const stage = stageOfFailure(detail);
  const confidence = detail.confidence == null ? null : Math.round(detail.confidence <= 1 ? detail.confidence * 100 : detail.confidence);
  return (
    <section className="ap-verdict">
      <WarnTri size={48} style={{ color: 'var(--red)' }} />
      <div>
        <div className="k">Cause of death</div>
        <h3>{meta.label}</h3>
        <p>{detail.autopsy?.cause || meta.text}</p>
        <div className="meta">
          {confidence != null && <span>Confidence <b>{confidence}%</b></span>}
          {stage && <span>Failed at <b>{STAGE_NAME[stage]}</b></span>}
          {detail.injected_fault && <span>Simulated <b>{detail.injected_fault}</b></span>}
        </div>
        {detail.autopsy?.recommendation && <div className="rec"><small>What to do</small>{detail.autopsy.recommendation}</div>}
        {links}
      </div>
    </section>
  );
}

function StageTimeline({ detail, state }) {
  if (state === 'loading' || !detail) {
    return (
      <section className="ap-panel">
        <h2 className="ap-h">Where the time and money went</h2>
        <div style={{ marginTop: 14 }}><Skeleton className="h-24 w-full" /></div>
      </section>
    );
  }
  const by = Object.fromEntries(detail.stages.map((s) => [s.stage, s]));
  const total = detail.stages.reduce((n, s) => n + s.latency_s, 0);
  const failStage = stageOfFailure(detail);
  const firstMissing = STAGE_ORDER.find((k) => !by[k]);
  return (
    <section className="ap-panel lit" style={{ '--a1': '#14a36f', '--a2': '#1e88ff' }}>
      <h2 className="ap-h">Where the time and money went</h2>
      <div className="ap-stages">
        {STAGE_ORDER.map((k, i) => {
          const s = by[k];
          const bad = k === failStage;
          const label = !s
            ? (detail.finished ? 'Not reached' : k === firstMissing ? 'Running…' : 'Waiting')
            : s.status === 'timeout' ? 'Timed out'
            : s.status !== 'ok' ? 'Failed'
            : bad ? metaFor(detail.cause_of_death).label : 'Success';
          return (
            <div key={k} style={{ display: 'contents' }}>
              <div className={`ap-stage ${bad ? 'bad' : ''} ${s ? '' : 'pending'}`} style={{ '--sc': bad ? '#e2372b' : RING[k] }}>
                <div className="n">{k}</div>
                <div className="p">{s?.provider || STAGE_NAME[k]}</div>
                <div className="l">{s ? `${s.latency_s.toFixed(2)}s` : '—'}</div>
                <div className="c">{s ? formatUsd(s.cost_usd) : ' '}</div>
                {k === 'stt' && s && s.confidence != null && (
                  <div className="c" title="Average word confidence reported by the speech-to-text provider">Confidence {Math.round(s.confidence * 100)}%</div>
                )}
                <div className="s">
                  {s && !bad && <Tick size={15} />}
                  {bad && <XCircle size={15} />}
                  {!s && !detail.finished && k === firstMissing && <span className="ap-spin" style={{ margin: 0 }} />}
                  {label}
                </div>
                {s && total > 0 && (
                  <div className="bar" title={`${Math.round((s.latency_s / total) * 100)}% of call time`}>
                    <i style={{ width: `${Math.max(4, Math.round((s.latency_s / total) * 100))}%` }} />
                  </div>
                )}
              </div>
              {i < STAGE_ORDER.length - 1 && <ArrowRight size={18} className="ap-arrow" />}
            </div>
          );
        })}
      </div>
      {detail.failover && <p className="ap-note">Deepgram failed on this call, so it automatically fell back to Whisper for transcription.</p>}
    </section>
  );
}

// Decode the audio and reduce it to bar heights. Returns null peaks (flat bars) if the browser cannot decode it.
function usePeaks(url, bars = 48) {
  const [state, setState] = useState({ peaks: null, duration: 0 });
  useEffect(() => {
    setState({ peaks: null, duration: 0 });
    if (!url) return undefined;
    let alive = true;
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
        if (ctx.close) ctx.close();
        const data = decoded.getChannelData(0);
        const size = Math.max(1, Math.floor(data.length / bars));
        const step = Math.max(1, Math.floor(size / 40));
        const raw = [];
        for (let i = 0; i < bars; i += 1) {
          let max = 0;
          for (let j = i * size; j < Math.min((i + 1) * size, data.length); j += step) max = Math.max(max, Math.abs(data[j]));
          raw.push(max);
        }
        const top = Math.max(...raw) || 1;
        if (alive) setState({ peaks: raw.map((v) => Math.max(0.06, v / top)), duration: decoded.duration });
      } catch {
        if (alive) setState({ peaks: null, duration: 0 });
      }
    })();
    return () => { alive = false; ctl.abort(); };
  }, [url, bars]);
  return state;
}

function AudioPlayer({ url }) {
  const { peaks, duration } = usePeaks(url);
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { if (audio.current) audio.current.pause(); }, []);

  const toggle = () => {
    if (playing) { audio.current.pause(); setPlaying(false); return; }
    if (!audio.current) {
      const a = new Audio(url);
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => { setPlaying(false); setProgress(0); };
      a.onerror = () => { setFailed(true); setPlaying(false); };
      audio.current = a;
    }
    audio.current.play().then(() => setPlaying(true)).catch(() => { setFailed(true); setPlaying(false); });
  };

  const shown = peaks || Array.from({ length: 48 }, () => 0.06);
  return (
    <>
      <div className="ap-wave">
        <button type="button" className="ap-play" onClick={toggle} disabled={failed} aria-label={playing ? 'Pause audio' : 'Play audio'}>
          {playing ? <StopSolid size={16} /> : <PlaySolid size={20} />}
        </button>
        <div className={`ap-bars ${peaks ? '' : 'flat'}`} aria-hidden="true">
          {shown.map((b, i) => <i key={i} className={i / shown.length < progress ? 'p' : ''} style={{ height: `${Math.round(b * 100)}%` }} />)}
        </div>
      </div>
      <div className="ap-times">
        <span>{formatClock(progress * duration)}</span>
        <span>{failed ? 'Audio unavailable' : duration ? formatClock(duration) : ''}</span>
      </div>
    </>
  );
}

function AudioPanel({ detail, script }) {
  const analysis = detail?.analysis;
  const hasTurns = (analysis?.turns || []).length > 0;
  const match = analysis?.script_match;
  const [tab, setTab] = useState('input');
  const id = detail?.id;
  useEffect(() => { setTab('input'); }, [id]);
  if (!detail) return null;
  const url = tab === 'input' ? api.audioUrl(detail.id, 'input') : tab === 'reply' ? api.audioUrl(detail.id, 'tts') : null;
  return (
    <section className="ap-panel lit" style={{ '--a1': '#6a5cd6', '--a2': '#d24fa0' }}>
      <h2 className="ap-h">Audio &amp; transcript</h2>
      <div className="ap-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'input'} className={tab === 'input' ? 'on' : ''} onClick={() => setTab('input')}>Caller audio</button>
        <button type="button" role="tab" aria-selected={tab === 'reply'} className={tab === 'reply' ? 'on' : ''} disabled={!detail.has_reply_audio} onClick={() => setTab('reply')}>Reply audio</button>
        <button type="button" role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>Transcript</button>
      </div>
      {tab === 'transcript' ? (
        <div className="ap-transcript">
          <small>What speech-to-text heard (personal details redacted)</small>
          {hasTurns
            ? <Turns analysis={analysis} />
            : (detail.transcript || 'No transcript. Speech-to-text did not produce one for this call.')}
          {script && (
            <>
              <small style={{ marginTop: 14 }}>
                What was actually said (demo call script){match ? ` · ${Math.round((1 - match.wer) * 100)}% of words match (${Math.round((1 - match.wer_strict) * 100)}% counting number formatting), ${match.numbers_matched} of ${match.numbers_expected} numbers heard exactly` : ''}
              </small>
              <span style={{ whiteSpace: 'pre-wrap' }}>{script}</span>
            </>
          )}
        </div>
      ) : (
        <AudioPlayer key={url} url={url} />
      )}
    </section>
  );
}

function CostBreakdown({ detail }) {
  if (!detail) return null;
  const total = detail.stages.reduce((n, s) => n + s.cost_usd, 0);
  if (total <= 0) return null;
  const ordered = [...detail.stages].sort((a, b) => COST_ORDER.indexOf(a.stage) - COST_ORDER.indexOf(b.stage));
  let acc = 0;
  const ring = `conic-gradient(${ordered.map((s) => {
    const from = acc;
    acc += (s.cost_usd / total) * 100;
    return `${RING[s.stage]} ${from}% ${acc}%`;
  }).join(', ')})`;
  return (
    <details className="ap-panel ap-fold" style={{ marginTop: 0 }}>
      <summary>Cost breakdown <span className="on" style={{ color: 'var(--ink)' }}>{formatUsd(total)}</span></summary>
      <div className="ap-cost">
        <div className="ap-donut" style={{ background: ring }} role="img" aria-label={`Total cost ${formatUsd(total)}`} />
        <div className="ap-legend">
          <div className="tot">{formatUsd(total)}</div>
          <div className="lb">Total cost</div>
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
    </details>
  );
}

function Guide() {
  return (
    <section className="ap-panel ap-guide">
      <h3>Find out why a call failed</h3>
      <ol>
        <li><span className="n">1</span><span><b>Add a call.</b> Drop in a recording, record your own voice, or run one of the demo calls.</span></li>
        <li><span className="n">2</span><span><b>Watch it run.</b> CallAutopsy sends it through speech-to-text, a reply and text-to-speech, timing and costing each stage.</span></li>
        <li><span className="n">3</span><span><b>Read the verdict.</b> If something broke you get the cause, the stage that failed, and what to do about it.</span></li>
      </ol>
      <p className="ap-sub" style={{ fontSize: 12, margin: 0 }}>Your calls are private to this browser. You can also simulate a failure on purpose to see how it is diagnosed.</p>
    </section>
  );
}

function humanize(ev) {
  const short = String(ev.callId || '').slice(0, 8);
  if (ev.type === 'call.started') return { tone: 'info', msg: `Analysis started · ${short}` };
  if (ev.type === 'call.completed') {
    return ev.category === 'ok'
      ? { tone: 'ok', msg: `Call ${short} finished with no problems` }
      : { tone: 'err', msg: `Call ${short} failed · ${metaFor(ev.category).label}` };
  }
  return null;
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [cases, setCases] = useState(null);
  const { samples, error: samplesError, reload: reloadSamples, missing: missingSamples } = useSampleLibrary();
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [fault, setFault] = useState(DEFAULT_FAULT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [flash, setFlash] = useState(null);
  const [retryTick, setRetryTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.mySummary(), api.myCalls(12)]);
      setSummary(s);
      setCases(c);
      setLoadError('');
      setSelectedId((cur) => (cur && c.some((x) => x.id === cur) ? cur : c[0]?.id ?? null));
    } catch (e) {
      setLoadError(friendlyError(e));
      setCases((cur) => cur ?? []);
    }
  }, []);

  const { lastEvent, connected } = useLiveCallFeed({ max: 1 });

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The socket does the real work; this is only a safety net (and the main path when the socket is down).
  useEffect(() => {
    const t = setInterval(refresh, connected ? 30000 : 8000);
    return () => clearInterval(t);
  }, [refresh, connected]);

  useEffect(() => {
    if (!lastEvent || !lastEvent.owned) return undefined;
    if (lastEvent.type === 'call.completed' || lastEvent.type === 'call.started') refresh();
    const human = humanize(lastEvent);
    if (!human) return undefined;
    setFlash(human);
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [lastEvent, refresh]);

  // Selected call: load it, keep polling while it runs, and briefly after a failure for its postmortem.
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailState('idle'); return undefined; }
    let alive = true;
    let timer;
    let autopsyTries = 0;
    const load = async (first) => {
      if (first) { setDetail(null); setDetailState('loading'); }
      try {
        const d = await api.callDetail(selectedId);
        if (!alive) return;
        setDetail(d);
        setDetailState('ready');
        const waitingForAutopsy = d.finished && d.status === 'failed' && !d.autopsy && autopsyTries < 6;
        if (waitingForAutopsy) autopsyTries += 1;
        if (!d.finished || waitingForAutopsy) timer = setTimeout(() => load(false), d.finished ? 2500 : 1200);
      } catch {
        if (!alive) return;
        if (first) setDetailState('error');
        else timer = setTimeout(() => load(false), 4000);
      }
    };
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [selectedId, retryTick]);

  const startAnalysis = useCallback(async (input) => {
    setBusy(true);
    setNotice(null);
    try {
      const { callId } = await api.analyze({ ...input, fault });
      await refresh();
      setSelectedId(callId);
      setFault((f) => ({ ...f, type: 'none' }));
      setNotice({ tone: 'ok', msg: 'Analysis started. Results appear on the right as each stage finishes.' });
    } catch (e) {
      setNotice({ tone: 'err', msg: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }, [fault, refresh]);

  useEffect(() => {
    if (!notice || notice.tone !== 'ok') return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const onFile = useCallback((file, source = 'upload') => startAnalysis({ file, source }), [startAnalysis]);
  // A recording the server lacks (older deploy) is fetched from the website and sent as an uploaded file, so it still analyses.
  const onSample = useCallback(async (s) => {
    if (!s.bundled) return startAnalysis({ sampleId: s.id });
    try {
      const r = await fetch(s.url);
      if (!r.ok) throw new Error('missing');
      return startAnalysis({ file: new File([await r.blob()], s.id, { type: 'audio/wav' }), source: 'upload' });
    } catch {
      setNotice({ tone: 'err', msg: 'Could not load that recording. Check your connection and try again.' });
    }
  }, [startAnalysis]);

  const empty = cases !== null && cases.length === 0;

  return (
    <div className="ap-root ap-full">
      <div className="ap-fig ap-fig-l" aria-hidden="true" />
      <div className="ap-rail" style={{ top: 560 }} aria-hidden="true">Voice<br />Diagnostics<br />Autopsy</div>

      <div className="ap-topbar">
        <div className="ap-brand">
          <i />CallAutopsy
          <span className={`ap-live ${connected ? 'on' : ''}`} title={connected ? 'Real-time updates connected' : 'Real-time updates unavailable; refreshing every few seconds'}>
            <span className="dot" />{connected ? 'Live' : 'Polling'}
          </span>
          <WorkspaceChip />
        </div>
        <nav className="ap-nav" aria-label="Primary">
          <span className="on" aria-current="page">Dashboard</span>
          {NAV.map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
          <Link to="/" className="ap-landing"><ArrowLeft size={17} /> Landing</Link>
        </nav>
      </div>

      <header className="ap-head">
        <div>
          <div className="ap-eyebrow">Case File</div>
          <h1 className="ap-title">Call<em>Autopsy</em></h1>
          <p className="ap-tagline">Trace every failed call to the stage that broke it.</p>
          <AboutBox hasCalls={(summary?.total_calls ?? 0) > 0} faultOn={!!(fault?.type && fault.type !== 'none')} />
        </div>
      </header>

      <div className="ap-meta"><StatsRibbon summary={summary} /></div>

      <div className="ap-top">
        <div className="ap-left">
          <AnalyzePanel
            samples={samples}
            samplesError={samplesError}
            onRetrySamples={reloadSamples}
            missingSamples={missingSamples}
            summary={summary}
            busy={busy}
            notice={notice}
            fault={fault}
            onFault={setFault}
            onFile={onFile}
            onSample={onSample}
            onNotice={setNotice}
          />
          <RecentCalls cases={cases} error={loadError} selectedId={selectedId} onSelect={setSelectedId} onRetry={refresh} />
        </div>

        <div className="ap-right">
          {cases === null ? (
            <Skeleton className="h-48 w-full" />
          ) : empty ? (
            <Guide />
          ) : (
            <>
              <CallDetails detail={detail} state={detailState} cases={cases} selectedId={selectedId} onSelect={setSelectedId} />
              <Verdict detail={detail} state={detailState} onRetry={() => setRetryTick((n) => n + 1)} />
              {detail && detail.finished && detail.analysis && <CallAnalysisPanels analysis={detail.analysis} />}
              {detailState !== 'error' && (
                <div className="ap-mid">
                  <StageTimeline detail={detail} state={detailState} />
                  {detail && detail.finished && <AudioPanel detail={detail} script={(samples || []).find((x) => x.id === detail.sample_id)?.says || null} />}
                  {detail && detail.finished && <CostBreakdown detail={detail} />}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {flash && (
        <div className={`ap-flash ${flash.tone}`} role="status">
          <span className="glyph">{flash.tone === 'ok' ? '✓' : flash.tone === 'err' ? '!' : 'i'}</span>
          <span>{flash.msg}</span>
        </div>
      )}
    </div>
  );
}
