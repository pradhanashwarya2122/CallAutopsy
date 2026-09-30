const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Digits with single separators. A sentence break or comma between the groups means two separate numbers ("20759. 20759"), which
// is not a phone number, so those matches are skipped in the replacer.
const PHONE = /(\+?\(?\d[\d\s\-().]{7,}\d)/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
// A long run of spoken digits ("four one five five five five zero one three two"): speech-to-text sometimes leaves these as words.
// Commas and hyphens may join the words; a full stop ends the run, so two spelled-out order numbers are not one long number.
const DIGIT_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)';
const SPOKEN_RUN = new RegExp(`\\b${DIGIT_WORD}(?:[\\s,-]+${DIGIT_WORD}){9,}\\b`, 'gi');

const digitsOnly = (s: string) => s.replace(/\D/g, '');

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

// A card number is 13-19 digits that pass the Luhn check, or that are written in the usual groups of four. Other long digit runs
// (two order numbers next to each other) are left alone.
const isCard = (m: string) => {
  const d = digitsOnly(m);
  if (d.length < 13 || d.length > 19) return false;
  return luhn(d) || /^\d{4}([ -]\d{4}){3}(\d{0,3})$/.test(m.trim());
};

// Phone numbers are written in groups of at most four digits ("415 555 0132", "+44 20 7946 0958"). Several longer groups next to
// each other are separate numbers (an order number, an amount, a reference), not a phone number.
// A country code ("+91 98765 43210") or bracketed area code ("(415) 5550132") marks a phone number whatever the group sizes.
const isPhone = (m: string) => {
  if (digitsOnly(m).length < 10 || /[.,;]\s/.test(m)) return false;
  const groups = m.split(/\D+/).filter(Boolean);
  return groups.length === 1 || groups.every((g) => g.length <= 4) || /^[+(]/.test(m.trim()) || (groups.length === 2 && groups[0].length <= 4);
};

export function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(CARD, (m) => (isCard(m) ? '[REDACTED_CARD]' : m))
    .replace(SSN, '[REDACTED_SSN]')
    .replace(SPOKEN_RUN, '[REDACTED_NUMBER]')
    .replace(PHONE, (m) => (isPhone(m) ? '[REDACTED_PHONE]' : m));
}

// Redacts every string inside an object or array (keys are left alone). Used on anything that is stored or returned and could
// carry transcript text: analysis output, stage metadata, error messages.
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactPII(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
