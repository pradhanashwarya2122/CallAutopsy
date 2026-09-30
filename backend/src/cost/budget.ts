import { query } from '../db/client.js';

// Two rolling counters:
//   session — process-lifetime, resets on restart
//   today   — sourced from db: today's calls plus other AI spend (hallucination suite, self-healing)
// Env vars:
//   SESSION_COST_CAP_USD (default 1.00)
//   DAILY_COST_CAP_USD   (default 5.00)

const SESSION_CAP = Number(process.env.SESSION_COST_CAP_USD ?? '1.00');
const DAILY_CAP = Number(process.env.DAILY_COST_CAP_USD ?? '5.00');

let sessionSpent = 0;

export function addSessionSpend(usd: number) {
  sessionSpent += Math.max(0, usd);
}

export function getSessionSpend() {
  return sessionSpent;
}

export async function getTodaySpend(): Promise<number> {
  const { rows } = await query(
    `SELECT (SELECT COALESCE(SUM(total_cost_usd),0) FROM calls WHERE started_at >= date_trunc('day', now()))::float
          + (SELECT COALESCE(SUM(cost_usd),0) FROM ai_spend WHERE at >= date_trunc('day', now()))::float AS s`,
  );
  return Number(rows[0]?.s ?? 0);
}

export function getCaps() {
  return { sessionCapUsd: SESSION_CAP, dailyCapUsd: DAILY_CAP };
}

export async function budgetGuard(): Promise<{ ok: true } | { ok: false; reason: string; details: any }> {
  const today = await getTodaySpend();
  if (sessionSpent >= SESSION_CAP) {
    return {
      ok: false,
      reason: 'session_cap',
      details: { sessionSpent, sessionCapUsd: SESSION_CAP },
    };
  }
  if (today >= DAILY_CAP) {
    return {
      ok: false,
      reason: 'daily_cap',
      details: { todaySpent: today, dailyCapUsd: DAILY_CAP },
    };
  }
  return { ok: true };
}
