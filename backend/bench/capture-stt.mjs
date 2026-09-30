// Captures the real Deepgram output (words with timings, confidence and speaker labels) for every bundled demo call into
// test/fixtures/stt/, so the diarization / overlap / analysis tests can run offline against real recogniser output.
//   node bench/capture-stt.mjs [--only id1,id2]
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@deepgram/sdk';

const ROOT = path.resolve(import.meta.dirname, '..');
const dg = createClient(process.env.DEEPGRAM_API_KEY);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/manifest.json'), 'utf8'));
for (const s of manifest.samples) {
  if (only && !only.includes(s.id)) continue;
  const { result, error } = await dg.listen.prerecorded.transcribeFile(fs.readFileSync(path.join(ROOT, 'samples', s.id)), { model: 'nova-3', smart_format: true, punctuate: true, diarize: true, filler_words: true });
  if (error) { console.error(s.id, error.message); continue; }
  const alt = result.results.channels[0].alternatives[0];
  const words = alt.words.map((w) => ({ word: w.punctuated_word || w.word, confidence: w.confidence, start: w.start, end: w.end, speaker: w.speaker }));
  fs.writeFileSync(path.join(ROOT, 'test/fixtures/stt', s.id.replace(/\.wav$/, '.json')), `${JSON.stringify({ id: s.id, provider: 'deepgram', transcript: alt.transcript, duration: result.metadata.duration, words })}\n`);
  console.log(s.id, words.length, 'words', new Set(words.map((w) => w.speaker)).size, 'speaker labels');
}
