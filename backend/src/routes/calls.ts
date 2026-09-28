import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';
import { enqueueCall } from '../queue/retryQueue.js';
import { readAudio } from '../storage/audioStore.js';
import { budgetGuard } from '../cost/budget.js';
import type { FaultType } from '../pipeline/faultInjection.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const rateBuckets = new Map<string, number>();
export function rateLimited(key: string, minMs = 10000): boolean {
  const now = Date.now();
  const last = rateBuckets.get(key) ?? 0;
  if (now - last < minMs) return true;
  rateBuckets.set(key, now);
  return false;
}

async function loadSample(sampleId: string): Promise<{ buf: Buffer; ext: string }> {
  const safe = sampleId.replace(/[^a-zA-Z0-9._-]/g, '');
  const p = path.resolve(process.cwd(), 'samples', safe);
  const buf = await fs.readFile(p);
  const ext = safe.split('.').pop() ?? 'bin';
  return { buf, ext };
}

export const callsRouter = Router();

callsRouter.post('/calls', upload.single('audio'), async (req, res) => {
  const ip = req.ip ?? 'anon';
  if (rateLimited('calls:' + ip)) return res.status(429).json({ error: 'rate_limited' });

  const budget = await budgetGuard();
  if (!budget.ok) return res.status(402).json({ error: 'budget_cap', ...budget });

  const idempotencyKey = req.header('idempotency-key') || (req.body?.idempotencyKey as string | undefined);
  if (idempotencyKey) {
    const { rows } = await query('SELECT id FROM calls WHERE idempotency_key=$1', [idempotencyKey]);
    if (rows.length) return res.json({ callId: rows[0].id, idempotent: true });
  }

  try {
    const faultType = (req.body.faultType || req.query.faultType || null) as FaultType | null;
    const sampleId = (req.body.sampleId || req.query.sampleId) as string | undefined;
    const configRaw = req.body.config;
    const config = configRaw ? (typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw) : undefined;
    const faultParamsRaw = req.body.faultParams;
    const faultParams = faultParamsRaw
      ? (typeof faultParamsRaw === 'string' ? JSON.parse(faultParamsRaw) : faultParamsRaw)
      : undefined;

    let audio: Buffer;
    let ext = 'bin';
    let inputSource: 'sample' | 'live_mic';
    if (req.file) {
      audio = req.file.buffer;
      ext = (req.file.originalname.split('.').pop() ?? 'webm').toLowerCase();
      inputSource = 'live_mic';
    } else if (sampleId) {
      const s = await loadSample(sampleId);
      audio = s.buf;
      ext = s.ext;
      inputSource = 'sample';
    } else if (req.body.audioBase64) {
      audio = Buffer.from(req.body.audioBase64, 'base64');
      inputSource = 'live_mic';
    } else {
      return res.status(400).json({ error: 'either sampleId or audio blob required' });
    }

    const maxSec = Number(process.env.MAX_LIVE_RECORDING_SECONDS) || 15;
    if (inputSource === 'live_mic' && audio.length > maxSec * 200_000) {
      return res.status(400).json({ error: 'audio exceeds max size' });
    }

    const callId = randomUUID();
    await query(
      `INSERT INTO calls (id, started_at, status, input_source, sample_id, injected_fault, idempotency_key)
       VALUES ($1, now(), 'queued', $2, $3, $4, $5)`,
      [callId, inputSource, sampleId ?? null, faultType, idempotencyKey ?? null],
    );

    await enqueueCall({
      callId,
      audioBase64: audio.toString('base64'),
      inputSource,
      sampleId,
      faultType,
      faultParams,
      audioExt: ext,
      config,
    });

    res.json({ callId });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

callsRouter.get('/calls', async (req, res) => {
  const filters: string[] = [];
  const params: any[] = [];
  const push = (frag: string, val: any) => {
    params.push(val);
    filters.push(frag.replace('?', `$${params.length}`));
  };
  if (req.query.category) push('predicted_category = ?', req.query.category);
  if (req.query.fault) push('injected_fault = ?', req.query.fault);
  if (req.query.source) push('input_source = ?', req.query.source);
  if (req.query.provider) push('stt_provider_used = ?', req.query.provider);

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT id, started_at, ended_at, status, input_source, injected_fault,
            stt_provider_used, stt_failover_occurred, predicted_category, total_cost_usd
     FROM calls ${where} ORDER BY started_at DESC LIMIT 100`,
    params,
  );
  res.json({ calls: rows });
});

callsRouter.get('/calls/:id', async (req, res) => {
  const { rows: callRows } = await query('SELECT * FROM calls WHERE id=$1', [req.params.id]);
  if (!callRows.length) return res.status(404).json({ error: 'not_found' });
  const { rows: stages } = await query(
    'SELECT * FROM call_stages WHERE call_id=$1 ORDER BY started_at ASC',
    [req.params.id],
  );
  const { rows: reports } = await query(
    'SELECT report_text, generated_at FROM autopsy_reports WHERE call_id=$1 ORDER BY generated_at DESC LIMIT 1',
    [req.params.id],
  );
  res.json({ call: callRows[0], stages, autopsy: reports[0] ?? null });
});

callsRouter.get('/calls/:id/audio/:kind', async (req, res) => {
  const kind = req.params.kind === 'tts' ? 'tts' : 'input';
  const audio = await readAudio(req.params.id, kind);
  if (!audio) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', audio.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(audio.buf);
});
