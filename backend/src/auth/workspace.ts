import type { NextFunction, Request, Response } from 'express';
import { query } from '../db/client.js';

// Anonymous per-browser identity. The frontend generates a random UUID, keeps it
// in localStorage and sends it as X-Workspace-Id. Every call is stamped with it
// and every read is filtered by it. This isolates users from each other, but the
// UUID is a bearer secret, not a login: anyone who has it can see that data.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Header for fetch(); ?ws= for <audio src>, PDF links and the WebSocket, which cannot set headers.
export function workspaceId(req: Request): string | null {
  const raw = req.header('x-workspace-id') ?? (typeof req.query.ws === 'string' ? req.query.ws : '');
  return UUID.test(raw) ? raw.toLowerCase() : null;
}

export function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  const id = workspaceId(req);
  if (!id) {
    return res.status(400).json({ error: 'workspace_required', message: 'Send a valid X-Workspace-Id header (UUID).' });
  }
  res.locals.workspaceId = id;
  next();
}

export function isWorkspaceId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

// Calls with no owner are system-generated (chaos, A/B, seeded demo) and readable by anyone.
export async function ownsCall(callId: string, ws: string | null): Promise<boolean> {
  const { rows } = await query('SELECT 1 FROM calls WHERE id=$1 AND (owner_id IS NULL OR owner_id=$2)', [callId, ws]);
  return rows.length > 0;
}
