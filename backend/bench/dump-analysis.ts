// Writes the real analysis object (real recogniser output + real language model) of some demo calls to a folder, for use as
// UI test fixtures.   npx tsx bench/dump-analysis.ts <outdir> <id> [<id> ...]
import fs from 'node:fs';
import path from 'node:path';
import { analyzeCall } from '../src/analysis/index.js';
import { sttOutcome, wavBuffer } from '../test/helpers.js';

const [out, ...ids] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const id of ids) {
  const a = await analyzeCall(sttOutcome(id), wavBuffer(id));
  fs.writeFileSync(path.join(out, `${id}.json`), `${JSON.stringify(a, null, 1)}\n`);
  console.log(id, a.understanding?.primary_intent.label, a.attribution.source);
}
