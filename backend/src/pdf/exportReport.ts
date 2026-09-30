import { redactDeep, redactPII } from '../redaction/piiRedactor.js';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { query } from '../db/client.js';

const label = (x: string) => String(x ?? '').replace(/_/g, ' ');

export async function streamIncidentReport(callId: string, res: Response) {
  const { rows: callRows } = await query('SELECT * FROM calls WHERE id=$1', [callId]);
  if (!callRows.length) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const call = callRows[0];
  const { rows: stages } = await query(
    'SELECT * FROM call_stages WHERE call_id=$1 ORDER BY started_at ASC',
    [callId],
  );
  const { rows: reports } = await query(
    'SELECT report_text FROM autopsy_reports WHERE call_id=$1 ORDER BY generated_at DESC LIMIT 1',
    [callId],
  );

  const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="incident-${callId}.pdf"`);
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(18).text('INCIDENT REPORT');
  doc.moveDown(0.2);
  doc.font('Courier').fontSize(9).fillColor('#555').text(`Case ID: ${call.id}`);
  doc.text(`Opened: ${new Date(call.started_at).toISOString()}`);
  if (call.ended_at) doc.text(`Closed: ${new Date(call.ended_at).toISOString()}`);
  doc.fillColor('#000');
  doc.moveDown();

  doc.font('Helvetica-Bold').fontSize(12).text('CLASSIFICATION');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Outcome: ${call.predicted_category === 'ok' ? 'completed without a failure' : `failed - ${label(call.predicted_category ?? 'unknown')}`}`);
  doc.text(`Injected fault (ground truth): ${call.injected_fault ?? '(none)'}`);
  doc.text(`Classifier confidence: ${call.classifier_confidence ?? 0}`);
  doc.text(`Input source: ${call.input_source}`);
  doc.text(`STT provider: ${call.stt_provider_used ?? '(n/a)'}${call.stt_failover_occurred ? ' (failover)' : ''}`);
  doc.text(`Total cost (USD): ${Number(call.total_cost_usd ?? 0).toFixed(6)}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').fontSize(12).text('STAGE TIMELINE');
  doc.font('Helvetica').fontSize(10);
  for (const s of stages as any[]) {
    doc.text(
      `- ${s.stage.toUpperCase()} | ${s.provider ?? '-'} | ${s.status} | ${s.duration_ms}ms | $${Number(s.cost_usd ?? 0).toFixed(6)}`,
    );
  }
  doc.moveDown();

  // Everything printed is redacted again here, so rows stored before a redaction rule existed cannot leak through the report.
  const a = call.analysis ? redactDeep(call.analysis) : null;
  const u = a?.understanding;
  const who = (sp: number) => (a?.attribution?.speakers > 1 ? (u?.customer_speaker === sp ? 'Customer' : u?.customer_speaker == null ? `Voice ${sp + 1}` : 'Other voice') : 'Caller');
  if (u) {
    doc.font('Helvetica-Bold').fontSize(12).text('CALL UNDERSTANDING');
    doc.font('Helvetica').fontSize(10);
    doc.text(u.summary || '(no summary)');
    doc.moveDown(0.3);
    doc.text(`Primary intent: ${label(u.primary_intent?.label)}${u.primary_intent?.description ? ` - ${u.primary_intent.description}` : ''}`);
    for (const i of u.secondary_intents ?? []) doc.text(`Also: ${label(i.label)}${i.description ? ` - ${i.description}` : ''}`);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Tone (three separate readings)');
    doc.font('Helvetica');
    const lex = a.tone?.lexical ?? (u.sentiment ? { emotion: u.sentiment.emotion, intensity: u.sentiment.intensity, evidence: u.sentiment.evidence } : null);
    doc.text(`From the words: ${lex ? `${label(lex.emotion === 'not_evident' ? 'no emotion evident' : lex.emotion)}${lex.emotion === 'not_evident' ? '' : ` (${lex.intensity})`}${lex.evidence ? ` - "${lex.evidence}"` : ''}` : 'not assessed'}`);
    const v = a.tone?.vocal;
    doc.text(`From the voice: ${v ? `${v.arousal === 'unclear' ? 'no clear reading' : `${v.arousal} activation (${v.confidence} confidence)`}. ${v.cues?.length ? `${v.cues.join('; ')}. ` : ''}${v.reason}` : 'the audio could not be measured'}`);
    if (a.tone?.overall) doc.text(`Overall: ${a.tone.overall.label} (${a.tone.overall.confidence} confidence). ${a.tone.overall.basis}`);
    doc.moveDown(0.3);
    const groups: [string, any][] = [[a.attribution?.speakers > 1 && a.attribution?.reliable ? 'Details the customer gave' : 'Details heard', u.entities], ['Said only by the other voice', u.agent_stated], ['Heard, speaker unclear', u.unverified_speaker]];
    for (const [title, ent] of groups) {
      const rows = Object.entries({ 'Order numbers': ent?.order_ids, 'Transaction IDs': ent?.transaction_ids, Amounts: ent?.amounts, Dates: ent?.dates, Other: ent?.other }).filter(([, x]) => (x as string[])?.length) as [string, string[]][];
      if (!rows.length) continue;
      doc.font('Helvetica-Bold').text(title);
      doc.font('Helvetica');
      for (const [k, x] of rows) doc.text(`${k}: ${x.join(', ')}`);
    }
    for (const c of u.corrections ?? []) doc.text(`Correction (${c.field || 'detail'}): ${c.original} -> ${c.corrected}`);
    if (u.ambiguities?.length) { doc.moveDown(0.3); doc.font('Helvetica-Bold').text('Unclear or conflicting'); doc.font('Helvetica'); for (const x of u.ambiguities) doc.text(`- ${x}`); }
    if (u.off_topic_speech?.length) { doc.moveDown(0.3); doc.font('Helvetica-Bold').text('Words that are not part of the call'); doc.font('Helvetica'); for (const x of u.off_topic_speech) doc.text(`- "${x}"`); }
    if (u.next_steps?.length) { doc.moveDown(0.3); doc.font('Helvetica-Bold').text('Recommended next steps'); doc.font('Helvetica'); for (const x of u.next_steps) doc.text(`- ${x}`); }
    doc.moveDown();
  }
  if (a?.attribution) {
    doc.font('Helvetica-Bold').fontSize(12).text('SPEAKERS AND CONVERSATION');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Voices: ${a.attribution.speakers} (${a.attribution.source.replace('+', ' + ')}${a.attribution.reliable ? '' : ', NOT verified from the audio'}).`);
    for (const n of a.attribution.notes ?? []) doc.text(`Note: ${n}`);
    for (const b of (a.boundaries ?? []).filter((x: any) => x.kind === 'simultaneous' || x.kind === 'interruption')) doc.text(`- ${b.kind === 'simultaneous' ? 'Talking at the same time' : 'Interruption'} at ${b.at}s (confidence ${Math.round(b.confidence * 100)}%): ${b.evidence.join('; ')}`);
    if (a.overlap_visibility === 'limited') doc.text('Overlapping speech may be hidden: in a single-channel recording the recognizer usually keeps only the louder voice.');
    doc.moveDown(0.3);
    for (const t of a.turns ?? []) doc.text(`${who(t.speaker)}${t.uncertain ? ' (?)' : ''}${t.start != null ? ` [${t.start.toFixed(1)}s]` : ''}: ${t.text}`);
    for (const bgt of a.background ?? []) doc.text(`Background, not part of the call: "${bgt.text}"`);
    doc.moveDown();
  }
  if (a?.findings?.length) {
    doc.font('Helvetica-Bold').fontSize(12).text(`FINDINGS (difficulty: ${a.difficulty?.label ?? 'n/a'})`);
    doc.font('Helvetica').fontSize(10);
    for (const f of a.findings) doc.text(`- [${f.severity}] ${f.title}: ${f.detail}`);
    doc.moveDown();
  }

  if (call.redacted_transcript) {
    doc.font('Helvetica-Bold').fontSize(12).text('TRANSCRIPT (redacted)');
    doc.font('Helvetica').fontSize(10).text(redactPII(call.redacted_transcript));
    doc.moveDown();
  }

  if (reports[0]?.report_text) {
    doc.font('Helvetica-Bold').fontSize(12).text('POSTMORTEM');
    doc.font('Helvetica').fontSize(10).text(redactPII(reports[0].report_text), { align: 'justify' });
  }

  doc.end();
}
