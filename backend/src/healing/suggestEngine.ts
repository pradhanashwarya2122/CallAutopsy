import OpenAI from 'openai';
import 'dotenv/config';
import { query } from '../db/client.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const THRESHOLD = 5;

export async function generateSuggestions() {
  const { rows } = await query(`
    SELECT predicted_category AS fault_type, COUNT(*)::int AS n
    FROM calls
    WHERE status='failed' AND started_at > now() - interval '24 hours'
    GROUP BY predicted_category
    HAVING COUNT(*) >= $1
  `, [THRESHOLD]);

  const suggestions: any[] = [];
  for (const r of rows as any[]) {
    const { rows: recent } = await query(
      `SELECT id, predicted_category, stt_provider_used, total_cost_usd, injected_fault
       FROM calls WHERE predicted_category=$1 ORDER BY started_at DESC LIMIT 10`,
      [r.fault_type],
    );

    let text = '';
    if (openai) {
      const prompt = `You are a voice-AI SRE. The classifier has seen ${r.n} "${r.fault_type}" failures in the past 24 hours. Sample records:
${JSON.stringify(recent, null, 2)}

Propose ONE concrete config change (2-3 sentences) that would reduce this failure. Reference specific stages, providers, or thresholds.`;
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });
      text = res.choices[0]?.message?.content ?? '';
    } else {
      text = `${r.n} recent ${r.fault_type} failures observed; consider tightening the corresponding stage SLA or provider config.`;
    }

    const { rows: ins } = await query(
      'INSERT INTO healing_suggestions (fault_type, occurrence_count, suggestion_text) VALUES ($1,$2,$3) RETURNING *',
      [r.fault_type, r.n, text],
    );
    suggestions.push(ins[0]);
  }
  return suggestions;
}

export async function listSuggestions() {
  const { rows } = await query(
    'SELECT * FROM healing_suggestions ORDER BY generated_at DESC LIMIT 30',
  );
  return rows;
}

let running = false;
export function startHealingMonitor(intervalMs = 15 * 60 * 1000) {
  if (running) return;
  running = true;
  const tick = async () => {
    try {
      const { rows: recent } = await query(
        `SELECT id FROM healing_suggestions WHERE generated_at > now() - interval '2 hours' LIMIT 1`,
      );
      if (!recent.length) await generateSuggestions();
    } catch (e) {
      console.error('[healing]', (e as Error).message);
    }
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, 60_000);
}
