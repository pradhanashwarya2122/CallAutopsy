import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SAMPLES = [
  { id: 'clean-1.mp3', text: "What's the weather going to be like today?" },
  { id: 'clean-2.mp3', text: 'Book me a table for two at seven pm tonight.' },
  { id: 'noisy-1.mp3', text: 'uhhhhhh mrmmpph zzzt kkkkkksh mmm ehh.' },
];

async function main() {
  const dir = path.resolve(process.cwd(), 'samples');
  await fs.mkdir(dir, { recursive: true });
  for (const s of SAMPLES) {
    const p = path.join(dir, s.id);
    try {
      await fs.access(p);
      console.log('exists, skipping', s.id);
      continue;
    } catch {}
    const r = await openai.audio.speech.create({ model: 'tts-1', voice: 'alloy', input: s.text });
    await fs.writeFile(p, Buffer.from(await r.arrayBuffer()));
    console.log('wrote', s.id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
