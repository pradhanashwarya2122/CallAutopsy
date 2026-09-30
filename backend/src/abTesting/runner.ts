import { randomUUID } from 'crypto';
import { query } from '../db/client.js';
import { runCall } from '../pipeline/orchestrator.js';
import type { FaultType, FaultParams } from '../pipeline/faultInjection.js';
import { readSample } from '../sampleLibrary.js';
import { remainingQuota } from '../limits.js';
import { budgetGuard } from '../cost/budget.js';

export interface AbConfig {
  llmModel?: string;
  preferredSttProvider?: 'deepgram' | 'whisper';
}
export const AB_MAX_ITERATIONS = 5;
const ALLOWED_MODELS = new Set(['gpt-4o-mini', 'gpt-4o']);
const cleanConfig = (c: any): AbConfig => ({
  ...(c?.preferredSttProvider === 'whisper' || c?.preferredSttProvider === 'deepgram' ? { preferredSttProvider: c.preferredSttProvider } : {}),
  ...(ALLOWED_MODELS.has(c?.llmModel) ? { llmModel: c.llmModel } : {}),
});

export class AbError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Starts the run and returns immediately; the calls run in the background and the page polls for progress.
export async function startAbTest(input: {
  ownerId: string; sampleId: string; configA: any; configB: any;
  faultType: FaultType | null; faultParams?: FaultParams; iterations: number;
}): Promise<string> {
  const sample = await readSample(input.sampleId);
  if (!sample) throw new AbError(404, 'unknown_sample', 'That demo call does not exist.');
  const iterations = Math.min(AB_MAX_ITERATIONS, Math.max(1, Math.round(input.iterations || 1)));
  if ((await remainingQuota(input.ownerId)) < iterations * 2) {
    throw new AbError(429, 'daily_limit', `This run needs ${iterations * 2} analyses and you have fewer left today.`);
  }
  if (!(await budgetGuard()).ok) throw new AbError(402, 'budget_cap', 'The demo has hit its spend cap for now.');

  const configA = cleanConfig(input.configA);
  const configB = cleanConfig(input.configB);
  const runId = randomUUID();
  await query(
    'INSERT INTO ab_runs (id, config_a, config_b, fault_type, owner_id, sample_id, iterations, fault_params) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [runId, configA, configB, input.faultType, input.ownerId, input.sampleId, iterations, input.faultParams ? JSON.stringify(input.faultParams) : null],
  );

  const base = { audio: sample.buf, inputSource: 'sample' as const, sampleId: input.sampleId, faultType: input.faultType, faultParams: input.faultParams, audioExt: sample.ext, abRunId: runId, ownerId: input.ownerId };
  (async () => {
    for (let i = 0; i < iterations; i += 1) {
      await Promise.all([
        runCall({ ...base, config: configA, abSide: 'A' }).catch((e) => console.error('[ab]', (e as Error).message)),
        runCall({ ...base, config: configB, abSide: 'B' }).catch((e) => console.error('[ab]', (e as Error).message)),
      ]);
    }
  })();
  return runId;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function getAbResult(runId: string, ownerId: string) {
  const { rows: runRows } = await query('SELECT * FROM ab_runs WHERE id=$1 AND owner_id=$2', [runId, ownerId]);
  if (!runRows.length) return null;
  const run = runRows[0];
  const { rows: calls } = await query(
    `SELECT id, ab_side, stt_provider_used, stt_failover_occurred, predicted_category, status, total_cost_usd,
            redacted_transcript, started_at, ended_at, analysis
     FROM calls WHERE ab_run_id=$1 ORDER BY started_at ASC`,
    [runId],
  );
  const expected = (run.iterations ?? 0) * 2;
  const finished = calls.filter((c: any) => c.status === 'completed' || c.status === 'failed').length;
  const stale = Date.now() - new Date(run.created_at).getTime() > 5 * 60_000;
  const status = finished >= expected || stale ? 'done' : 'running';

  const summarize = (subset: any[]) => {
    const done = subset.filter((c) => c.status === 'completed' || c.status === 'failed');
    const failed = done.filter((c) => c.status === 'failed').length;
    const costs = done.map((c) => Number(c.total_cost_usd ?? 0));
    const latencies = done.filter((c) => c.ended_at).map((c) => (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 1000);
    const wers = done.map((c) => c.analysis?.script_match?.wer).filter((x: any) => typeof x === 'number');
    const confs = done.map((c) => c.analysis?.speech?.avg_confidence).filter((x: any) => typeof x === 'number');
    const first = done.find((c) => c.redacted_transcript);
    return {
      n: done.length,
      failed,
      failureRate: done.length ? failed / done.length : 0,
      avgCostUsd: avg(costs) ?? 0,
      totalCostUsd: costs.reduce((a, b) => a + b, 0),
      avgLatencyS: avg(latencies),
      avgWordErrorRate: avg(wers),
      avgSttConfidence: avg(confs),
      failoverCount: done.filter((c) => c.stt_failover_occurred).length,
      sampleTranscript: first?.redacted_transcript ?? null,
      primaryIntent: first?.analysis?.understanding?.primary_intent?.label ?? null,
    };
  };
  const side = (s: 'A' | 'B') => calls.filter((c: any) => c.ab_side === s);
  const A = summarize(side('A'));
  const B = summarize(side('B'));

  // The verdict names the metric that decided it, and says "no clear winner" instead of crowning noise.
  const reasons: string[] = [];
  let winner: 'A' | 'B' | 'tie' = 'tie';
  const decide = (a: number | null, b: number | null, minGap: number, lowerIsBetter: boolean, label: string, fmt: (x: number) => string) => {
    if (winner !== 'tie' || a === null || b === null) return;
    if (Math.abs(a - b) < minGap) return;
    const aWins = lowerIsBetter ? a < b : a > b;
    winner = aWins ? 'A' : 'B';
    reasons.push(`${label}: A ${fmt(a)} vs B ${fmt(b)}`);
  };
  if (status === 'done' && A.n && B.n) {
    decide(A.failureRate, B.failureRate, 0.19, true, 'Fewer failed calls', (x) => `${Math.round(x * 100)}%`);
    decide(A.avgWordErrorRate, B.avgWordErrorRate, 0.03, true, 'More accurate transcript (word error rate)', (x) => `${Math.round(x * 100)}%`);
    decide(A.avgLatencyS, B.avgLatencyS, Math.max(0.4, ((A.avgLatencyS ?? 0) + (B.avgLatencyS ?? 0)) * 0.1), true, 'Faster end to end', (x) => `${x.toFixed(1)}s`);
    decide(A.avgCostUsd, B.avgCostUsd, Math.max(0.0002, (A.avgCostUsd + B.avgCostUsd) * 0.1), true, 'Cheaper per call', (x) => `$${x.toFixed(4)}`);
  }

  return {
    status,
    progress: { finished, expected },
    run: { id: run.id, config_a: run.config_a, config_b: run.config_b, fault_type: run.fault_type, sample_id: run.sample_id, iterations: run.iterations, created_at: run.created_at },
    calls: calls.map((c: any) => ({
      id: c.id, side: c.ab_side, stt_provider_used: c.stt_provider_used, failover: c.stt_failover_occurred,
      predicted_category: c.predicted_category, status: c.status, total_cost_usd: c.total_cost_usd,
      latency_s: c.ended_at ? (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 1000 : null,
      wer: c.analysis?.script_match?.wer ?? null,
    })),
    summary: { configA: A, configB: B },
    verdict: { winner, reasons },
  };
}
