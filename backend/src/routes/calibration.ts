import { Router } from 'express';
import { query } from '../db/client.js';
import { requireWorkspace } from '../auth/workspace.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';
import { runCall } from '../pipeline/orchestrator.js';
import { readSample } from '../sampleLibrary.js';
import { remainingQuota } from '../limits.js';
import { budgetGuard } from '../cost/budget.js';

export const calibrationRouter = Router();
calibrationRouter.use('/calibration', requireWorkspace);

// Ground truth is the injected fault; a call with no injected fault is truth "ok". Only finished calls count.
const TRUTH = `COALESCE(injected_fault, 'ok')`;
const FINISHED = `owner_id = $1 AND status IN ('completed','failed') AND predicted_category IS NOT NULL`;

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
      const precision = m.tp + m.fp === 0 ? 0 : m.tp / (m.tp + m.fp);
      const recall = m.tp + m.fn === 0 ? 0 : m.tp / (m.tp + m.fn);
      return [label, { ...m, precision, recall }];
    }),
  );
  res.json({ total, faultRuns, cleanRuns: total - faultRuns, correct, accuracy: total ? correct / total : 0, confusionMatrix: rows, perLabel: perLabelStats, running: running.has(ws) });
});

// Builds calibration data in one click: every fault type once on the chosen demo call, plus one clean run.
const running = new Set<string>();
calibrationRouter.post('/calibration/run', async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const sampleId = String(req.body?.sampleId ?? '');
  const sample = await readSample(sampleId);
  if (!sample) return res.status(404).json({ error: 'unknown_sample', message: 'That demo call does not exist.' });
  if (running.has(ws)) return res.status(409).json({ error: 'already_running', message: 'A calibration run is already in progress.' });
  const jobs: (FaultType | null)[] = [null, ...ALL_FAULTS];
  if ((await remainingQuota(ws)) < jobs.length) {
    return res.status(429).json({ error: 'daily_limit', message: `A calibration run needs ${jobs.length} analyses and you have fewer left today.` });
  }
  if (!(await budgetGuard()).ok) return res.status(402).json({ error: 'budget_cap', message: 'The demo has hit its spend cap for now.' });

  running.add(ws);
  res.json({ started: true, total: jobs.length });
  (async () => {
    try {
      for (let i = 0; i < jobs.length; i += 3) {
        await Promise.all(jobs.slice(i, i + 3).map((fault) =>
          runCall({ audio: sample.buf, inputSource: 'sample', sampleId, faultType: fault, audioExt: sample.ext, ownerId: ws })
            .catch((e) => console.error('[calibration]', (e as Error).message))));
      }
    } finally {
      running.delete(ws);
    }
  })();
});
