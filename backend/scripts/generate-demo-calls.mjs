#!/usr/bin/env node
// Renders the demo calls described in samples/manifest.json into samples/*.wav
// (16 kHz, mono, 16-bit PCM, the format the pipeline expects).
//
//   node scripts/generate-demo-calls.mjs --engine openai            # OpenAI TTS (needs OPENAI_API_KEY + ffmpeg)
//   node scripts/generate-demo-calls.mjs                            # offline engine (espeak-ng + ffmpeg), robotic voices
//   node scripts/generate-demo-calls.mjs --engine openai --only stress-04-young-female-fast-interruptions.wav
//
// A manifest entry is either
//   segments: [{ text, pause }]                      single speaker, `pause` = silence after the line, or
//   timeline: [{ who: customer|agent, text, gap, style, breath, noise }]
//             `gap` = seconds after the previous line ENDS (negative = starts before it ends, i.e. talks over it),
//             `style` = extra delivery instruction for this line only, `breath` = audible breath before the line,
//             `noise` = [{ type, offset, gainDb }] one-off sounds anchored to this line's start.
// `voice` / `agent` pick the TTS voices. `post` = { preset, ...overrides } picks the recording environment and microphone.
//
// TTS model: gpt-4o-mini-tts (cheap, follows delivery instructions) unless a voice sets model: "tts-1".
// Rendered speech is cached (node_modules/.cache/demo-calls) so tuning the noise never re-calls the API.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'demo-calls');
fs.mkdirSync(CACHE, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const engine = flag('engine', 'espeak');
const only = flag('only', '')?.split(',').filter(Boolean);
if (!['espeak', 'openai'].includes(engine)) throw new Error('--engine must be espeak or openai');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-calls-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
const ff = (...a) => run('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
const PCM = ['-ar', '16000', '-ac', '1', '-sample_fmt', 's16'];
let n = 0;
const tmpFile = (ext = 'wav') => path.join(tmp, `${(n += 1)}.${ext}`);
const duration = (f) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// Deterministic randomness so a given call always renders the same environment.
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i += 1) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- speech synthesis
let openai = null;
if (engine === 'openai') {
  if (!process.env.OPENAI_API_KEY) throw new Error('--engine openai needs OPENAI_API_KEY');
  const { default: OpenAI } = await import('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
let charsSent = 0;

async function synth(text, cfg, style) {
  const out = tmpFile();
  if (engine === 'espeak') {
    const v = cfg.espeak;
    const raw = tmpFile();
    run('espeak-ng', ['-v', v.voice, '-s', String(v.speed), '-p', String(v.pitch), '-a', String(v.amp ?? 100), '-g', String(v.gap ?? 2), '-w', raw, text]);
    return finishClip(raw, out, v.tempo);
  }
  const v = cfg.openai;
  const model = v.model ?? 'tts-1';
  const instructions = model === 'gpt-4o-mini-tts' ? [v.instructions, style].filter(Boolean).join(' ') : undefined;
  const key = crypto.createHash('sha1').update(JSON.stringify({ model, voice: v.voice, speed: v.speed ?? 1, instructions, text })).digest('hex');
  const cached = path.join(CACHE, `${key}.wav`);
  if (!fs.existsSync(cached)) {
    const body = { model, voice: v.voice, input: text, response_format: 'wav' };
    if (model === 'tts-1') body.speed = v.speed ?? 1;
    if (instructions) body.instructions = instructions;
    const res = await openai.audio.speech.create(body);
    const raw = tmpFile();
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    ff('-i', raw, ...PCM, cached);
    charsSent += text.length;
  }
  return finishClip(cached, out, v.tempo);
}

// TTS pads every clip with silence, which would distort the scripted gaps and pacing: trim both ends, then apply the
// voice's tempo (pitch-preserving) if it has one.
function finishClip(src, out, tempo) {
  const trim = 'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-42dB';
  ff('-i', src, '-af', `${trim},areverse,${trim},areverse${tempo && tempo !== 1 ? `,atempo=${tempo}` : ''}`, ...PCM, out);
  return out;
}

// ---------------------------------------------------------------- audio helpers
function readPcm(file) {
  const b = fs.readFileSync(file);
  let pos = 12; let start = -1; let size = 0;
  while (pos + 8 <= b.length) { const id = b.toString('ascii', pos, pos + 4); const sz = b.readUInt32LE(pos + 4); if (id === 'data') { start = pos + 8; size = Math.min(sz, b.length - start); break; } pos += 8 + sz + (sz % 2); }
  const len = Math.floor(size / 2); const x = new Float64Array(len);
  for (let i = 0; i < len; i += 1) x[i] = b.readInt16LE(start + i * 2) / 32768;
  return x;
}
// Loud-frame level (90th percentile, the level of the speech) and mean power level (the level of a noise bed), in dB.
function levels(file) {
  const x = readPcm(file); const fr = 320; const db = []; let sum = 0;
  for (let s = 0; s + fr <= x.length; s += fr) { let e = 0; for (let i = s; i < s + fr; i += 1) e += x[i] * x[i]; sum += e; db.push(10 * Math.log10(e / fr + 1e-12)); }
  db.sort((a, b) => a - b);
  return { p90: db[Math.floor(db.length * 0.9)], mean: 10 * Math.log10(sum / (db.length * fr) + 1e-12) };
}
const gain = (file, dB) => { const out = tmpFile(); ff('-i', file, '-af', `volume=${dB}dB`, ...PCM, out); return out; };

function silence(sec) { const out = tmpFile(); ff('-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(sec), ...PCM, out); return out; }

// Place clips at absolute start times on a track of length T.
function place(clips, T) {
  const out = tmpFile();
  if (!clips.length) return silence(T);
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const delays = clips.map((c, i) => `[${i}:a]adelay=${Math.max(0, Math.round(c.at * 1000))}|${Math.max(0, Math.round(c.at * 1000))}[d${i}]`);
  const mix = `${clips.map((_, i) => `[d${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest,apad=whole_dur=${T.toFixed(2)},atrim=0:${T.toFixed(2)}[o]`;
  ff(...inputs, '-filter_complex', `${delays.join(';')};${mix}`, '-map', '[o]', ...PCM, out);
  return out;
}

function mix(files, T, weights = []) {
  const out = tmpFile();
  const inputs = files.flatMap((f) => ['-i', f]);
  ff(...inputs, '-filter_complex', `amix=inputs=${files.length}:normalize=0:duration=longest${weights.length ? `:weights=${weights.join(' ')}` : ''},apad=whole_dur=${T.toFixed(2)},atrim=0:${T.toFixed(2)}`, ...PCM, out);
  return out;
}

// ---------------------------------------------------------------- environments
const lav = (expr, dur) => ['-f', 'lavfi', '-i', expr.replace('%D', dur.toFixed(2))];
function noise(color, T, chain) {
  const out = tmpFile();
  ff(...lav(`anoisesrc=color=${color}:amplitude=0.5:d=%D:r=16000`, T), '-af', chain, ...PCM, out);
  return out;
}

const CHATTER = {
  office: [['en-us+f2', 150, 'yeah I can send that over after the call, no the deck is in the shared folder'], ['en-us+m3', 140, 'so the meeting is moved to three, can you let them know, thanks']],
  tv: [['en-us+m3', 130, 'and in local news tonight the council has confirmed the new schedule for the road works'], ['en-us+f4', 140, 'stay tuned, we will be right back after the break with the weather']],
  cafe: [['en-us+f2', 150, 'so I told her we could meet on thursday but she said the train would be late again'], ['en-us+m3', 140, 'two flat whites and one of those almond croissants, thanks, no the large one'], ['en-us+f4', 160, 'honestly I think the second option is better, the price is about the same']],
  street: [['en-us+m3', 150, 'hey wait up, we are going to miss it, no it is the next one'], ['en-us+f2', 155, 'did you see that, he just went straight through the light']],
  transit: [['en-us+f3', 140, 'the next stop is central station, please mind the gap when leaving the train, this train terminates at the airport']],
};
function babble(kind, T) {
  const tracks = CHATTER[kind].map(([v, s, t], i) => {
    const raw = tmpFile(); const wav = tmpFile();
    run('espeak-ng', ['-v', v, '-s', String(s), '-w', raw, `${t}. ${t}. ${t}.`]);
    ff('-i', raw, ...PCM, '-af', `adelay=${i * 1700}|${i * 1700}`, wav);
    return wav;
  });
  const out = tmpFile();
  ff(...tracks.flatMap((t) => ['-i', t]), '-filter_complex', `amix=inputs=${tracks.length}:normalize=0,aloop=loop=-1:size=2e9,atrim=0:${T.toFixed(2)},highpass=f=200,lowpass=f=3000`, ...PCM, out);
  return out;
}

// One-off sounds. Each is synthesised once (no recorded material), shaped to sound like its source.
const EVENT_EXPR = {
  clink: { expr: "0.6*sin(2*PI*3100*t)*exp(-t*22)+0.3*sin(2*PI*4700*t)*exp(-t*30)", d: 0.45, chain: 'highpass=f=1500' },
  thump: { expr: "(random(0)*2-1)*exp(-t*16)", d: 0.5, chain: 'lowpass=f=320' },
  crash: { expr: "(random(0)*2-1)*exp(-t*5)*0.9+0.4*sin(2*PI*2600*t)*exp(-t*9)", d: 0.9, chain: 'highpass=f=600' },
  horn: { expr: "0.4*sin(2*PI*420*t)+0.35*sin(2*PI*525*t)", d: 0.75, chain: 'afade=t=in:d=0.06,afade=t=out:st=0.55:d=0.2,lowpass=f=2500' },
  brake: { expr: "0.35*sin(2*PI*(2200+800*t)*t)*exp(-t*1.2)+0.25*(random(0)*2-1)*exp(-t*2)", d: 1.2, chain: 'highpass=f=900' },
  cough: { expr: "(random(0)*2-1)*exp(-t*9)*(0.5+0.5*sin(2*PI*14*t))", d: 0.4, chain: 'highpass=f=250,lowpass=f=2400' },
  pop: { expr: "(random(0)*2-1)*exp(-t*90)", d: 0.06, chain: 'highpass=f=800' },
};
function eventClip(type) {
  const e = EVENT_EXPR[type];
  const out = tmpFile();
  ff('-f', 'lavfi', '-i', `aevalsrc='${e.expr}':d=${e.d}:s=16000`, '-af', e.chain, ...PCM, out);
  return out;
}

// A traffic-like swell: low rumble whose level rises and falls.
const swell = (file, period, depth = 0.9) => { const out = tmpFile(); ff('-i', file, '-af', `volume='${(1 - depth).toFixed(2)}+${depth.toFixed(2)}*pow(sin(2*PI*t/${period}),2)':eval=frame`, ...PCM, out); return out; };

// Irregular key clicks / static crackle: white noise gated to a sparse, irregular pulse train.
function clicks(T, density, hp) {
  const out = tmpFile();
  ff(...lav(`anoisesrc=color=white:amplitude=0.9:d=%D:r=16000`, T), '-af', `volume=0:enable='gte(mod(t*${density}+0.7*sin(t*2.3),1),0.018)',highpass=f=${hp}`, ...PCM, out);
  return out;
}

// Environment recipes: each returns { bed: [files at relative level dB], snrDb } where snrDb is the target
// speech-to-noise ratio measured against the finished speech track. Every recipe uses different components.
function environment(preset, T, r, events) {
  const bed = []; // [file, relative dB]
  const E = []; // one-off events [{type, at, dB}] with dB relative to speech level
  const randTimes = (mean, jitter) => { const out = []; let t = 1 + r() * mean; while (t < T - 1) { out.push(t); t += mean * (1 - jitter + r() * jitter * 2); } return out; };
  switch (preset) {
    case 'studio': return { bed, E, snrDb: null };
    case 'quiet_room':
      bed.push([noise('pink', T, 'lowpass=f=450,highpass=f=40'), 0], [noise('brown', T, 'lowpass=f=120'), -8]);
      return { bed, E, snrDb: 38 };
    case 'quiet_reverb':
      bed.push([noise('pink', T, 'lowpass=f=380'), 0]);
      return { bed, E, snrDb: 40 };
    case 'home_tv':
      bed.push([babble('tv', T), 0], [noise('brown', T, 'lowpass=f=200'), -6]);
      for (const t of randTimes(9, 0.5)) E.push({ type: r() < 0.5 ? 'thump' : 'clink', at: t, dB: -14 });
      return { bed, E, snrDb: 22 };
    case 'office':
      bed.push([babble('office', T), 0], [noise('brown', T, 'lowpass=f=160'), -3], [clicks(T, 5.5, 1800), -9]);
      return { bed, E, snrDb: 21 };
    case 'phone_static':
      bed.push([noise('pink', T, 'lowpass=f=1800,highpass=f=200'), 0], [clicks(T, 11, 1400), -4]);
      for (const t of randTimes(7, 0.6)) E.push({ type: 'pop', at: t, dB: -6 });
      return { bed, E, snrDb: 24 };
    case 'cafe':
      bed.push([babble('cafe', T), 0], [noise('brown', T, 'lowpass=f=260'), -5], [noise('white', T, 'highpass=f=5000,lowpass=f=7000'), -14]);
      for (const t of randTimes(3.6, 0.5)) E.push({ type: 'clink', at: t, dB: -12 });
      return { bed, E, snrDb: 14 };
    case 'hiss_intermittent':
      bed.push([noise('white', T, 'highpass=f=3500,lowpass=f=7500'), 0], [noise('pink', T, 'lowpass=f=300'), -10]);
      for (const t of randTimes(8, 0.4)) { E.push({ type: 'thump', at: t, dB: -10 }); }
      for (const t of randTimes(13, 0.4)) E.push({ type: 'horn', at: t, dB: -14 });
      return { bed, E, snrDb: 27 };
    case 'street':
      bed.push([swell(noise('brown', T, 'lowpass=f=330'), 8.5, 0.85), 0], [babble('street', T), -6], [noise('pink', T, 'lowpass=f=900'), -9]);
      for (const t of randTimes(9, 0.5)) E.push({ type: 'horn', at: t, dB: -9 });
      return { bed, E, snrDb: 16 };
    case 'transit_phone':
      bed.push([swell(noise('brown', T, 'lowpass=f=240'), 5.5, 0.55), 0], [babble('transit', T), -13], [noise('white', T, 'highpass=f=4000,lowpass=f=6500'), -16]);
      return { bed, E, snrDb: 12 };
    default: throw new Error(`unknown environment ${preset}`);
  }
}

// Microphone / channel chain applied to the customer's voice BEFORE the room noise is added (the noise reaches the
// same microphone, so telephone-style band limiting is applied to the finished mix afterwards).
const MIC = {
  studio: 'highpass=f=70,acompressor=threshold=-22dB:ratio=2',
  close: 'highpass=f=90',
  distant: "highpass=f=120,lowpass=f=6500,volume='0.88+0.12*sin(2*PI*0.21*t)':eval=frame",
  reverb: 'highpass=f=100,aecho=0.85:0.55:38|71|120:0.32|0.22|0.12,lowpass=f=6800',
  muffled: 'highpass=f=150,lowpass=f=3000',
  inconsistent: "highpass=f=90,volume='0.72+0.28*sin(2*PI*0.13*t+1)':eval=frame",
};
// Channel applied to the finished mix.
const CHANNEL = {
  none: null,
  telephone: 'highpass=f=300,highpass=f=300,lowpass=f=3400,lowpass=f=3400,lowpass=f=3400,acompressor=threshold=-24dB:ratio=5:attack=8:release=90,acrusher=bits=10:mix=0.5:mode=lin',
  compressed: 'highpass=f=200,lowpass=f=4500,acompressor=threshold=-26dB:ratio=6:attack=5:release=60,acrusher=bits=11:mix=0.4:mode=lin',
};

// ---------------------------------------------------------------- render one call
const STYLE_SPEECH_DB = -20; // loudnorm target of the customer track

async function render(entry, layoutOnly = false) {
  const r = rng(entry.id);
  const post = entry.post ?? { preset: 'studio' };
  const events = (entry.timeline ?? entry.segments.map((s, i, all) => ({ who: 'customer', text: s.text, gap: i === 0 ? 0.3 : all[i - 1].pause ?? 0.35 })));

  // 1. synthesise every line and lay out the timeline
  const laid = [];
  let prevEnd = 0;
  for (const [i, ev] of events.entries()) {
    const who = ev.who ?? 'customer';
    const cfg = who === 'agent' ? entry.agent : entry.voice;
    const file = await synth(ev.text, cfg, ev.style);
    const dur = duration(file);
    const start = Math.max(0, (i === 0 ? 0 : prevEnd) + (ev.gap ?? 0.35));
    laid.push({ ev, who, file, start, end: start + dur, dur });
    prevEnd = start + dur;
  }
  if (layoutOnly) return laid.map((l) => ({ who: l.who, text: l.ev.text, start: +l.start.toFixed(2), end: +l.end.toFixed(2) }));
  const T = Math.max(...laid.map((l) => l.end)) + 0.6;

  // 2. customer track: voice + breaths, then the microphone chain
  const cust = laid.filter((l) => l.who === 'customer');
  const custClips = cust.map((l) => ({ file: l.file, at: l.start }));
  const breathFile = tmpFile();
  ff(...lav('anoisesrc=color=pink:amplitude=0.5:d=%D:r=16000', 0.42), '-af', 'highpass=f=200,lowpass=f=1600,afade=t=in:d=0.14,afade=t=out:st=0.2:d=0.22', ...PCM, breathFile);
  const speechOnly = place(custClips, T);
  const lv = levels(speechOnly);
  const breaths = cust.filter((l) => l.ev.breath).map((l) => ({ file: gain(breathFile, lv.p90 - 22 - levels(breathFile).p90), at: Math.max(0, l.start - 0.55) }));
  let voice = breaths.length ? mix([speechOnly, place(breaths, T)], T) : speechOnly;
  const normed = tmpFile();
  ff('-i', voice, '-af', `loudnorm=I=${STYLE_SPEECH_DB}:LRA=8:TP=-2`, ...PCM, normed);
  voice = normed;
  const micChain = MIC[post.mic ?? 'close'];
  if (micChain) { const o = tmpFile(); ff('-i', voice, '-af', micChain, ...PCM, o); voice = o; }

  // 3. room noise at the target speech-to-noise ratio, plus one-off sounds anchored to lines or scattered
  const env = environment(post.preset, T, r, events);
  const speechLevel = levels(voice).p90;
  const snr = post.snrDb ?? env.snrDb;
  let noisy = voice;
  if (env.bed.length && snr !== null) {
    const bedMix = mix(env.bed.map(([f, rel]) => gain(f, rel)), T);
    const bedGain = speechLevel - snr - levels(bedMix).mean;
    const parts = [voice, gain(bedMix, bedGain)];
    const oneOffs = [...env.E.map((e) => ({ ...e })), ...laid.flatMap((l) => (l.ev.noise ?? []).map((nz) => ({ type: nz.type, at: l.start + (nz.offset ?? 0), dB: nz.gainDb ?? -8 })))];
    if (oneOffs.length) {
      const clips = oneOffs.map((o) => { const f = eventClip(o.type); return { file: gain(f, speechLevel + o.dB - levels(f).p90), at: o.at }; });
      parts.push(place(clips, T));
    }
    noisy = mix(parts, T);
  }

  // 4. agent track (clean, slightly quieter), then the whole call goes through the channel
  const agentLines = laid.filter((l) => l.who === 'agent');
  let final = noisy;
  if (agentLines.length) {
    const aTrack = place(agentLines.map((l) => ({ file: l.file, at: l.start })), T);
    const aNorm = tmpFile();
    ff('-i', aTrack, '-af', `loudnorm=I=${STYLE_SPEECH_DB - 3}:LRA=8:TP=-2`, ...PCM, aNorm);
    final = mix([noisy, aNorm], T);
  }
  const chan = CHANNEL[post.channel ?? 'none'];
  if (chan) { const o = tmpFile(); ff('-i', final, '-af', chan, ...PCM, o); final = o; }

  // 5. consistent overall level: peak to about -1 dBFS
  const vd = spawnSync('ffmpeg', ['-hide_banner', '-i', final, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume: (-?[\d.]+) dB/.exec(vd.stderr ?? '');
  const peak = m ? Number(m[1]) : -3;
  const out = tmpFile();
  ff('-i', final, '-af', `volume=${Math.min(14, -1 - peak).toFixed(2)}dB,alimiter=limit=0.95`, ...PCM, out);
  return out;
}

const report = [];
// --truth: write the exact speaker timeline of each multi-speaker call to samples/truth/<id>.json (used by the diarization
// and overlap benchmarks). Layout only: uses the cached speech clips, renders no audio and sends nothing to the TTS API.
if (args.includes('--truth')) {
  const dir = path.join(SAMPLES, 'truth');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of manifest.samples) {
    if (!s.timeline || (only?.length && !only.includes(s.id))) continue;
    const segs = await render(s, true);
    fs.writeFileSync(path.join(dir, s.id.replace(/\.wav$/, '.json')), `${JSON.stringify({ id: s.id, segments: segs }, null, 1)}\n`);
    console.log(s.id, segs.length, 'segments');
  }
  console.log(`new TTS characters sent: ${charsSent}`);
  process.exit(0);
}
for (const s of manifest.samples) {
  if (!s.segments && !s.timeline) continue;
  if (s.frozen && !args.includes('--force')) continue; // hand-tuned earlier; --force re-renders with the current recipes
  if (only?.length && !only.includes(s.id)) continue;
  const file = await render(s);
  fs.copyFileSync(file, path.join(SAMPLES, s.id));
  report.push({ file: s.id, duration: `${duration(file).toFixed(1)}s`, bytes: fs.statSync(path.join(SAMPLES, s.id)).size });
}
console.table(report);
if (engine === 'openai') console.log(`~${charsSent} new characters sent to TTS this run (cached lines are free).`);
