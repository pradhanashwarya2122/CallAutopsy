// Records the raw Whisper response (with word timestamps) of demo calls to test/fixtures/whisper/, so the parser and the
// speaker separation on Whisper output are tested against real responses.   npx tsx bench/capture-whisper.ts <id> [<id> ...]
import fs from 'node:fs';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
for (const id of process.argv.slice(2)) {
  const res = await openai.audio.transcriptions.create({ file: await toFile(fs.readFileSync(`samples/${id}.wav`), 'audio.wav'), model: 'whisper-1', response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'] } as any);
  fs.writeFileSync(`test/fixtures/whisper/${id}.json`, `${JSON.stringify(res)}\n`);
  console.log(id, (res as any).words?.length, 'words', (res as any).segments?.length, 'segments');
}
