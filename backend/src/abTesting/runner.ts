import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '../db/client.js';
import { runCall } from '../pipeline/orchestrator.js';
import type { FaultType, FaultParams } from '../pipeline/faultInjection.js';

export interface AbConfig {
  llmModel?: string;
  preferredSttProvider?: 'deepgram' | 'whisper';
}

async function pickSample(): Promise<{ id: string; audio: Buffer }> {
  const dir = path.resolve(process.cwd(), 'samples');
  const files = (await fs.readdir(dir)).filter((f) => /\.(wav|mp3|ogg)$/i.test(f));
  if (!files.length) throw new Error('no bundled samples');
  const id = files[0];
  return { id, audio: await fs.readFile(path.join(dir, id)) };
}

export async function runAbTest(
  configA: AbConfig,
  configB: AbConfig,
  faultType: FaultType | null,
  iterations = 3,
  faultParams?: FaultParams,
) {
  const runId = randomUUID();
  await query(
    'INSERT INTO ab_runs (id, config_a, config_b, fault_type) VALUES ($1, $2, $3, $4)',
    [runId, configA, configB, faultType],
  );

  const { audio, id: sampleId } = await pickSample();
  for (let i = 0; i < iterations; i++) {
    await runCall({ audio, inputSource: 'sample', sampleId, faultType, faultParams, config: configA, abRunId: runId });
    await runCall({ audio, inputSource: 'sample', sampleId, faultType, faultParams, config: configB, abRunId: runId });
  }
  return runId;
}

export async function getAbResult(runId: string) {
  const { rows: runRows } = await query('SELECT * FROM ab_runs WHERE id=$1', [runId]);
  if (!runRows.length) return null;
  const { rows: calls } = await query(
    `SELECT id, stt_provider_used, predicted_category, status, total_cost_usd
     FROM calls WHERE ab_run_id=$1 ORDER BY started_at ASC`,
    [runId],
  );

  const summarize = (subset: any[]) => {
    const n = subset.length;
    const failed = subset.filter((c) => c.status === 'failed').length;
    const totalCost = subset.reduce((s, c) => s + Number(c.total_cost_usd ?? 0), 0);
    return {
      n,
      failed,
      failureRate: n ? failed / n : 0,
      avgCostUsd: n ? totalCost / n : 0,
      totalCostUsd: totalCost,
    };
  };
  const aCalls = calls.filter((_: any, i: number) => i % 2 === 0);
  const bCalls = calls.filter((_: any, i: number) => i % 2 === 1);

  return {
    run: runRows[0],
    calls,
    summary: { configA: summarize(aCalls), configB: summarize(bCalls) },
  };
}
