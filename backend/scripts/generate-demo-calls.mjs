#!/usr/bin/env node
// Renders the demo calls described in samples/manifest.json into samples/*.wav
// (16 kHz, mono, 16-bit PCM, so every file is compatible with the pipeline).
//
//   node scripts/generate-demo-calls.mjs                     # offline engine (espeak-ng + ffmpeg)
//   OPENAI_API_KEY=... node scripts/generate-demo-calls.mjs --engine openai   # OpenAI tts-1
//   node scripts/generate-demo-calls.mjs --only call-2-noisy-cafe.wav
//
// Needs ffmpeg on PATH; the offline engine also needs espeak-ng. The openai engine uses the
// cheapest model, tts-1 (about $15 per 1M characters, roughly a cent for all five calls).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples');
const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const engine = flag('engine', 'espeak');
const only = flag('only', '')?.split(',').filter(Boolean);
if (!['espeak', 'openai'].includes(engine)) throw new Error('--engine must be espeak or openai');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-calls-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] });
const ff = (...a) => run('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
const PCM = ['-ar', '16000', '-ac', '1', '-sample_fmt', 's16'];
let n = 0;
const tmpFile = (ext = 'wav') => path.join(tmp, `${(n += 1)}.${ext}`);

async function makeOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('--engine openai needs OPENAI_API_KEY');
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
const openai = engine === 'openai' ? await makeOpenAI() : null;

// One line of speech -> 16 kHz mono wav.
async function speak(text, voiceCfg) {
  const out = tmpFile();
  if (engine === 'espeak') {
    const v = voiceCfg.espeak;
    const raw = tmpFile();
    run('espeak-ng', ['-v', v.voice, '-s', String(v.speed), '-p', String(v.pitch), '-a', String(v.amp ?? 100), '-g', String(v.gap ?? 2), '-w', raw, text]);
    ff('-i', raw, ...PCM, out);
  } else {
    const v = voiceCfg.openai;
    const res = await openai.audio.speech.create({ model: 'tts-1', voice: v.voice, speed: v.speed ?? 1, response_format: 'wav', input: text });
    const raw = tmpFile();
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    ff('-i', raw, ...PCM, out);
  }
  return out;
}

function silence(sec) {
  const out = tmpFile();
  ff('-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono`, '-t', String(sec), ...PCM, out);
  return out;
}

function concat(files) {
  const list = tmpFile('txt');
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  const out = tmpFile();
  ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out);
  return out;
}

const duration = (f) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// Unrelated chatter that plays quietly behind the noisy call (different voices, different pace).
function babble(seconds) {
  const lines = [
    ['en-us+f2', 150, 'so I told her we could meet on thursday, but she said the train would be late again'],
    ['en-us+m3', 140, 'yeah two flat whites and one of those almond croissants, thanks, no, the large one'],
    ['en-us+f4', 160, 'honestly I think the second option is better, the price is about the same and it ships faster'],
  ];
  const tracks = lines.map(([v, s, t], i) => {
    const raw = tmpFile(); const wav = tmpFile();
    run('espeak-ng', ['-v', v, '-s', String(s), '-w', raw, `${t}. ${t}.`]);
    ff('-i', raw, ...PCM, '-af', `adelay=${i * 1300}|${i * 1300}`, wav);
    return wav;
  });
  const out = tmpFile();
  ff(...tracks.flatMap((t) => ['-i', t]), '-filter_complex', `amix=inputs=${tracks.length}:normalize=0,aloop=loop=-1:size=2e9,atrim=0:${seconds}`, ...PCM, out);
  return out;
}

// Post-processing recipes. All are deliberately moderate: speech stays understandable.
function applyPost(speechFile, preset, dur) {
  const out = tmpFile();
  const d = dur.toFixed(2);
  if (preset === 'clean') {
    ff('-i', speechFile, '-af', 'loudnorm=I=-19:TP=-2:LRA=7', ...PCM, out);
  } else if (preset === 'phone') {
    // Narrow-band telephone audio with a faint line noise floor.
    ff('-i', speechFile, '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.012:d=${d}:r=16000`,
      '-filter_complex', `[0:a]highpass=f=300,lowpass=f=3400,loudnorm=I=-20:TP=-2:LRA=7[s];[s][1:a]amix=inputs=2:normalize=0:duration=first[o]`,
      '-map', '[o]', ...PCM, out);
  } else if (preset === 'mumble') {
    // Quiet, slightly muffled speech over a low room-noise floor.
    ff('-i', speechFile, '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.02:d=${d}:r=16000`,
      '-filter_complex', `[0:a]highpass=f=140,lowpass=f=3000,acompressor=threshold=-26dB:ratio=3:attack=20:release=250,loudnorm=I=-26:TP=-3:LRA=5[s];[s][1:a]amix=inputs=2:normalize=0:duration=first[o]`,
      '-map', '[o]', ...PCM, out);
  } else if (preset === 'cafe') {
    // Speech at moderate level over: passing traffic swells, muffled café chatter, occasional clatter.
    // Speech volume drifts slowly so it is not perfectly even.
    const bab = babble(dur + 1);
    ff('-i', speechFile,
      '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.6:d=${d}:r=16000`,
      '-i', bab,
      '-f', 'lavfi', '-i', `anoisesrc=color=white:amplitude=0.7:d=${d}:r=16000`,
      '-filter_complex', [
        `[0:a]loudnorm=I=-19:TP=-2:LRA=7,volume='0.90+0.10*sin(2*PI*0.45*t)':eval=frame[sp]`,
        `[1:a]lowpass=f=420,volume='0.55+0.45*pow(sin(2*PI*t/8),2)':eval=frame,volume=0.55[traffic]`,
        `[2:a]highpass=f=200,lowpass=f=3200,volume=0.42[babble]`,
        `[3:a]volume=0:enable='gte(mod(t,5.3),0.07)',highpass=f=2500,volume=0.16[clatter]`,
        `[sp][traffic][babble][clatter]amix=inputs=4:normalize=0:duration=first,alimiter=limit=0.92[o]`,
      ].join(';'),
      '-map', '[o]', ...PCM, out);
  } else {
    throw new Error(`unknown post preset ${preset}`);
  }
  return out;
}

let chars = 0;
const report = [];
for (const s of manifest.samples) {
  if (!s.segments) continue;
  if (only?.length && !only.includes(s.id)) continue;
  const parts = [];
  for (const seg of s.segments) {
    chars += seg.text.length;
    parts.push(await speak(seg.text, s.voice));
    if (seg.pause) parts.push(silence(seg.pause));
  }
  const raw = concat(parts);
  const done = applyPost(raw, s.post?.preset ?? 'clean', duration(raw));
  fs.copyFileSync(done, path.join(SAMPLES, s.id));
  report.push([s.id, duration(done).toFixed(1) + 's', fs.statSync(path.join(SAMPLES, s.id)).size]);
}
console.table(report.map(([id, d, b]) => ({ file: id, duration: d, bytes: b })));
if (engine === 'openai') console.log(`~${chars} characters sent to tts-1 (about $${((chars / 1e6) * 15).toFixed(3)}).`);
