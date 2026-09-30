import { query } from './db/client.js';

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024;
export const DAILY_CALL_LIMIT = Number(process.env.MAX_CALLS_PER_WORKSPACE_PER_DAY) || 25;

export async function dailyUsage(workspaceId: string): Promise<number> {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM calls WHERE owner_id=$1 AND started_at > now() - interval '24 hours'`,
    [workspaceId],
  );
  return rows[0]?.n ?? 0;
}

export async function remainingQuota(workspaceId: string): Promise<number> {
  return Math.max(0, DAILY_CALL_LIMIT - (await dailyUsage(workspaceId)));
}
