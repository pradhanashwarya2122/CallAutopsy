// End-to-end analysis benchmark on the bundled demo calls: real Deepgram output (test/fixtures/stt), the real audio, and the
// real language model for the understanding step, scored against test/groundTruth.ts. Needs OPENAI_API_KEY.
//   npx tsx bench/analysis-benchmark.ts [--json] [--only stress-04]
import fs from 'node:fs';
import { analyzeCall } from '../src/analysis/index.js';
import { TRUTH } from '../test/groundTruth.js';
import { newMatrix, printMatrix, scoreCall } from './scoring.js';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const M = newMatrix();
const perCall: any[] = [];
for (const id of Object.keys(TRUTH)) {
  if (only && !id.includes(only)) continue;
  const stt = JSON.parse(fs.readFileSync(`test/fixtures/stt/${id}.json`, 'utf8'));
  const a = await analyzeCall({ ...stt, audioDurationSec: stt.duration, rawMeta: {}, failoverOccurred: false } as any, fs.readFileSync(`samples/${id}.wav`));
  perCall.push(scoreCall(M, id, a, stt.transcript));
}
console.table(perCall);
printMatrix(M);
if (process.argv.includes('--json')) fs.writeFileSync('bench/results/analysis.json', JSON.stringify({ matrix: M, perCall }, null, 1));
