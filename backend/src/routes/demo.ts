import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCall } from '../pipeline/orchestrator.js';
import { ALL_FAULTS } from '../pipeline/faultInjection.js';
import { rateLimited } from './calls.js';

export const demoRouter = Router();

demoRouter.post('/demo/seeded-run', async (req, res) => {
  const ip = req.ip ?? 'anon';
  if (rateLimited('demo:' + ip, 30000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const samplesDir = path.resolve(process.cwd(), 'samples');
  let files: string[] = [];
  try {
    files = (await fs.readdir(samplesDir)).filter((f) => /\.(wav|mp3|ogg)$/i.test(f));
  } catch {
    return res.status(500).json({ error: 'no samples directory' });
  }
  if (!files.length) return res.status(500).json({ error: 'no bundled samples' });

  const faultParams = req.body?.faultParams;
  const ids: string[] = [];
  res.json({ started: true, faults: ALL_FAULTS });

  (async () => {
    for (const fault of ALL_FAULTS) {
      const sample = files[Math.floor(Math.random() * files.length)];
      const audio = await fs.readFile(path.join(samplesDir, sample));
      const ext = sample.split('.').pop() ?? 'bin';
      try {
        const { callId } = await runCall({
          audio,
          inputSource: 'sample',
          sampleId: sample,
          faultType: fault,
          faultParams,
          audioExt: ext,
        });
        ids.push(callId);
      } catch (e) {
        console.error('[seeded]', fault, (e as Error).message);
      }
    }
  })();
});
