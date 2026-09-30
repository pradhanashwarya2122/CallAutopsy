import type { Request, Response } from 'express';

// Workspace ids are minted by the browser, so anyone can make a fresh one and get a fresh per-workspace allowance. Paid actions are
// therefore also limited per network address: a sliding one-hour window of "units", where one analysis is one unit and larger
// actions (an A/B run, a calibration run, the hallucination suite) cost what they spend. Kept in memory: it protects a single
// instance from a script, not a fleet.
export const MAX_UNITS_PER_IP_PER_HOUR = Number(process.env.MAX_ANALYSES_PER_IP_PER_HOUR) || 60;
const WINDOW_MS = 3_600_000;
const hits = new Map<string, { at: number; units: number }[]>();

export function takeIpUnits(ip: string | undefined, units: number, now = Date.now(), max = MAX_UNITS_PER_IP_PER_HOUR): boolean {
  const key = ip || 'unknown';
  const recent = (hits.get(key) ?? []).filter((h) => now - h.at < WINDOW_MS);
  const used = recent.reduce((s, h) => s + h.units, 0);
  if (used + units > max) { hits.set(key, recent); return false; }
  recent.push({ at: now, units });
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((h) => now - h.at < WINDOW_MS)) hits.delete(k); // bounded memory
  return true;
}

export function resetIpUnits() { hits.clear(); }

// Sends the 429 and returns false when this network address has used up its hour.
export function ipAllows(req: Request, res: Response, units: number): boolean {
  if (takeIpUnits(req.ip, units)) return true;
  res.status(429).json({ error: 'ip_limit', message: 'Too many analyses from this network in the last hour. Try again later.' });
  return false;
}
