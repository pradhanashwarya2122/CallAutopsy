// Removes the fabricated rows that older versions inserted (POST /demo/seed-data and `npm run seed-demo-data`).
//
//   npm run purge-synthetic                 # dry run: only counts
//   npm run purge-synthetic -- --yes        # delete the seeded calls (recognised by their fixed fake transcripts)
//   npm run purge-synthetic -- --yes --all-system   # also delete every ownerless call and its aggregates
//
// Rows created by real users always carry an owner_id, so they are never touched.
import 'dotenv/config';
import { pool, query } from '../db/client.js';

const args = new Set(process.argv.slice(2));
const yes = args.has('--yes');
const allSystem = args.has('--all-system');

const SEED_TRANSCRIPTS = [
  'What is the weather today?', 'Book a table for two.', 'Cancel my meeting.',
  'Book a table for two at seven.', 'Cancel my afternoon meeting.', 'What is Zorptech Industries?',
];
const WHERE = allSystem
  ? `owner_id IS NULL`
  : `owner_id IS NULL AND ab_run_id IS NULL AND redacted_transcript = ANY($1::text[])`;
const params = allSystem ? [] : [SEED_TRANSCRIPTS];

async function main() {
  const { rows: ids } = await query(`SELECT id FROM calls WHERE ${WHERE}`, params);
  console.log(`[purge] ${ids.length} call(s) match (${allSystem ? 'all ownerless calls' : 'seeded fake calls'}).`);
  const { rows: agg } = await query(
    `SELECT (SELECT COUNT(*)::int FROM healing_suggestions WHERE owner_id IS NULL) AS healing,
            (SELECT COUNT(*)::int FROM hallucination_suite_runs WHERE owner_id IS NULL) AS suite,
            (SELECT COUNT(*)::int FROM sla_breaches WHERE owner_id IS NULL) AS breaches,
            (SELECT COUNT(*)::int FROM ab_runs WHERE owner_id IS NULL) AS ab`,
  );
  console.log('[purge] ownerless aggregates:', agg[0], allSystem ? '(will be deleted)' : '(kept; add --all-system to remove)');
  if (!yes) { console.log('[purge] dry run. Re-run with --yes to delete.'); await pool.end(); return; }

  const list = ids.map((r: any) => r.id);
  if (list.length) {
    await query('DELETE FROM autopsy_reports WHERE call_id = ANY($1::uuid[])', [list]);
    await query('DELETE FROM call_stages WHERE call_id = ANY($1::uuid[])', [list]);
    await query('DELETE FROM calls WHERE id = ANY($1::uuid[])', [list]);
  }
  if (allSystem) {
    await query('DELETE FROM healing_suggestions WHERE owner_id IS NULL');
    await query('DELETE FROM hallucination_suite_runs WHERE owner_id IS NULL');
    await query('DELETE FROM sla_breaches WHERE owner_id IS NULL');
    await query('DELETE FROM ab_runs WHERE owner_id IS NULL');
  }
  console.log(`[purge] deleted ${list.length} call(s).`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
