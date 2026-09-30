import { query } from '../db/client.js';
import { llmTurn } from '../pipeline/llm.js';
import { detectHallucination } from '../classifier/grounding.js';
import { ADVERSARIAL_PROMPTS } from './prompts.js';
import { llmCost } from '../cost/pricing.js';
import { recordSpend } from '../cost/ledger.js';

export async function runHallucinationSuite(ownerId: string) {
  // Prompts are independent, so they run in parallel (about 3 s instead of 20 s).
  const results = await Promise.all(ADVERSARIAL_PROMPTS.map(async (p) => {
    try {
      const r = await llmTurn(p.userText);
      const check = await detectHallucination(p.userText, r.text);
      return { id: p.id, response: r.text, hallucinated: check.hallucinated, reasoning: check.reasoning, cost: llmCost(r.model, r.promptTokens, r.completionTokens) + (check.auxCostUsd ?? 0) };
    } catch (e) {
      return { id: p.id, response: '', hallucinated: false, reasoning: `error: ${(e as Error).message.slice(0, 120)}`, error: true, cost: 0 };
    }
  }));
  await recordSpend(ownerId, 'hallucination_suite', results.reduce((sum, r: any) => sum + (r.cost ?? 0), 0));
  const valid = results.filter((r: any) => !r.error);
  const hallucinated = valid.filter((r) => r.hallucinated).length;
  const { rows } = await query(
    'INSERT INTO hallucination_suite_runs (total_prompts, hallucinated_count, results, owner_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [valid.length, hallucinated, JSON.stringify(results.map(({ cost: _c, ...rest }: any) => rest)), ownerId],
  );
  return { runId: rows[0].id, total: valid.length, hallucinated, results: results.map(({ cost: _c, ...rest }: any) => rest) };
}

export async function getHistory(ownerId: string) {
  const { rows } = await query(
    'SELECT id, run_at, total_prompts, hallucinated_count FROM hallucination_suite_runs WHERE owner_id=$1 ORDER BY run_at DESC LIMIT 50',
    [ownerId],
  );
  return rows;
}

export async function getRun(id: string, ownerId: string) {
  const { rows } = await query(
    'SELECT id, run_at, total_prompts, hallucinated_count, results FROM hallucination_suite_runs WHERE id=$1 AND owner_id=$2',
    [id, ownerId],
  );
  return rows[0] ?? null;
}

export async function getAggregate(ownerId: string, limitRuns = 10) {
  const { rows } = await query(
    'SELECT results FROM hallucination_suite_runs WHERE owner_id=$1 ORDER BY run_at DESC LIMIT $2',
    [ownerId, limitRuns],
  );
  const agg: Record<string, { runs: number; hallucinated: number }> = {};
  for (const r of rows as any[]) {
    for (const res of r.results ?? []) {
      if (res.error) continue;
      agg[res.id] ??= { runs: 0, hallucinated: 0 };
      agg[res.id].runs += 1;
      if (res.hallucinated) agg[res.id].hallucinated += 1;
    }
  }
  return { window: rows.length, perPrompt: agg };
}
