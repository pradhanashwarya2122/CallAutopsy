// Decides an A/B comparison from per-run measurements. A side only "wins" a metric when the gap is practically meaningful AND
// the runs do not overlap (the slowest run of the faster side still beats the fastest run of the other); anything else is
// reported as no difference. Quality (failures, transcript accuracy) outranks speed and cost; conflicting quality results are
// a trade-off, not a winner.

export interface SideRuns {
  n: number; // finished calls
  failed: number;
  wer: number[]; // one value per run that had a reference script
  latencyS: number[]; // pipeline stage time per run (speech-to-text + reply + text-to-speech), not the wait for the analysis
  costUsd: number[];
  failovers: number; // runs where the requested speech-to-text provider failed and the other one answered
}

export type MetricId = 'failures' | 'accuracy' | 'speed' | 'cost';
export interface MetricResult {
  id: MetricId;
  label: string;
  a: number | null;
  b: number | null;
  better: 'A' | 'B' | 'none';
  significant: boolean;
  why: string;
}
export interface Verdict {
  winner: 'A' | 'B' | 'tie' | 'tradeoff' | 'insufficient';
  headline: string;
  reasons: string[];
  metrics: MetricResult[];
  caveats: string[];
}

export const MIN_RUNS_PER_SIDE = 2;

// One side's runs from stored calls. Time and cost are taken from completed calls only: a call that failed early stopped early, so
// its shorter time (and lower cost) would reward the failure, not the configuration.
export function buildSideRuns(calls: { id: string; status: string; total_cost_usd: unknown; stt_failover_occurred?: boolean; analysis?: any }[], pipelineSeconds: Map<string, number>): SideRuns {
  const done = calls.filter((c) => c.status === 'completed' || c.status === 'failed');
  const completed = done.filter((c) => c.status === 'completed');
  return {
    n: done.length,
    failed: done.length - completed.length,
    wer: done.map((c) => c.analysis?.script_match?.wer).filter((x): x is number => typeof x === 'number'),
    latencyS: completed.map((c) => pipelineSeconds.get(c.id)).filter((x): x is number => typeof x === 'number'),
    costUsd: completed.map((c) => Number(c.total_cost_usd ?? 0)),
    failovers: done.filter((c) => c.stt_failover_occurred).length,
  };
}
export const THRESHOLDS = {
  failureRateGap: 0.5, // a difference in failures must cover at least half of the runs
  werPoints: 0.03,
  latencyPct: 0.1,
  latencyMinS: 0.4,
  costPct: 0.1,
  costMinUsd: 0.0002,
} as const;

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
const range = (x: number[]) => [Math.min(...x), Math.max(...x)] as const;

// Lower-is-better metric with a practical gap and non-overlapping runs.
function compareLower(id: MetricId, label: string, a: number[], b: number[], minGap: (ma: number, mb: number) => number, fmt: (x: number) => string): MetricResult {
  const ma = mean(a);
  const mb = mean(b);
  if (ma === null || mb === null) return { id, label, a: ma, b: mb, better: 'none', significant: false, why: 'Not measured for one of the sides.' };
  const gap = Math.abs(ma - mb);
  const need = minGap(ma, mb);
  if (gap < need) return { id, label, a: ma, b: mb, better: 'none', significant: false, why: `A ${fmt(ma)} vs B ${fmt(mb)}: the gap is smaller than the ${fmt(need)} needed to count.` };
  const aBetter = ma < mb;
  const [loA, hiA] = range(a);
  const [loB, hiB] = range(b);
  const separated = aBetter ? hiA < loB : hiB < loA;
  if (!separated) return { id, label, a: ma, b: mb, better: 'none', significant: false, why: `A ${fmt(ma)} vs B ${fmt(mb)}: the individual runs overlap, so the gap could be run-to-run noise.` };
  return { id, label, a: ma, b: mb, better: aBetter ? 'A' : 'B', significant: true, why: `A ${fmt(ma)} vs B ${fmt(mb)}, and every run of the better side beats every run of the other.` };
}

export function decideAbWinner(A: SideRuns, B: SideRuns, hasReference: boolean): Verdict {
  const caveats: string[] = [];
  if (A.n < MIN_RUNS_PER_SIDE || B.n < MIN_RUNS_PER_SIDE) {
    return { winner: 'insufficient', headline: `Not enough runs for a verdict: each side needs at least ${MIN_RUNS_PER_SIDE} finished calls.`, reasons: [], metrics: [], caveats: [] };
  }
  if (A.failovers || B.failovers) caveats.push(`${A.failovers ? `Config A fell back to the other speech-to-text provider in ${A.failovers} run(s)` : ''}${A.failovers && B.failovers ? '; ' : ''}${B.failovers ? `Config B fell back in ${B.failovers} run(s)` : ''}, so the two sides did not always run the configuration they asked for.`);
  if (!hasReference) caveats.push('This call has no reference script, so transcript accuracy was not compared.');

  const metrics: MetricResult[] = [];
  const fa = A.failed / A.n;
  const fb = B.failed / B.n;
  const failGap = Math.abs(fa - fb);
  metrics.push({
    id: 'failures', label: 'Failed calls', a: fa, b: fb,
    better: failGap >= THRESHOLDS.failureRateGap ? (fa < fb ? 'A' : 'B') : 'none',
    significant: failGap >= THRESHOLDS.failureRateGap,
    why: failGap >= THRESHOLDS.failureRateGap ? `A failed ${A.failed} of ${A.n}, B failed ${B.failed} of ${B.n}.` : `A failed ${A.failed} of ${A.n}, B failed ${B.failed} of ${B.n}: too small a difference to count.`,
  });
  if (hasReference) {
    metrics.push(compareLower('accuracy', 'Transcript errors (word error rate)', A.wer, B.wer, () => THRESHOLDS.werPoints, (x) => `${Math.round(x * 1000) / 10}%`));
  }
  metrics.push(compareLower('speed', 'Pipeline time', A.latencyS, B.latencyS, (x, y) => Math.max(THRESHOLDS.latencyMinS, (x + y) * 0.5 * THRESHOLDS.latencyPct), (x) => `${x.toFixed(1)}s`));
  metrics.push(compareLower('cost', 'Cost per call', A.costUsd, B.costUsd, (x, y) => Math.max(THRESHOLDS.costMinUsd, (x + y) * 0.5 * THRESHOLDS.costPct), (x) => `$${x.toFixed(4)}`));

  const decisive = metrics.filter((m) => m.better !== 'none');
  const quality = decisive.filter((m) => m.id === 'failures' || m.id === 'accuracy');
  const reasons = decisive.map((m) => `${m.label}: ${m.why}`);
  const qA = quality.filter((m) => m.better === 'A').length;
  const qB = quality.filter((m) => m.better === 'B').length;

  let winner: Verdict['winner'];
  let headline: string;
  if (decisive.length === 0) {
    winner = 'tie';
    headline = 'No clear winner: none of the measured differences is big or consistent enough to count.';
  } else if (qA && qB) {
    winner = 'tradeoff';
    headline = 'No single winner: each side is better on a different quality measure.';
  } else if (qA || qB) {
    winner = qA ? 'A' : 'B';
    headline = `Config ${winner} is better on quality.`;
  } else {
    const a = decisive.filter((m) => m.better === 'A').length;
    const b = decisive.filter((m) => m.better === 'B').length;
    if (a && b) { winner = 'tradeoff'; headline = 'No single winner: one side is faster, the other cheaper.'; }
    else { winner = a ? 'A' : 'B'; headline = `Config ${winner} is ${decisive.map((m) => (m.id === 'speed' ? 'faster' : 'cheaper')).join(' and ')}, with no quality difference.`; }
  }
  if ((winner === 'A' || winner === 'B') && decisive.some((m) => m.better !== winner)) caveats.push('The other side is better on a lower-priority measure (see the table).');
  return { winner, headline, reasons, metrics, caveats };
}
