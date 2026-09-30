// Word error rate between a known script and what the STT heard. Used only for bundled demo calls, where the script is known.
// Both sides are normalised so "forty-seven ninety-nine", "$47.99" and "47 99" compare equal, and spoken digits collapse
// ("4 8 2 1 3" == "48213"): formatting differences are not recognition errors.
const FILLERS = new Set(['uh', 'um', 'uhm', 'uhh', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mmm']);
const DROP = new Set(['dollars', 'dollar', 'cents', 'cent']);
const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, string> = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', twelfth: '12th', fourteenth: '14th', fifteenth: '15th', twentieth: '20th' };

function numberWordsToDigits(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const isNum = (w?: string) => !!w && (w in UNITS || w in TENS || w === 'hundred');
    if (!isNum(t) || (t === 'oh' && !(isNum(tokens[i - 1]) || isNum(tokens[i + 1])))) { out.push(ORDINALS[t] ?? t); continue; }
    let value = 0;
    let used = false;
    while (i < tokens.length && isNum(tokens[i])) {
      const w = tokens[i];
      if (w === 'hundred') value = (value || 1) * 100;
      else if (w in TENS) { value += TENS[w]; if (i + 1 < tokens.length && tokens[i + 1] in UNITS && UNITS[tokens[i + 1]] < 10 && UNITS[tokens[i + 1]] > 0) { value += UNITS[tokens[i + 1]]; i += 1; } }
      else { value += UNITS[w]; }
      used = true;
      i += 1;
      // a new number starts when the next word is a tens/teen word after a completed value ("forty-seven ninety-nine", "eight fifty")
      if (isNum(tokens[i]) && (tokens[i] in TENS || (tokens[i] in UNITS && UNITS[tokens[i]] >= 10)) && tokens[i - 1] !== 'hundred') break;
      if (tokens[i] === 'hundred') continue;
      if (isNum(tokens[i]) && value >= 20 && !(tokens[i] in TENS) && UNITS[tokens[i]] < 10) continue;
      if (isNum(tokens[i]) && value < 10 && tokens[i] in UNITS && UNITS[tokens[i]] < 10) { break; }
    }
    if (used) { out.push(String(value)); i -= 1; }
  }
  return out;
}

// '|' marks the end of a sentence, so digit strings spoken in separate sentences ("3 8 5 2 0. 3 8 5 2 0.") never merge into one number.
const BREAK = '|';

function normalizeWithBreaks(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[.?!;](\s|$)/g, ` ${BREAK} `)
    .replace(/[-]/g, ' ')
    .replace(/[^a-z0-9' |]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLERS.has(w) && !DROP.has(w));
  const nums = numberWordsToDigits(words);
  return nums.filter((w, i) => !(w === 'and' && /^\d/.test(nums[i - 1] ?? '') && /^\d/.test(nums[i + 1] ?? '')));
}

const normalizeForWer = (text: string): string[] => normalizeWithBreaks(text).filter((t) => t !== BREAK);

// Spoken single digits ("4 8 2 1 3") become one token, like the recogniser's "48213".
function collapseDigits(toks: string[]): string[] {
  const out: string[] = [];
  for (const t of toks) {
    if (t === BREAK) { out.push(t); continue; }
    if (/^\d$/.test(t) && out.length && /^\d+$/.test(out[out.length - 1]) && out[out.length - 1].length < 9 && (out[out.length - 1].length === 1 || /^\d{2,}$/.test(out[out.length - 1]))) out[out.length - 1] += t;
    else out.push(t);
  }
  return out.filter((t) => t !== BREAK);
}

// Strict tokens: case, punctuation and filler words are ignored, nothing else. "$49" and "forty-nine dollars" stay different.
export function strictTokens(text: string): string[] {
  return text.toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/[^a-z0-9'.$ -]/g, ' ').replace(/[-]/g, ' ').replace(/(^|\s)[.$]+(?=\s|$)/g, ' ')
    .split(/\s+/).map((w) => w.replace(/^[.']+|[.']+$/g, '')).filter((w) => w && !FILLERS.has(w));
}

export interface WerResult {
  wer: number; // (substitutions + deletions + insertions) / reference words
  refWords: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}

// Word error rate by minimum edit distance with a backtrace, so the three error kinds add up to the distance exactly.
export function editDistance(r: string[], h: string[]): Omit<WerResult, 'wer'> & { distance: number } {
  const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= r.length; i += 1) {
    for (let j = 1; j <= h.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  }
  let i = r.length;
  let j = h.length;
  let sub = 0;
  let del = 0;
  let ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1)) { if (r[i - 1] !== h[j - 1]) sub += 1; i -= 1; j -= 1; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { del += 1; i -= 1; }
    else { ins += 1; j -= 1; }
  }
  return { refWords: r.length, substitutions: sub, deletions: del, insertions: ins, distance: d[r.length][h.length] };
}

// `strict` compares the words as written; the default also treats spoken and written numbers as equal ("forty-seven ninety-nine",
// "$47.99", "47 99"), because that is formatting, not a recognition error. Both are reported for demo calls so the second can
// never hide a real difference.
export function wordErrorRate(reference: string, hypothesis: string, opts: { strict?: boolean } = {}): WerResult {
  const r = opts.strict ? strictTokens(reference) : collapseDigits(normalizeWithBreaks(reference));
  const h = opts.strict ? strictTokens(hypothesis) : collapseDigits(normalizeWithBreaks(hypothesis));
  if (!r.length) return { wer: h.length ? 1 : 0, refWords: 0, substitutions: 0, deletions: 0, insertions: h.length };
  const e = editDistance(r, h);
  return { wer: e.distance / r.length, refWords: r.length, substitutions: e.substitutions, deletions: e.deletions, insertions: e.insertions };
}

// Every number in the text as a digit string; consecutive numbers ("twenty-two ninety-nine") stay separate tokens so a merged
// "2299" is a mismatch, not a match.
export function numberTokens(text: string): string[] {
  return collapseDigits(normalizeWithBreaks(text)).filter((t) => /^\d+$/.test(t));
}

// How many of the numbers in the script were heard exactly, and how many heard numbers are not in the script.
export function numberAccuracy(reference: string, hypothesis: string): { expected: number; matched: number; extra: number } {
  const ref = numberTokens(reference);
  const hyp = numberTokens(hypothesis);
  const pool = new Map<string, number>();
  hyp.forEach((n) => pool.set(n, (pool.get(n) ?? 0) + 1));
  let matched = 0;
  for (const n of ref) { const c = pool.get(n) ?? 0; if (c > 0) { matched += 1; pool.set(n, c - 1); } }
  return { expected: ref.length, matched, extra: hyp.length - matched };
}
