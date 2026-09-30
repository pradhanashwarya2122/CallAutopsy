const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE = /(\+?\d[\d\s\-().]{7,}\d)/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

export function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(CARD, '[REDACTED_CARD]')
    .replace(SSN, '[REDACTED_SSN]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 10 ? '[REDACTED_PHONE]' : m));
}
