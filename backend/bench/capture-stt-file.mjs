// node bench/capture-stt-file.mjs in.wav out.json  — real Deepgram output for one file (same options as the pipeline)
import fs from 'node:fs';
import { createClient } from '@deepgram/sdk';
const dg = createClient(process.env.DEEPGRAM_API_KEY);
const [inp, out] = process.argv.slice(2);
const { result, error } = await dg.listen.prerecorded.transcribeFile(fs.readFileSync(inp), { model: 'nova-3', smart_format: true, punctuate: true, diarize: true, filler_words: true });
if (error) throw error;
const alt = result.results.channels[0].alternatives[0];
fs.writeFileSync(out, `${JSON.stringify({ provider: 'deepgram', transcript: alt.transcript, duration: result.metadata.duration, words: alt.words.map((w) => ({ word: w.punctuated_word || w.word, confidence: w.confidence, start: w.start, end: w.end, speaker: w.speaker })) })}\n`);
console.log(alt.transcript);
