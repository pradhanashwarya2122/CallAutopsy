import zlib from 'node:zlib';

// Text of a pdfkit document (standard fonts): inflate every stream and decode the hex / literal strings the text operators use.
export function pdfText(pdf: Buffer): string {
  const out: string[] = [];
  const raw = pdf.toString('latin1');
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    let body = Buffer.from(raw.slice(start, end), 'latin1');
    try { body = zlib.inflateSync(body); } catch { /* not compressed */ }
    const s = body.toString('latin1');
    for (const h of s.matchAll(/<([0-9a-fA-F\s]+)>/g)) out.push(Buffer.from(h[1].replace(/\s/g, ''), 'hex').toString('latin1'));
    for (const l of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(l[1]);
  }
  return out.join(' ');
}
