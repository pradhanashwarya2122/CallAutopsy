import OpenAI from 'openai';
import 'dotenv/config';
import { query } from '../db/client.js';
import { llmCost } from '../cost/pricing.js';
import { recordSpend } from '../cost/ledger.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
// A failure type has to recur before a fix is worth suggesting.
export const HEALING_THRESHOLD = 3;

export async function generateSuggestions(ownerId: string) {
  const { rows } = await query(
    `SELECT predicted_category AS fault_type, COUNT(*)::int AS n
     FROM calls WHERE owner_id=$1 AND status='failed' AND predicted_category IS NOT NULL AND started_at > now() - interval '24 hours'
     GROUP BY predicted_category HAVING COUNT(*) >= $2`,
    [ownerId, HEALING_THRESHOLD],
  );

  const suggestions: any[] = [];
  for (const r of rows as any[]) {
    // one suggestion per failure type per two hours: clicking Generate again must not spend again or stack duplicates
    const { rows: fresh } = await query(
      `SELECT 1 FROM healing_suggestions WHERE owner_id=$1 AND fault_type IS NOT DISTINCT FROM $2 AND generated_at > now() - interval '2 hours' LIMIT 1`,
      [ownerId, r.fault_type],
    );
    if (fresh.length) continue;
    const { rows: recent } = await query(
      `SELECT predicted_category, stt_provider_used, total_cost_usd, injected_fault, sample_id
       FROM calls WHERE owner_id=$1 AND predicted_category=$2 ORDER BY started_at DESC LIMIT 10`,
      [ownerId, r.fault_type],
    );

    let text = '';
    if (openai) {
      const prompt = `You are a voice-AI SRE. The classifier has seen ${r.n} "${r.fault_type}" failures in the past 24 hours. Sample records:
${JSON.stringify(recent, null, 2)}

Note: records with an injected_fault were failures created on purpose for testing; say so if that explains the pattern, otherwise propose ONE concrete config change (2-3 sentences) that would reduce this failure. Reference specific stages, providers or thresholds.`;
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });
      text = res.choices[0]?.message?.content ?? '';
      await recordSpend(ownerId, 'healing', llmCost('gpt-4o-mini', res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0));
    } else {
      text = `${r.n} recent ${r.fault_type} failures observed; consider tightening the corresponding stage SLA or provider config.`;
    }

    const { rows: ins } = await query(
      'INSERT INTO healing_suggestions (fault_type, occurrence_count, suggestion_text, owner_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [r.fault_type, r.n, text, ownerId],
    );
    suggestions.push(ins[0]);
  }
  return suggestions;
}

export async function listSuggestions(ownerId: string) {
  const { rows } = await query(
    'SELECT id, fault_type, occurrence_count, suggestion_text, generated_at FROM healing_suggestions WHERE owner_id=$1 ORDER BY generated_at DESC LIMIT 30',
    [ownerId],
  );
  return rows;
}
