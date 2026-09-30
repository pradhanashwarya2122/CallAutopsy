// Checks what the language model extracted against the transcript itself, and attributes each value to the speaker(s) whose
// turns contain it. A value that is not in the transcript is dropped (the model must not invent details), and a value only the
// other speaker said is not reported as something the customer said.
import { numberTokens } from './wer.js';
import type { Turn } from './turns.js';

export const ENTITY_KEYS = ['order_ids', 'transaction_ids', 'amounts', 'dates', 'other'] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];
export type Entities = Record<EntityKey, string[]>;

export interface GroundingResult {
  customer: Entities; // said by the customer (or by both speakers)
  agent_stated: Entities; // said only by someone else
  unverified: Entities; // in the transcript, but who said it cannot be established
  dropped: string[]; // extracted but not found in the transcript
}

const emptyEntities = (): Entities => ({ order_ids: [], transaction_ids: [], amounts: [], dates: [], other: [] });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$.\s-]/g, ' ').replace(/\s+/g, ' ').trim();

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const TENS_WORD: Record<string, number> = { twenty: 20, thirty: 30 };

// Spoken ordinals ("the fourteenth", "twenty-first") as numbers, so a date said in words still matches "14" or "14th".
function ordinalsIn(text: string): number[] {
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/);
  const out: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] in ORDINALS) {
      const prev = words[i - 1];
      out.push(prev in TENS_WORD && ORDINALS[words[i]] < 10 ? TENS_WORD[prev] + ORDINALS[words[i]] : ORDINALS[words[i]]);
    }
  }
  return out;
}

// Digit strings found in a text: written numbers ("$59", "4,917"), spoken ("fifty-nine") and spoken digit-by-digit.
function numbersIn(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) set.add(m[0].replace(/,/g, ''));
  numberTokens(text).forEach((n) => set.add(n));
  ordinalsIn(text).forEach((n) => set.add(String(n)));
  return set;
}

// Does this extracted value literally occur in the text?
const IGNORED_WORDS = new Set(['the', 'and', 'dollars', 'dollar', 'cents', 'usd', 'order', 'number', 'amount', 'approximately', 'about']);

export function valueInText(value: string, text: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/\d/.test(v)) {
    // "March 5th" is only heard if "march" was said as well as a 5: the digits alone match any unrelated 5
    const words = (v.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !['st', 'nd', 'rd', 'th'].includes(w) && !IGNORED_WORDS.has(w));
    if (words.length && !words.every((w) => text.toLowerCase().includes(w))) return false;
    const core = v.replace(/[^\d.]/g, '').replace(/^\.+|\.+$/g, '');
    if (!core) return false;
    if (numbersIn(text).has(core)) return true;
    // a price written as two numbers ("36 70" for $36.70): its numbers must appear in the text one after the other
    const parts = v.match(/\d+/g) ?? [];
    if (parts.length > 1 && new RegExp(parts.map((x) => `(?<!\\d)${x}(?!\\d)`).join('\\D{1,4}')).test(text)) return true;
    // "ORD-4917" style identifiers: accept a literal (case-insensitive, separators ignored) match
    const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return /[a-z]/i.test(v) && compact(text).includes(compact(v));
  }
  // a number or ordinal written in words ("twenty-nine", "fourteenth") matches the same number written in digits
  const spelled = [...numberTokens(v), ...ordinalsIn(v).map(String)];
  if (spelled.length) { const have = numbersIn(text); if (spelled.every((n) => have.has(n))) return true; }
  // words (dates such as "last Friday"): every word must appear
  const words = norm(v).split(' ').filter((w) => w.length > 2);
  const hay = ` ${norm(text)} `;
  return words.length > 0 && words.every((w) => hay.includes(w));
}

export function groundEntities(entities: Entities, turns: Turn[], customerSpeaker: number | null, attributionKnown: boolean): GroundingResult {
  const out: GroundingResult = { customer: emptyEntities(), agent_stated: emptyEntities(), unverified: emptyEntities(), dropped: [] };
  const all = turns.map((t) => t.text).join(' ');
  for (const key of ENTITY_KEYS) {
    for (const value of entities[key]) {
      if (!valueInText(value, all)) { out.dropped.push(value); continue; }
      if (!attributionKnown || customerSpeaker === null) { out.unverified[key].push(value); continue; }
      const said = turns.filter((t) => valueInText(value, t.text));
      const byCustomer = said.some((t) => t.speaker === customerSpeaker);
      const byOthers = said.some((t) => t.speaker !== customerSpeaker);
      const onlyUncertain = said.length > 0 && said.every((t) => t.uncertain);
      if (onlyUncertain) out.unverified[key].push(value);
      else if (byCustomer) out.customer[key].push(value);
      else if (byOthers) out.agent_stated[key].push(value);
      else out.unverified[key].push(value);
    }
  }
  return out;
}

// Corrections are kept only when both the old and the new value were actually said.
export function groundCorrections<T extends { original: string; corrected: string }>(list: T[], turns: Turn[]): { kept: T[]; dropped: number } {
  const all = turns.map((t) => t.text).join(' ');
  const kept = list.filter((c) => valueInText(c.original, all) && valueInText(c.corrected, all));
  return { kept, dropped: list.length - kept.length };
}

// Fragments the model says are not part of the call are only trusted when they can be found verbatim in the transcript.
export function groundFragments(fragments: string[], transcript: string): string[] {
  const hay = norm(transcript);
  return fragments.filter((f) => f.trim().length >= 4 && hay.includes(norm(f)));
}

// A charge given as a bare 4-digit number ("It's 2299") is often a price spoken as "twenty-two ninety-nine". The transcript alone
// cannot tell, so it is always flagged for confirmation instead of being reported as a fact.
export function bareAmountAmbiguities(amounts: string[], transcript: string): string[] {
  const out: string[] = [];
  for (const a of amounts) {
    const v = a.trim();
    const pair = /^(\d{1,3})[ ,](\d{2})$/.exec(v); // "36 70": dollars and cents written as two numbers
    if (pair) { out.push(`Heard "${v}" as an amount written as two numbers; it may be $${pair[1]}.${pair[2]} and should be confirmed.`); continue; }
    if (!/^\d{4}$/.test(v)) continue;
    const occ = new RegExp(`(^|[^\\d$.,])${v}(?![\\d.,]?\\d)`, 'g');
    const text = transcript;
    let plain = false;
    for (const m of text.matchAll(occ)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 1), (m.index ?? 0) + 1);
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 9).toLowerCase();
      if (!before.includes('$') && !/^\s*(dollars?|usd|bucks)/.test(after)) plain = true;
    }
    if (plain) out.push(`Heard "${v}" as an amount without a currency or decimal point; it may be $${v.slice(0, 2)}.${v.slice(2)} (spoken as "${v.slice(0, 2)}, ${v.slice(2)}") and should be confirmed.`);
  }
  return out;
}

const MARKERS = new Set(['no', 'nope', 'sorry', 'wait', 'actually', 'rather', 'meant', 'mean', 'oops']);
const numOf = (w: string): string | null => {
  const t = w.replace(/^\$/, '').replace(/[,]/g, '');
  if (/^\d+(\.\d+)?$/.test(t)) return t;
  const o = ordinalsIn(w);
  return o.length ? String(o[0]) : null;
};

// "It says 40... No. 48 something", "$49 sorry, $59": two numbers close together with a correction word between them. Used to
// add corrections the language model missed; it is a plain pattern on the transcript, so nothing here is invented.
export function detectSpokenCorrections(text: string): { field: string; original: string; corrected: string }[] {
  const words = text.replace(/\.(?=\s|$)/g, ' ').split(/\s+/).map((w) => w.replace(/^[^\w$]+|[^\w]+$/g, '')).filter(Boolean);
  const out: { field: string; original: string; corrected: string }[] = [];
  let last: { at: number; value: string; raw: string } | null = null;
  for (let i = 0; i < words.length; i += 1) {
    const v = numOf(words[i]);
    if (v === null) continue;
    const intLen = (x: string) => x.split('.')[0].length;
    if (last && i - last.at - 1 <= 5 && last.value !== v && Math.abs(intLen(last.value) - intLen(v)) <= 1) { // same order of magnitude: 40 -> 48, not 5 -> 4821
      const between = words.slice(last.at + 1, i).map((w) => w.toLowerCase());
      if (between.some((w) => MARKERS.has(w))) out.push({ field: '', original: last.raw, corrected: words[i] });
    }
    last = { at: i, value: v, raw: words[i] };
  }
  return out;
}
