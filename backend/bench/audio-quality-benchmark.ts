// Audio-quality detector vs the recording conditions each demo call was rendered with (samples/manifest.json `post`).
// Offline, no network. Usage: npx tsx bench/audio-quality-benchmark.ts [--json]
import fs from 'node:fs';
import { analyzeWavSignal } from '../src/analysis/audioSignal.js';
import { AUDIO_TRUTH } from '../test/audioTruth.js';

const rows: any[] = [];
let checks = 0, right = 0;
const wrong: string[] = [];
for (const [id, t] of Object.entries(AUDIO_TRUTH)) {
  const sig = analyzeWavSignal(fs.readFileSync(`samples/${id}.wav`))!;
  const got = { band_limited: sig.band_limited, noisy: sig.condition.flags.includes('noisy') || sig.condition.flags.includes('very_noisy'), compressed: sig.dynamics_compressed, clipped: sig.condition.flags.includes('clipped') };
  for (const k of ['band_limited', 'noisy', 'compressed', 'clipped'] as const) {
    const exp = (t as any)[k];
    if (exp === undefined) continue;
    checks += 1;
    if (exp === got[k]) right += 1; else wrong.push(`${id}: ${k} expected ${exp}, got ${got[k]}`);
  }
  rows.push({ id: id.slice(0, 30), snr: sig.snr_db, hf: sig.hf_ratio_db, lvlSd: sig.level_sd_db, clip: +(sig.clipping_ratio * 100).toFixed(2), condition: sig.condition.label, flags: sig.condition.flags.join(','), truth: t.note });
}
console.table(rows);
console.log(`labelled checks: ${right}/${checks} correct`);
wrong.forEach((w) => console.log('  WRONG', w));
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/audio-quality.json', JSON.stringify({ rows, right, checks, wrong }, null, 1));
process.exitCode = wrong.length ? 1 : 0;
