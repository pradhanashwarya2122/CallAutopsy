import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCall } from '../pipeline/orchestrator.js';
import { ALL_FAULTS } from '../pipeline/faultInjection.js';
import { rateLimited } from './calls.js';
import { pool, query } from '../db/client.js';
import { randomUUID } from 'node:crypto';

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

// POST /demo/seed-data — inserts synthetic call rows directly into Postgres
// so a fresh deploy has content on first load. No provider calls, no cost.
// Safe to call multiple times; each run inserts N more rows.
demoRouter.post('/demo/seed-data', async (req, res) => {
  const n = Math.min(200, Math.max(10, Number(req.body?.count ?? 60)));
  const PROVIDERS = ['deepgram', 'whisper'] as const;
  const FAULTS = ['bad_stt', 'hallucination', 'tts_glitch', 'timeout', 'user_hangup', 'network_drop', 'exception'];
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
  const jitter = (x: number, j = 0.2) => x * (1 - j + Math.random() * j * 2);

  try {
    let inserted = 0;
    for (let i = 0; i < n; i++) {
      const started = new Date(Date.now() - Math.floor(Math.random() * 22 * 3600_000));
      const injected = Math.random() < 0.85 ? pick(FAULTS) : null;
      const classifierRight = Math.random() < 0.88;
      const predicted = injected ? (classifierRight ? injected : pick(FAULTS)) : 'ok';
      const failed = predicted !== 'ok';
      const provider = Math.random() < 0.75 ? 'deepgram' : 'whisper';
      const failover = provider === 'whisper' && Math.random() < 0.6;
      const callId = randomUUID();

      const sttDur = jitter(1.8);
      const sttCost = provider === 'deepgram' ? sttDur * (0.0043 / 60) : sttDur * (0.006 / 60);
      const llmPT = Math.round(jitter(120));
      const llmCT = Math.round(jitter(60));
      const llmCost = (llmPT / 1000) * 0.00015 + (llmCT / 1000) * 0.0006;
      const ttsChars = Math.round(jitter(140));
      const ttsCost = (ttsChars / 1000) * 0.015;
      const total = sttCost + llmCost + ttsCost;

      await query(
        `INSERT INTO calls (id, started_at, ended_at, status, input_source, sample_id, injected_fault,
           stt_provider_used, stt_failover_occurred, predicted_category, classifier_confidence,
           redacted_transcript, total_cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          callId, started, new Date(started.getTime() + Math.round((sttDur + 1) * 1000)),
          failed ? 'failed' : 'completed',
          Math.random() < 0.7 ? 'sample' : 'live_mic',
          Math.random() < 0.7 ? pick(['clean-1.mp3', 'clean-2.mp3', 'noisy-1.mp3']) : null,
          injected, provider, failover, predicted, 0.7 + Math.random() * 0.25,
          pick(['What is the weather today?', 'Book a table for two.', 'Cancel my meeting.']),
          total,
        ],
      );

      const t0 = started.getTime();
      await query(
        `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [callId, 'stt', provider, new Date(t0), new Date(t0 + sttDur * 1000), Math.round(sttDur * 1000),
         injected === 'bad_stt' ? 'error' : 'ok', { duration: sttDur }, sttCost],
      );
      const llmT0 = t0 + sttDur * 1000 + 100;
      const llmDur = jitter(1.5);
      await query(
        `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [callId, 'llm', 'openai', new Date(llmT0), new Date(llmT0 + llmDur * 1000), Math.round(llmDur * 1000),
         injected === 'timeout' ? 'timeout' : 'ok',
         { model: 'gpt-4o-mini', prompt_tokens: llmPT, completion_tokens: llmCT }, llmCost],
      );
      const ttsT0 = llmT0 + llmDur * 1000 + 50;
      const ttsDur = jitter(1.2);
      await query(
        `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [callId, 'tts', 'openai', new Date(ttsT0), new Date(ttsT0 + ttsDur * 1000), Math.round(ttsDur * 1000),
         injected === 'tts_glitch' ? 'error' : 'ok', { model: 'tts-1', charCount: ttsChars }, ttsCost],
      );

      if (failed) {
        await query(
          `INSERT INTO autopsy_reports (call_id, report_text) VALUES ($1, $2)`,
          [callId, `## Cause\nClassified as ${predicted}.\n\n## Chain of events\nSTT (${provider}) ${Math.round(sttDur*1000)}ms; LLM ${Math.round(llmDur*1000)}ms; TTS ${Math.round(ttsDur*1000)}ms.\n\n## Contributing factors\n${failover ? 'Deepgram failed; failover to Whisper served the call.' : 'Primary STT provider served the call.'}\n\n## Recommendation\nInvestigate ${predicted} on the Calibration page.`],
        );
      }
      inserted++;
    }
    res.json({ ok: true, inserted });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
