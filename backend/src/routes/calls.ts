import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';
import { enqueueCall } from '../queue/retryQueue.js';
import { readAudio } from '../storage/audioStore.js';
import { budgetGuard } from '../cost/budget.js';
import { requireWorkspace, workspaceId, ownsCall } from '../auth/workspace.js';
import { ALL_FAULTS, type FaultType } from '../pipeline/faultInjection.js';

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024;
export const DAILY_CALL_LIMIT = Number(process.env.MAX_CALLS_PER_WORKSPACE_PER_DAY) || 25;

const AUDIO_EXT = new Set(['wav', 'mp3', 'm4a', 'mp4', 'ogg', 'oga', 'webm', 'flac', 'aac', 'mpeg', 'mpga']);
const EXT_FROM_MIME: Record<string, string> = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/flac': 'flac',
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

const rateBuckets = new Map<string, number>();
export function rateLimited(key: string, minMs = 10000): boolean {
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    for (const [k, t] of rateBuckets) if (now - t > 3_600_000) rateBuckets.delete(k);
  }
  const last = rateBuckets.get(key) ?? 0;
  if (now - last < minMs) return true;
  rateBuckets.set(key, now);
  return false;
}

// Filename comes from the client, so never trust it as a path component.
function audioExt(originalName: string | undefined, mime: string | undefined): string | null {
  const fromName = originalName?.includes('.') ? originalName.split('.').pop()!.toLowerCase() : '';
  if (AUDIO_EXT.has(fromName)) return fromName === 'mpeg' || fromName === 'mpga' ? 'mp3' : fromName;
  const fromMime = EXT_FROM_MIME[(mime ?? '').split(';')[0].trim().toLowerCase()];
  return fromMime ?? null;
}

async function loadSample(sampleId: string): Promise<{ buf: Buffer; ext: string }> {
  const safe = path.basename(sampleId).replace(/[^a-zA-Z0-9._-]/g, '');
  const ext = safe.split('.').pop()?.toLowerCase() ?? '';
  if (!AUDIO_EXT.has(ext)) throw Object.assign(new Error('unknown sample'), { status: 404 });
  try {
    return { buf: await fs.readFile(path.resolve(process.cwd(), 'samples', safe)), ext };
  } catch {
    throw Object.assign(new Error('unknown sample'), { status: 404 });
  }
}

export const callsRouter = Router();

callsRouter.post('/calls', requireWorkspace, upload.single('audio'), async (req, res) => {
  const ws: string = res.locals.workspaceId;

  // A retry with the same Idempotency-Key returns the original call, never a 429.
  const rawKey = req.header('idempotency-key') || (req.body?.idempotencyKey as string | undefined);
  const idempotencyKey = rawKey ? `${ws}:${rawKey}` : null;
  if (idempotencyKey) {
    const { rows } = await query('SELECT id FROM calls WHERE idempotency_key=$1', [idempotencyKey]);
    if (rows.length) return res.json({ callId: rows[0].id, idempotent: true });
  }

  const rawFault = (req.body?.faultType || req.query.faultType || null) as string | null;
  const faultType = rawFault && rawFault !== 'none' ? (rawFault as FaultType) : null;
  if (faultType && !ALL_FAULTS.includes(faultType)) {
    return res.status(400).json({ error: 'bad_fault_type', message: `faultType must be one of: ${ALL_FAULTS.join(', ')}` });
  }
  const sampleId = (req.body?.sampleId || req.query.sampleId) as string | undefined;

  let config: any;
  let faultParams: any;
  try {
    const configRaw = req.body?.config;
    config = configRaw ? (typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw) : undefined;
    const faultParamsRaw = req.body?.faultParams;
    faultParams = faultParamsRaw ? (typeof faultParamsRaw === 'string' ? JSON.parse(faultParamsRaw) : faultParamsRaw) : undefined;
  } catch {
    return res.status(400).json({ error: 'bad_json', message: 'config / faultParams must be valid JSON.' });
  }

  let audio: Buffer;
  let ext: string;
  let inputSource: 'sample' | 'live_mic';
  if (req.file) {
    const e = audioExt(req.file.originalname, req.file.mimetype);
    if (!e) {
      return res.status(415).json({ error: 'unsupported_audio', message: 'Upload an audio file: wav, mp3, m4a, ogg, webm or flac.' });
    }
    if (req.file.size === 0) return res.status(400).json({ error: 'empty_audio', message: 'That recording is empty.' });
    audio = req.file.buffer;
    ext = e;
    inputSource = 'live_mic';
  } else if (sampleId) {
    const s = await loadSample(sampleId).catch(() => null);
    if (!s) return res.status(404).json({ error: 'unknown_sample', message: 'That sample does not exist.' });
    audio = s.buf;
    ext = s.ext;
    inputSource = 'sample';
  } else if (req.body?.audioBase64) {
    audio = Buffer.from(req.body.audioBase64, 'base64');
    ext = 'webm';
    inputSource = 'live_mic';
    if (audio.length === 0 || audio.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'bad_audio_size', maxBytes: MAX_UPLOAD_BYTES });
    }
  } else {
    return res.status(400).json({ error: 'no_audio', message: 'Send an audio file or a sampleId.' });
  }

  // Limits run after validation so a rejected upload does not use up the user's slot.
  const { rows: usage } = await query(
    `SELECT COUNT(*)::int AS n FROM calls WHERE owner_id=$1 AND started_at > now() - interval '24 hours'`,
    [ws],
  );
  if ((usage[0]?.n ?? 0) >= DAILY_CALL_LIMIT) {
    return res.status(429).json({
      error: 'daily_limit',
      limit: DAILY_CALL_LIMIT,
      message: `Daily limit of ${DAILY_CALL_LIMIT} analyses reached. It resets on a rolling 24-hour window.`,
    });
  }
  const budget = await budgetGuard();
  if (!budget.ok) return res.status(402).json({ error: 'budget_cap', message: 'The demo has hit its spend cap for now.', ...budget });
  if (rateLimited('calls:' + ws)) {
    return res.status(429).json({ error: 'rate_limited', message: 'One analysis every 10 seconds. Try again in a moment.' });
  }

  const callId = randomUUID();
  await query(
    `INSERT INTO calls (id, started_at, status, input_source, sample_id, injected_fault, idempotency_key, owner_id)
     VALUES ($1, now(), 'queued', $2, $3, $4, $5, $6)`,
    [callId, inputSource, sampleId ?? null, faultType, idempotencyKey, ws],
  );

  await enqueueCall({
    callId,
    ownerId: ws,
    audioBase64: audio.toString('base64'),
    inputSource,
    sampleId,
    faultType,
    faultParams,
    audioExt: ext,
    config,
  });

  res.json({ callId });
});

callsRouter.get('/calls', requireWorkspace, async (req, res) => {
  const ws: string = res.locals.workspaceId;
  const filters = ['owner_id = $1'];
  const params: any[] = [ws];
  const push = (frag: string, val: any) => {
    params.push(val);
    filters.push(frag.replace('?', `$${params.length}`));
  };
  if (req.query.category) push('predicted_category = ?', req.query.category);
  if (req.query.fault) push('injected_fault = ?', req.query.fault);
  if (req.query.source) push('input_source = ?', req.query.source);
  if (req.query.provider) push('stt_provider_used = ?', req.query.provider);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const { rows } = await query(
    `SELECT id, started_at, ended_at, status, input_source, sample_id, injected_fault,
            stt_provider_used, stt_failover_occurred, predicted_category, total_cost_usd
     FROM calls WHERE ${filters.join(' AND ')} ORDER BY started_at DESC LIMIT ${limit}`,
    params,
  );
  res.json({ calls: rows });
});

// Summary for the signed-in workspace: one query instead of the client stitching /status + /cost + /calls.
callsRouter.get('/me/summary', requireWorkspace, async (_req, res) => {
  const ws: string = res.locals.workspaceId;
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status='failed')::int AS failed,
       COUNT(*) FILTER (WHERE status IN ('queued','in_progress'))::int AS in_flight,
       COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL), 0)::float AS avg_latency_s,
       COALESCE(SUM(total_cost_usd), 0)::float AS total_cost_usd,
       COUNT(*) FILTER (WHERE started_at > now() - interval '24 hours')::int AS used_24h
     FROM calls WHERE owner_id=$1`,
    [ws],
  );
  const { rows: sla } = await query('SELECT max_failure_rate_pct FROM sla_config WHERE id=1');
  const r = rows[0];
  const finished = r.total - r.in_flight;
  res.json({
    total_calls: r.total,
    failures: r.failed,
    in_flight: r.in_flight,
    failure_rate: finished > 0 ? (r.failed / finished) * 100 : 0,
    avg_latency_s: r.avg_latency_s,
    total_cost_usd: r.total_cost_usd,
    sla_target_rate: Number(sla[0]?.max_failure_rate_pct ?? 5),
    daily_used: r.used_24h,
    daily_limit: DAILY_CALL_LIMIT,
    max_upload_bytes: MAX_UPLOAD_BYTES,
  });
});

callsRouter.get('/calls/:id', async (req, res) => {
  const ws = workspaceId(req);
  const { rows: callRows } = await query(
    'SELECT * FROM calls WHERE id=$1 AND (owner_id IS NULL OR owner_id=$2)',
    [req.params.id, ws],
  );
  if (!callRows.length) return res.status(404).json({ error: 'not_found' });
  const { owner_id: _owner, idempotency_key: _key, ...call } = callRows[0];
  const { rows: stages } = await query(
    'SELECT * FROM call_stages WHERE call_id=$1 ORDER BY started_at ASC',
    [req.params.id],
  );
  const { rows: reports } = await query(
    'SELECT report_text, generated_at FROM autopsy_reports WHERE call_id=$1 ORDER BY generated_at DESC LIMIT 1',
    [req.params.id],
  );
  res.json({ call, stages, autopsy: reports[0] ?? null });
});

callsRouter.get('/calls/:id/audio/:kind', async (req, res) => {
  if (!(await ownsCall(req.params.id, workspaceId(req)))) return res.status(404).json({ error: 'not_found' });
  const kind = req.params.kind === 'tts' ? 'tts' : 'input';
  const audio = await readAudio(req.params.id, kind);
  if (!audio) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', audio.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(audio.buf);
});
