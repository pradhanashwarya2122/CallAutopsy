import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Operator-only endpoints (server-wide data, alerts that post to the operator's channels). A workspace id is not enough: these
// need the deployment's ADMIN_TOKEN, and are switched off entirely when none is configured.
export function isAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const given = req.header('x-admin-token') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (isAdmin(req)) return next();
  res.status(403).json({ error: 'admin_only', message: 'This endpoint is only available to the operator of this deployment.' });
}
