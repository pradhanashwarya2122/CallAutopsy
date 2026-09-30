// Speaker attribution vs the exact speaker timeline of each demo call (samples/truth). Offline: real recogniser output
// (test/fixtures/stt) + real audio. Usage: npx tsx bench/diarization-benchmark.ts [--json]
import fs from 'node:fs';
import { readPcm16 } from '../src/analysis/audioIO.js';
import { extractFrames } from '../src/analysis/prosody.js';
import { diarize } from '../src/analysis/diarize.js';

const manifest = JSON.parse(fs.readFileSync('samples/manifest.json', 'utf8')).samples as any[];
const rows: any[] = [];
for (const s of manifest) {
  const stt = JSON.parse(fs.readFileSync(`test/fixtures/stt/${s.id.replace('.wav', '.json')}`, 'utf8'));
  const truthFile = `samples/truth/${s.id.replace('.wav', '.json')}`;
  const truth: any[] | null = fs.existsSync(truthFile) ? JSON.parse(fs.readFileSync(truthFile, 'utf8')).segments : null;
  const truthSpeakers = truth ? new Set(truth.map((t) => t.who)).size : 1;
  const fr = extractFrames(readPcm16(fs.readFileSync(`samples/${s.id}`))!);
  const d = diarize(stt.words, fr);
  // per-word truth: which scripted speaker(s) were talking at the word's midpoint
  const tl = (w: any): string | null => {
    if (!truth) return 'customer';
    const mid = (w.start + w.end) / 2;
    const who = new Set(truth.filter((t) => mid >= t.start - 0.05 && mid <= t.end + 0.05).map((t) => t.who));
    return who.size === 1 ? [...who][0] : null; // null = silence between lines, or overlap: not scored
  };
  const score = (labels: (number | null)[]) => {
    const pairs = stt.words.map((w: any, i: number) => [tl(w), labels[i]]).filter(([t, l]: any) => t !== null && l !== null);
    if (!pairs.length) return null;
    const roles = [...new Set(pairs.map((p: any) => p[0]))] as string[];
    const labs = [...new Set(pairs.map((p: any) => p[1]))] as number[];
    let best = 0;
    for (const l of labs) for (const r of roles) {
      const hit = pairs.filter((p: any) => (p[0] === r) === (p[1] === l)).length;
      best = Math.max(best, hit / pairs.length);
    }
    return roles.length === 1 && labs.length === 1 ? 1 : best;
  };
  const base = score(stt.words.map((w: any) => (typeof w.speaker === 'number' ? w.speaker : null)));
  const ours = score(d.words.map((w) => w.speaker));
  rows.push({ id: s.id.replace('.wav', ''), truthSpk: truthSpeakers, recogSpk: d.recognizer_speakers, oursSpk: d.speakers, source: d.source, gap: d.pitch_gap_semitones, recogAcc: base?.toFixed(2), oursAcc: ours?.toFixed(2), lowConf: d.words.filter((w) => w.speaker !== null && w.confidence < 0.6).length, bg: d.words.filter((w) => w.background).length });
}
console.table(rows);
const cnt = rows.filter((r) => r.truthSpk === r.oursSpk).length;
console.log(`speaker count correct: ours ${cnt}/${rows.length}, recogniser ${rows.filter((r) => r.truthSpk === r.recogSpk).length}/${rows.length}`);
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/diarization.json', JSON.stringify(rows, null, 1));
