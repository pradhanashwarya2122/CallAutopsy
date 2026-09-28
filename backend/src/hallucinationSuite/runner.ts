import { query } from '../db/client.js';
import { llmTurn } from '../pipeline/llm.js';
import { detectHallucination } from '../classifier/grounding.js';
import { ADVERSARIAL_PROMPTS } from './prompts.js';

export async function runHallucinationSuite() {
  const results: Array<{ id: string; response: string; hallucinated: boolean; reasoning: string }> = [];
  for (const p of ADVERSARIAL_PROMPTS) {
    const r = await llmTurn(p.userText);
    const check = await detectHallucination(p.userText, r.text);
    results.push({ id: p.id, response: r.text, hallucinated: check.hallucinated, reasoning: check.reasoning });
  }
  const hallucinated = results.filter((r) => r.hallucinated).length;
  const { rows } = await query(
    'INSERT INTO hallucination_suite_runs (total_prompts, hallucinated_count, results) VALUES ($1,$2,$3) RETURNING id',
    [results.length, hallucinated, JSON.stringify(results)],
  );
  return { runId: rows[0].id, total: results.length, hallucinated, results };
}

export async function getHistory() {
  const { rows } = await query(
    'SELECT id, run_at, total_prompts, hallucinated_count FROM hallucination_suite_runs ORDER BY run_at DESC LIMIT 50',
  );
  return rows;
}

export async function getRun(id: string) {
  const { rows } = await query(
    'SELECT id, run_at, total_prompts, hallucinated_count, results FROM hallucination_suite_runs WHERE id=$1',
    [id],
  );
  return rows[0] ?? null;
}

export async function getAggregate(limitRuns = 10) {
  const { rows } = await query(
    'SELECT results FROM hallucination_suite_runs ORDER BY run_at DESC LIMIT $1',
    [limitRuns],
  );
  const agg: Record<string, { runs: number; hallucinated: number }> = {};
  for (const r of rows as any[]) {
    for (const res of r.results ?? []) {
      if (!agg[res.id]) agg[res.id] = { runs: 0, hallucinated: 0 };
      agg[res.id].runs += 1;
      if (res.hallucinated) agg[res.id].hallucinated += 1;
    }
  }
  return { window: rows.length, perPrompt: agg };
}
