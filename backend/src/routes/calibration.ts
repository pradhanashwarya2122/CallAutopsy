import { Router } from 'express';
import { query } from '../db/client.js';
import { requireWorkspace } from '../auth/workspace.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { runCall } from '../pipeline/orchestrator.js';
import { readSample } from '../sampleLibrary.js';
import { remainingQuota } from '../limits.js';
import { budgetGuard } from '../cost/budget.js';
import { ipAllows } from '../abuse.js';

export const calibrationRouter = Router();
calibrationRouter.use('/calibration', requireWorkspace);

// Ground truth is the injected fault, or "ok" for a control call made on purpose (a calibration run's clean call). A real upload,
// recording or unlabelled clean run can legitimately fail, so it is not ground truth and is left out. Only finished calls count.
const TRUTH = `COALESCE(injected_fault, 'ok')`;
const FINISHED = `owner_id = $1 AND status IN ('completed','failed') AND predicted_category IS NOT NULL AND (injected_fault IS NOT NULL OR label_source = 'control')`;

calibrationRouter.get('/calibration/trend', async (_req, res) => {
  const { rows } = await query(
    `SELECT date_trunc('hour', started_at) AS bucket, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ${TRUTH} = predicted_category)::int AS correct
     FROM calls WHERE ${FINISHED} AND started_at > now() - interval '24 hours'
     GROUP BY bucket ORDER BY bucket ASC`,
    [res.locals.workspaceId],
  );
  res.json({ trend: rows });
});

calibrationRouter.get('/calibration/mistakes', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, started_at, ${TRUTH} AS injected_fault, predicted_category, classifier_confidence, stt_provider_used
     FROM calls WHERE ${FINISHED} AND ${TRUTH} <> predicted_category
     ORDER BY started_at DESC LIMIT 25`,
    [res.locals.workspaceId],
  );
  res.json({ mistakes: rows });
});

calibrationRouter.get('/calibration', async (_req, res) => {
  const ws: string = res.locals.workspaceId;
  const { rows } = await query(
    `SELECT ${TRUTH} AS injected_fault, predicted_category, COUNT(*)::int AS n
     FROM calls WHERE ${FINISHED} GROUP BY 1, 2`,
    [ws],
  );
  const perLabel: Record<string, { tp: number; fp: number; fn: number; total_actual: number }> = {};
  let correct = 0;
  let total = 0;
  let faultRuns = 0;
  for (const r of rows as any[]) {
    total += r.n;
    if (r.injected_fault !== 'ok') faultRuns += r.n;
    if (r.injected_fault === r.predicted_category) correct += r.n;
    perLabel[r.injected_fault] ??= { tp: 0, fp: 0, fn: 0, total_actual: 0 };
    perLabel[r.predicted_category] ??= { tp: 0, fp: 0, fn: 0, total_actual: 0 };
    perLabel[r.injected_fault].total_actual += r.n;
    if (r.injected_fault === r.predicted_category) perLabel[r.injected_fault].tp += r.n;
    else { perLabel[r.injected_fault].fn += r.n; perLabel[r.predicted_category].fp += r.n; }
  }
  const perLabelStats = Object.fromEntries(
    Object.entries(perLabel).map(([label, m]) => {
      // null, not 0: a label that was never predicted (or never injected) has no precision (or recall) to report
      const precision = m.tp + m.fp === 0 ? null : m.tp / (m.tp + m.fp);
      const recall = m.tp + m.fn === 0 ? null : m.tp / (m.tp + m.fn);
      return [label, { ...m, precision, recall }];
    }),
  );
  res.json({ total, faultRuns, cleanRuns: total - faultRuns, correct, accuracy: total ? correct / total : 0, confusionMatrix: rows, perLabel: perLabelStats, running: running.has(ws) });
});

// Builds calibration data in one click: every fault type once on each chosen demo call, plus one clean run per call.
// One call gives a single data point per label, so up to CALIBRATION_MAX_CALLS calls can be chosen for a sturdier sample.
export const CALIBRATION_MAX_CALLS = 3;
const running = new Set<string>();
calibrationRouter.post('/calibration/run', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const raw = Array.isArray(req.body?.sampleIds) ? req.body.sampleIds : [req.body?.sampleId];
  const ids = [...new Set(raw.map((x: unknown) => String(x ?? '')))].filter(Boolean) as string[];
  if (ids.length === 0 || ids.length > CALIBRATION_MAX_CALLS) {
    return res.status(400).json({ error: 'bad_request', message: `Choose between 1 and ${CALIBRATION_MAX_CALLS} demo calls.` });
  }
  const samples = [];
  for (const id of ids) {
    const sample = await readSample(id);
    if (!sample) return res.status(404).json({ error: 'unknown_sample', message: 'That demo call does not exist.' });
    samples.push({ id, ...sample });
  }
  // Claimed before any await, so two requests arriving together cannot both start a run.
  if (running.has(ws)) return res.status(409).json({ error: 'already_running', message: 'A calibration run is already in progress.' });
  running.add(ws);
  const jobs = samples.flatMap((s) => [null, ...ALL_FAULTS].map((fault) => ({ s, fault: fault as FaultType | null })));
  try {
    if ((await remainingQuota(ws)) < jobs.length) {
      running.delete(ws);
      return res.status(429).json({ error: 'daily_limit', message: `This run needs ${jobs.length} analyses and you have fewer left today.` });
    }
    if (!(await budgetGuard()).ok) { running.delete(ws); return res.status(402).json({ error: 'budget_cap', message: 'The demo has hit its spend cap for now.' }); }
  } catch (e) { running.delete(ws); throw e; }
  if (!ipAllows(req, res, jobs.length)) { running.delete(ws); return; }
  res.json({ started: true, total: jobs.length, calls: ids.length });
  (async () => {
    try {
      for (let i = 0; i < jobs.length; i += 3) {
        await Promise.all(jobs.slice(i, i + 3).map(({ s, fault }) =>
          runCall({ audio: s.buf, inputSource: 'sample', sampleId: s.id, faultType: fault, audioExt: s.ext, ownerId: ws, labelSource: fault === null ? 'control' : undefined })
            .catch((e) => console.error('[calibration]', (e as Error).message))));
      }
    } finally {
      running.delete(ws);
    }
  })();
});
