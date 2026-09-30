import { randomUUID } from 'crypto';
import { query } from '../db/client.js';
import { runCall } from '../pipeline/orchestrator.js';
import type { FaultType, FaultParams } from '../pipeline/faultInjection.js';
import { readSample } from '../sampleLibrary.js';
import { remainingQuota } from '../limits.js';
import { redactPII } from '../redaction/piiRedactor.js';
import { budgetGuard } from '../cost/budget.js';
import { buildSideRuns, decideAbWinner } from './verdict.js';

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
  // called last, once every check has passed and just before paid calls start; returns an error to refuse (rate slot, network hour)
  charge?: () => AbError | null;
}): Promise<string> {
  const sample = await readSample(input.sampleId);
  if (!sample) throw new AbError(404, 'unknown_sample', 'That demo call does not exist.');
  const iterations = Math.min(AB_MAX_ITERATIONS, Math.max(1, Math.round(input.iterations || 1)));
  if ((await remainingQuota(input.ownerId)) < iterations * 2) {
    throw new AbError(429, 'daily_limit', `This run needs ${iterations * 2} analyses and you have fewer left today.`);
  }
  if (!(await budgetGuard()).ok) throw new AbError(402, 'budget_cap', 'The demo has hit its spend cap for now.');
  const refused = input.charge?.();
  if (refused) throw refused;

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
    // only the few analysis fields the comparison uses, not the whole JSON document, because this is polled every second or two
    `SELECT id, ab_side, stt_provider_used, stt_failover_occurred, predicted_category, status, total_cost_usd,
            redacted_transcript, started_at, ended_at,
            jsonb_build_object(
              'script_match', analysis->'script_match',
              'speech', jsonb_build_object('avg_confidence', analysis->'speech'->'avg_confidence'),
              'understanding', jsonb_build_object('primary_intent', analysis->'understanding'->'primary_intent')
            ) AS analysis
     FROM calls WHERE ab_run_id=$1 ORDER BY started_at ASC`,
    [runId],
  );
  const expected = (run.iterations ?? 0) * 2;
  const finished = calls.filter((c: any) => c.status === 'completed' || c.status === 'failed').length;
  const stale = Date.now() - new Date(run.created_at).getTime() > 5 * 60_000;
  const status = finished >= expected || stale ? 'done' : 'running';

  // Pipeline time = the three stages the comparison is about. The analysis runs in parallel and its wait is not part of either config.
  const { rows: stageRows } = await query(
    `SELECT s.call_id, SUM(s.duration_ms)::float AS ms FROM call_stages s JOIN calls c ON c.id=s.call_id
     WHERE c.ab_run_id=$1 AND s.stage IN ('stt','llm','tts') GROUP BY s.call_id`,
    [runId],
  );
  const pipelineS = new Map<string, number>(stageRows.map((r: any) => [r.call_id, Number(r.ms) / 1000]));
  const runsOf = (subset: any[]) => buildSideRuns(subset, pipelineS);
  const summarize = (subset: any[]) => {
    const r = runsOf(subset);
    const done = subset.filter((c) => c.status === 'completed' || c.status === 'failed');
    const confs = done.map((c) => c.analysis?.speech?.avg_confidence).filter((x: any) => typeof x === 'number');
    const first = done.find((c) => c.redacted_transcript);
    return {
      n: r.n,
      failed: r.failed,
      failureRate: r.n ? r.failed / r.n : 0,
      avgCostUsd: avg(r.costUsd) ?? 0,
      totalCostUsd: r.costUsd.reduce((a, b) => a + b, 0),
      avgLatencyS: avg(r.latencyS),
      avgWordErrorRate: avg(r.wer),
      avgSttConfidence: avg(confs),
      failoverCount: r.failovers,
      sampleTranscript: first ? redactPII(first.redacted_transcript) : null,
      primaryIntent: first?.analysis?.understanding?.primary_intent?.label ?? null,
    };
  };
  const side = (s: 'A' | 'B') => calls.filter((c: any) => c.ab_side === s);
  const A = summarize(side('A'));
  const B = summarize(side('B'));
  const verdict = status === 'done' ? decideAbWinner(runsOf(side('A')), runsOf(side('B')), runsOf(calls).wer.length > 0) : null;

  return {
    status,
    progress: { finished, expected },
    run: { id: run.id, config_a: run.config_a, config_b: run.config_b, fault_type: run.fault_type, sample_id: run.sample_id, iterations: run.iterations, created_at: run.created_at },
    calls: calls.map((c: any) => ({
      id: c.id, side: c.ab_side, stt_provider_used: c.stt_provider_used, failover: c.stt_failover_occurred,
      predicted_category: c.predicted_category, status: c.status, total_cost_usd: c.total_cost_usd,
      latency_s: pipelineS.get(c.id) ?? null,
      wer: c.analysis?.script_match?.wer ?? null,
    })),
    summary: { configA: A, configB: B },
    verdict,
  };
}
