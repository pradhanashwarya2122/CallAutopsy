import { query } from '../db/client.js';
import { addSessionSpend } from './budget.js';

// Spend that does not belong to a pipeline call (the hallucination suite, self-healing suggestions). Recorded so the session and
// daily caps see it; without this those paths could spend without limit while the guard kept saying "ok".
export async function recordSpend(ownerId: string | null, kind: string, usd: number) {
  if (!(usd > 0)) return;
  addSessionSpend(usd);
  await query('INSERT INTO ai_spend (owner_id, kind, cost_usd) VALUES ($1,$2,$3)', [ownerId, kind, usd]).catch((e) => console.error('[ledger]', e.message));
}
