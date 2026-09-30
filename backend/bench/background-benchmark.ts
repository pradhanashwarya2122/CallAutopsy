// Background / non-call speech: transcribed words that fall outside every scripted line are environment speech (TV, chatter,
// station announcements). Compares them with the words the analysis marks as background.
import fs from 'node:fs';
import { readPcm16 } from '../src/analysis/audioIO.js';
import { extractFrames } from '../src/analysis/prosody.js';
import { diarize } from '../src/analysis/diarize.js';

const manifest = JSON.parse(fs.readFileSync('samples/manifest.json', 'utf8')).samples as any[];
const rows: any[] = [];
let tpAll = 0, fnAll = 0, fpAll = 0;
for (const s of manifest.filter((x) => x.timeline)) {
  const id = s.id.replace('.wav', '');
  const stt = JSON.parse(fs.readFileSync(`test/fixtures/stt/${id}.json`, 'utf8'));
  const truth = JSON.parse(fs.readFileSync(`samples/truth/${id}.json`, 'utf8')).segments as any[];
  const d = diarize(stt.words, extractFrames(readPcm16(fs.readFileSync(`samples/${s.id}`))!));
  let tp = 0, fn = 0, fp = 0; const missed: string[] = []; const falsely: string[] = [];
  stt.words.forEach((w: any, i: number) => {
    const mid = (w.start + w.end) / 2;
    const inLine = truth.some((t) => mid >= t.start - 0.3 && mid <= t.end + 0.3);
    const flagged = d.words[i].background;
    if (!inLine && flagged) tp += 1;
    else if (!inLine && !flagged) { fn += 1; missed.push(w.word); }
    else if (inLine && flagged) { fp += 1; falsely.push(w.word); }
  });
  tpAll += tp; fnAll += fn; fpAll += fp;
  rows.push({ id: id.slice(0, 34), envWords: tp + fn, flagged: tp, missed: fn, wronglyFlagged: fp, missedText: missed.slice(0, 6).join(' '), wrongText: falsely.slice(0, 6).join(' ') });
}
console.table(rows);
console.log(`environment words ${tpAll + fnAll}: flagged ${tpAll}; missed ${fnAll}; scripted words wrongly flagged ${fpAll}`);
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/background.json', JSON.stringify({ environmentWords: tpAll + fnAll, flagged: tpAll, missed: fnAll, scriptedWordsWronglyFlagged: fpAll, rows }, null, 1));
