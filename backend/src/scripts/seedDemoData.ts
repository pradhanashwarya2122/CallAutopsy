import 'dotenv/config';
import { randomUUID } from 'crypto';
import { pool, query } from '../db/client.js';
import { ALL_FAULTS } from '../pipeline/faultInjection.js';

const N = 60;

const PROVIDERS = ['deepgram', 'whisper'] as const;
const FAULT_TO_CATEGORY: Record<string, string> = {
  bad_stt: 'bad_stt', hallucination: 'hallucination', tts_glitch: 'tts_glitch',
  timeout: 'timeout', user_hangup: 'user_hangup', network_drop: 'network_drop', exception: 'exception',
};

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pm(n: number, jitter = 0.2) { return n * (1 - jitter + Math.random() * jitter * 2); }

async function main() {
  console.log(`[seed] inserting ${N} synthetic calls…`);
  const now = Date.now();
  for (let i = 0; i < N; i++) {
    const started = new Date(now - Math.floor(Math.random() * 22 * 3600 * 1000));
    const injected = Math.random() < 0.85 ? pick(ALL_FAULTS) : null;
    const classifierRight = Math.random() < 0.88;
    const predicted = injected ? (classifierRight ? FAULT_TO_CATEGORY[injected] : pick(ALL_FAULTS)) : 'ok';
    const failed = predicted !== 'ok';
    const provider = Math.random() < 0.75 ? 'deepgram' : 'whisper';
    const failover = provider === 'whisper' && Math.random() < 0.6;
    const callId = randomUUID();

    // costs
    const sttDur = pm(1.8);
    const sttCost = provider === 'deepgram' ? sttDur * (0.0043 / 60) : sttDur * (0.006 / 60);
    const llmPT = Math.round(pm(120));
    const llmCT = Math.round(pm(60));
    const llmCostV = (llmPT / 1000) * 0.00015 + (llmCT / 1000) * 0.0006;
    const ttsChars = Math.round(pm(140));
    const ttsCostV = (ttsChars / 1000) * 0.015;
    const total = sttCost + llmCostV + ttsCostV;

    await query(
      `INSERT INTO calls (id, started_at, ended_at, status, input_source, sample_id, injected_fault,
         stt_provider_used, stt_failover_occurred, predicted_category, classifier_confidence,
         redacted_transcript, total_cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        callId,
        started,
        new Date(started.getTime() + Math.round((sttDur + 1) * 1000)),
        failed ? 'failed' : 'completed',
        Math.random() < 0.7 ? 'sample' : 'live_mic',
        Math.random() < 0.7 ? pick(['clean-1.mp3', 'clean-2.mp3', 'noisy-1.mp3']) : null,
        injected,
        provider,
        failover,
        predicted,
        0.7 + Math.random() * 0.25,
        pick(['What is the weather today?', 'Book a table for two at seven.', 'Cancel my afternoon meeting.', 'What is Zorptech Industries?']),
        total,
      ],
    );

    // stages
    const t0 = started.getTime();
    await query(
      `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [callId, 'stt', provider, new Date(t0), new Date(t0 + sttDur * 1000), Math.round(sttDur * 1000),
       injected === 'bad_stt' ? 'error' : 'ok', { duration: sttDur, wordCount: 6 }, sttCost],
    );
    const llmT0 = t0 + sttDur * 1000 + 100;
    const llmDur = pm(1.5);
    await query(
      `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [callId, 'llm', 'openai', new Date(llmT0), new Date(llmT0 + llmDur * 1000), Math.round(llmDur * 1000),
       injected === 'timeout' ? 'timeout' : 'ok', { model: 'gpt-4o-mini', prompt_tokens: llmPT, completion_tokens: llmCT }, llmCostV],
    );
    const ttsT0 = llmT0 + llmDur * 1000 + 50;
    const ttsDur = pm(1.2);
    await query(
      `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [callId, 'tts', 'openai', new Date(ttsT0), new Date(ttsT0 + ttsDur * 1000), Math.round(ttsDur * 1000),
       injected === 'tts_glitch' ? 'error' : 'ok', { model: 'tts-1', charCount: ttsChars, bytes: 12800 }, ttsCostV],
    );

    if (failed) {
      await query(
        `INSERT INTO autopsy_reports (call_id, report_text) VALUES ($1, $2)`,
        [callId, `## Cause\nClassified as ${predicted}${predicted !== injected ? ` (misclassified — ground truth was ${injected})` : ''}.\n\n## Chain of events\nSTT (${provider}) completed in ${Math.round(sttDur*1000)}ms; LLM turn ${Math.round(llmDur*1000)}ms; TTS ${Math.round(ttsDur*1000)}ms.\n\n## Contributing factors\n${failover ? 'Deepgram failed; failover to Whisper served the call.' : 'Primary STT provider served the call.'}\n\n## Recommendation\nInvestigate ${predicted} in aggregate on the Calibration page.`],
      );
    }
  }
  console.log(`[seed] done. inserted ${N} calls.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
