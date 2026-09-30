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
      // a new number starts when the next word is a tens/teen word after a completed value ("forty-seven ninety-nine")
      if (isNum(tokens[i]) && (tokens[i] in TENS || (tokens[i] in UNITS && UNITS[tokens[i]] >= 10)) && value >= 10 && tokens[i - 1] !== 'hundred') break;
      if (tokens[i] === 'hundred') continue;
      if (isNum(tokens[i]) && value >= 20 && !(tokens[i] in TENS) && UNITS[tokens[i]] < 10) continue;
      if (isNum(tokens[i]) && value < 10 && tokens[i] in UNITS && UNITS[tokens[i]] < 10) { break; }
    }
    if (used) { out.push(String(value)); i -= 1; }
  }
  return out;
}

export function normalizeForWer(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[-]/g, ' ')
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLERS.has(w) && !DROP.has(w));
  const nums = numberWordsToDigits(words);
  return nums.filter((w, i) => !(w === 'and' && /^\d/.test(nums[i - 1] ?? '') && /^\d/.test(nums[i + 1] ?? '')));
}

export function wordErrorRate(reference: string, hypothesis: string): { wer: number; refWords: number } {
  const collapse = (toks: string[]) => {
    // spoken single digits ("4 8 2 1 3") become one token, like the STT's "48213"
    const out: string[] = [];
    for (const t of toks) {
      if (/^\d$/.test(t) && out.length && /^\d+$/.test(out[out.length - 1]) && out[out.length - 1].length < 9 && (out[out.length - 1].length === 1 || /^\d{2,}$/.test(out[out.length - 1]))) out[out.length - 1] += t;
      else out.push(t);
    }
    return out;
  };
  const r = collapse(normalizeForWer(reference));
  const h = collapse(normalizeForWer(hypothesis));
  if (!r.length) return { wer: 0, refWords: 0 };
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= h.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return { wer: prev[h.length] / r.length, refWords: r.length };
}
