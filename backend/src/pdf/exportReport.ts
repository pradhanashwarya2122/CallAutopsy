import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { query } from '../db/client.js';

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
  doc.text(`Cause of failure: ${call.predicted_category ?? '(none)'}`);
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

  if (call.redacted_transcript) {
    doc.font('Helvetica-Bold').fontSize(12).text('TRANSCRIPT (redacted)');
    doc.font('Helvetica').fontSize(10).text(call.redacted_transcript);
    doc.moveDown();
  }

  if (reports[0]?.report_text) {
    doc.font('Helvetica-Bold').fontSize(12).text('POSTMORTEM');
    doc.font('Helvetica').fontSize(10).text(reports[0].report_text, { align: 'justify' });
  }

  doc.end();
}
