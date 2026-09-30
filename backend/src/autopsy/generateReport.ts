import OpenAI from 'openai';
import 'dotenv/config';
import { query } from '../db/client.js';
import { llmCost } from '../cost/pricing.js';
import { redactPII } from '../redaction/piiRedactor.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function generateAutopsyReport(callId: string): Promise<string> {
  const { rows: callRows } = await query('SELECT * FROM calls WHERE id=$1', [callId]);
  if (!callRows.length) throw new Error('call not found');
  const call = callRows[0];
  const { rows: stages } = await query(
    'SELECT stage, provider, duration_ms, status, raw_meta FROM call_stages WHERE call_id=$1 ORDER BY started_at ASC',
    [callId],
  );

  const summary = {
    id: call.id,
    input_source: call.input_source,
    injected_fault: call.injected_fault,
    predicted_category: call.predicted_category,
    stt_provider_used: call.stt_provider_used,
    stt_failover_occurred: call.stt_failover_occurred,
    total_cost_usd: call.total_cost_usd,
    transcript: call.redacted_transcript,
    stages,
  };

  let text: string;
  let auxCost = 0;
  if (!openai) {
    text = `## Cause
Classified as ${call.predicted_category}.

## Chain of events
${stages.map((s: any, i: number) => `${i + 1}. ${s.stage} (${s.status}, ${s.duration_ms}ms)`).join('\n')}

## Contributing factors
STT served by ${call.stt_provider_used ?? 'unknown'}${call.stt_failover_occurred ? ' after failover from primary' : ''}.

## Recommendation
Investigate the ${call.predicted_category} pattern in aggregate on the Calibration page.`;
  } else {
    const prompt = `Write a postmortem for the following voice-AI call, in the tone of a clinical case-file report. Use EXACTLY these four markdown H2 sections, in this order, each with 1-3 sentences of prose (no bullet lists, no sub-headings):

## Cause
(what the classifier concluded, and the direct signal that led to it)

## Chain of events
(a short narrative of what happened stage by stage, mentioning provider names and timings)

## Contributing factors
(anything that made this call more likely to fail: cold cache, injected fault, provider failover, low STT confidence, etc.)

## Recommendation
(one concrete action an operator should take)

CALL DATA:
${JSON.stringify(summary, null, 2)}`;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });
    text = res.choices[0]?.message?.content ?? '(no report)';
    const pt = res.usage?.prompt_tokens ?? 0;
    const ct = res.usage?.completion_tokens ?? 0;
    auxCost = llmCost('gpt-4o-mini', pt, ct);
  }

  text = redactPII(text); // the model saw a redacted transcript, but its prose is stored, so it is redacted too
  await query('INSERT INTO autopsy_reports (call_id, report_text) VALUES ($1, $2)', [callId, text]);
  if (auxCost > 0) {
    await query(
      `UPDATE calls SET total_cost_usd = COALESCE(total_cost_usd, 0) + $2 WHERE id=$1`,
      [callId, auxCost],
    );
  }
  return text;
}
