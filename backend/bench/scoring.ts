// Scores the analysis of one demo call against test/groundTruth.ts. Shared by the fixture benchmark (bench/analysis-benchmark.ts)
// and the live one that goes through the real API (bench/regression-live.ts), so the two can never disagree about what "correct" is.
import { numberAccuracy, numberTokens, wordErrorRate } from '../src/analysis/wer.js';
import { scriptPlain, loadManifest } from '../src/sampleLibrary.js';
import { TRUTH } from '../test/groundTruth.js';

export type Tally = { ok: number; total: number; notes: string[] };
export const newMatrix = () => ({} as Record<string, Tally>);
const manifest = await loadManifest();
// Numbers compared as digit strings, whether the transcript wrote them as digits or spelled them out (Whisper often does).
const digits = (s: string) => { const t = numberTokens(s); return t.length ? t.join('') : s.toLowerCase().replace(/[^a-z0-9]/g, ''); };
const numsOf = (a: any): string[] => {
  if (!a?.understanding) return [];
  return Object.values(a.understanding.entities as Record<string, string[]>).flat().map((v) => digits(v).replace(/^0+/, ''));
};

export function scoreCall(M: Record<string, Tally>, id: string, a: any, transcript: string) {
  const truth = TRUTH[id];
  const tally = (k: string, ok: boolean, note?: string) => { const t = (M[k] ??= { ok: 0, total: 0, notes: [] }); t.total += 1; if (ok) t.ok += 1; else if (note) t.notes.push(note); };
  const u = a.understanding;
  const short = id.replace(/^(stress-\d+|call-\d).*/, '$1');

  const script = scriptPlain(manifest.get(`${id}.wav`)) ?? '';
  const w = wordErrorRate(script, transcript);
  const ws = wordErrorRate(script, transcript, { strict: true });
  const n = numberAccuracy(script, transcript);
  tally('STT: normalized WER <= 10%', w.wer <= 0.1, `${short} ${(w.wer * 100).toFixed(0)}%`);
  tally('STT: numbers heard exactly', n.matched === n.expected, `${short} ${n.matched}/${n.expected}`);
  tally('Diarization: speaker count', a.attribution.speakers === truth.speakers, `${short} got ${a.attribution.speakers} want ${truth.speakers}`);
  tally('Diarization: labels reliable when verified', a.attribution.reliable);
  if (u) {
    tally('Intent: primary correct', truth.intent.includes(u.primary_intent.label), `${short} got ${u.primary_intent.label}`);
    const gotIntents = new Set<string>([u.primary_intent.label, ...u.secondary_intents.map((i: any) => i.label)]);
    if (truth.secondary?.length) tally('Intent: all expected further intents found', truth.secondary.every((s) => gotIntents.has(s)), `${short} got ${[...gotIntents].join(',')}`);
    if (truth.secondaryAnyOf?.length) tally('Intent: at least one expected further intent found', truth.secondaryAnyOf.some((s) => gotIntents.has(s)), `${short} got ${[...gotIntents].join(',')}`);
    const heard = numsOf(a);
    const want = truth.customerNumbers.map((x) => x.replace(/^0+/, ''));
    const missing = want.filter((x) => !heard.includes(x));
    tally('Entities: customer details found', missing.length === 0, `${short} missing ${missing.join(',')} in [${heard.join(',')}]`);
    const allowed = new Set([...want, ...(truth.corrections ?? []).flatMap((c) => [c.from, c.to]).map((x) => digits(x)), ...(truth.agentOnlyNumbers ?? [])]);
    const stray = heard.filter((x) => /^\d+$/.test(x) && x.length >= 2 && !allowed.has(x) && !want.some((wv) => wv.includes(x) || x.includes(wv)));
    tally('Entities: no invented or merged values', stray.length === 0, `${short} stray ${stray.join(',')}`);
    if (truth.agentOnlyNumbers?.length) {
      tally('Attribution: agent-only values not credited to the customer', truth.agentOnlyNumbers.every((x) => !heard.includes(x)), `${short} customer list has ${heard.join(',')}`);
      tally('Attribution: agent-only values reported as agent-stated', truth.agentOnlyNumbers.every((x) => Object.values(u.agent_stated as Record<string, string[]>).flat().some((v) => digits(v) === x)), `${short} agent_stated=${JSON.stringify(u.agent_stated)}`);
    }
    for (const c of truth.corrections ?? []) {
      const hit = u.corrections.some((k: any) => (digits(k.original).includes(digits(c.from)) || digits(c.from).includes(digits(k.original))) && (digits(k.corrected).includes(digits(c.to)) || digits(c.to).includes(digits(k.corrected))));
      tally('Corrections: self-corrections captured', hit, `${short} ${c.from}->${c.to} got ${JSON.stringify(u.corrections)}`);
    }
    if (truth.ambiguity) tally('Ambiguity: unresolved state reported', u.ambiguities.length > 0, short);
    if (truth.emotion) {
      const lex = u.lexical_tone.emotion;
      if (lex === 'not_evident' || lex === 'neutral') tally('Emotion (words): abstained (none evident in the wording)', true);
      else tally('Emotion (words): asserted and consistent with styled delivery', truth.emotion.includes(lex), `${short} words say ${lex}`);
      const ov = a.tone.overall.label as string;
      if (a.tone.overall.agreement === 'insufficient' || ov.startsWith('mixed')) tally('Emotion (overall): abstained or flagged mixed', true);
      else tally('Emotion (overall): asserted and consistent with styled delivery', truth.emotion.includes(ov) || /delivery/.test(ov), `${short} overall ${ov}`);
    }
    if (truth.vocalArousal) {
      const cust = a.voices.find((v: any) => v.speaker === (u.customer_speaker ?? 0)) ?? a.voices[0];
      if (!cust || cust.arousal === 'unclear') tally('Vocal arousal: abstained (no claim)', true);
      else tally('Vocal arousal: claimed and correct', cust.arousal === truth.vocalArousal, `${short} vocal ${cust.arousal} want ${truth.vocalArousal} (${cust.cues.map((c: any) => c.id).join('+')})`);
    }
  } else {
    tally('Understanding available', false, `${short} ${a.understanding_error}`);
  }
  const ids = new Set<string>(a.findings.map((f: any) => f.id));
  for (const f of truth.findings) tally('Findings: expected finding present', ids.has(f), `${short} missing ${f}; has ${[...ids].join(',')}`);
  for (const f of truth.notFindings ?? []) tally('Findings: no false alarm', !ids.has(f), `${short} unexpected ${f}`);
  return { id: short, intent: u?.primary_intent.label, speakers: a.attribution.speakers, source: a.attribution.source, reliable: a.attribution.reliable, difficulty: a.difficulty.label, condition: a.signal?.condition.label, wer: +(w.wer * 100).toFixed(1), werStrict: +(ws.wer * 100).toFixed(1), numbers: `${n.matched}/${n.expected}`, lexTone: u?.lexical_tone.emotion, vocal: a.voices.map((v: any) => v.arousal).join('/'), overall: String(a.tone.overall.label).slice(0, 40), interrupts: a.speech.interruption_count, cost: +Number(a.cost_usd).toFixed(5) };
}

export function printMatrix(M: Record<string, Tally>) {
  console.log('\nACCURACY MATRIX');
  for (const [k, t] of Object.entries(M)) console.log(`${k.padEnd(66)} ${t.ok}/${t.total}  ${Math.round((t.ok / t.total) * 100)}%${t.notes.length ? '   FAIL: ' + t.notes.join(' | ').slice(0, 300) : ''}`);
}
