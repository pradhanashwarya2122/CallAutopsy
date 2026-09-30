// Interruption / overlap detection vs the scripted timelines. Truth events: a line that starts before the previous line ended
// (real simultaneous speech) and a line whose script ends with an em dash (deliberately cut off). Offline, real recogniser output.
import fs from 'node:fs';
import { readPcm16 } from '../src/analysis/audioIO.js';
import { extractFrames } from '../src/analysis/prosody.js';
import { diarize } from '../src/analysis/diarize.js';
import { buildTurns } from '../src/analysis/turns.js';

const manifest = JSON.parse(fs.readFileSync('samples/manifest.json', 'utf8')).samples as any[];
let tp = 0, fn = 0, fp = 0, kindsRight = 0;
const rows: any[] = [];
for (const s of manifest.filter((x) => x.timeline)) {
  const id = s.id.replace('.wav', '');
  const stt = JSON.parse(fs.readFileSync(`test/fixtures/stt/${id}.json`, 'utf8'));
  const truth = JSON.parse(fs.readFileSync(`samples/truth/${id}.json`, 'utf8')).segments as any[];
  const fr = extractFrames(readPcm16(fs.readFileSync(`samples/${s.id}`))!);
  const d = diarize(stt.words, fr);
  const ta = buildTurns(stt.words, d, stt.transcript);
  const events: { at: number; kind: string }[] = [];
  truth.forEach((t, i) => {
    if (i > 0 && t.who !== truth[i - 1].who && t.start < truth[i - 1].end - 0.05) events.push({ at: t.start, kind: 'simultaneous' });
    if (i < truth.length - 1 && /[—-]$/.test(t.text.trim()) && truth[i + 1].who !== t.who) events.push({ at: truth[i + 1].start, kind: 'interruption' });
  });
  const det = ta.boundaries.filter((b) => b.kind === 'simultaneous' || b.kind === 'interruption');
  const hitDet = new Set<number>();
  for (const e of events) {
    const j = det.findIndex((b, k) => !hitDet.has(k) && Math.abs(b.at - e.at) <= 1.5);
    if (j >= 0) { hitDet.add(j); tp += 1; if (det[j].kind === e.kind) kindsRight += 1; } else { fn += 1; }
  }
  const falseAlarms = det.filter((_, k) => !hitDet.has(k));
  fp += falseAlarms.length;
  rows.push({ id: id.slice(0, 32), speakers: d.speakers, truthEvents: events.map((e) => `${e.kind}@${e.at.toFixed(1)}`).join(' '), detected: det.map((b) => `${b.kind}@${b.at}(${b.confidence})`).join(' '), falseAlarms: falseAlarms.length, backchannels: ta.boundaries.filter((b) => b.kind === 'backchannel').length, visibility: ta.overlap_visibility });
}
console.table(rows.filter((r) => r.speakers > 1 || r.truthEvents));
console.log(`truth events ${tp + fn}: detected ${tp} (recall ${(tp / (tp + fn)).toFixed(2)}), missed ${fn}; false alarms ${fp} (precision ${(tp / Math.max(1, tp + fp)).toFixed(2)}); event type right on ${kindsRight}/${tp}`);
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/overlap.json', JSON.stringify({ truthEvents: tp + fn, detected: tp, missed: fn, falseAlarms: fp, rows }, null, 1));
