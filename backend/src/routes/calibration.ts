import { Router } from 'express';
import { query } from '../db/client.js';

export const calibrationRouter = Router();

calibrationRouter.get('/calibration/trend', async (_req, res) => {
  const { rows } = await query(`
    SELECT
      date_trunc('hour', started_at) AS bucket,
      COUNT(*)::int AS total,
      SUM(CASE WHEN injected_fault = predicted_category THEN 1 ELSE 0 END)::int AS correct
    FROM calls
    WHERE injected_fault IS NOT NULL AND started_at > now() - interval '24 hours'
    GROUP BY bucket ORDER BY bucket ASC
  `);
  res.json({ trend: rows });
});

calibrationRouter.get('/calibration/mistakes', async (_req, res) => {
  const { rows } = await query(`
    SELECT id, started_at, injected_fault, predicted_category, classifier_confidence, stt_provider_used
    FROM calls
    WHERE injected_fault IS NOT NULL AND predicted_category IS NOT NULL
      AND injected_fault <> predicted_category
    ORDER BY started_at DESC LIMIT 25
  `);
  res.json({ mistakes: rows });
});

calibrationRouter.get('/calibration', async (_req, res) => {
  const { rows } = await query(`
    SELECT injected_fault, predicted_category, COUNT(*)::int AS n
    FROM calls
    WHERE injected_fault IS NOT NULL AND predicted_category IS NOT NULL
    GROUP BY injected_fault, predicted_category
  `);

  const perLabel: Record<string, { tp: number; fp: number; fn: number; total_actual: number }> = {};
  let correct = 0;
  let total = 0;
  for (const r of rows as any[]) {
    total += r.n;
    if (r.injected_fault === r.predicted_category) correct += r.n;

    perLabel[r.injected_fault] ??= { tp: 0, fp: 0, fn: 0, total_actual: 0 };
    perLabel[r.predicted_category] ??= { tp: 0, fp: 0, fn: 0, total_actual: 0 };

    perLabel[r.injected_fault].total_actual += r.n;
    if (r.injected_fault === r.predicted_category) {
      perLabel[r.injected_fault].tp += r.n;
    } else {
      perLabel[r.injected_fault].fn += r.n;
      perLabel[r.predicted_category].fp += r.n;
    }
  }

  const perLabelStats = Object.fromEntries(
    Object.entries(perLabel).map(([label, m]) => {
      const precision = m.tp + m.fp === 0 ? 0 : m.tp / (m.tp + m.fp);
      const recall = m.tp + m.fn === 0 ? 0 : m.tp / (m.tp + m.fn);
      return [label, { ...m, precision, recall }];
    }),
  );

  res.json({
    total,
    correct,
    accuracy: total ? correct / total : 0,
    confusionMatrix: rows,
    perLabel: perLabelStats,
  });
});
