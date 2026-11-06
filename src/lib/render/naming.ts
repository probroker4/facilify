const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MAX_BASE_BYTES = 200;
const MAX_NAME_CHARS = 120;

const graphemes = (s: string): string[] => {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
};

function cut(s: string, maxChars: number, maxBytes = Infinity): string {
  let out = '';
  let bytes = 0;
  for (const g of graphemes(s)) {
    const b = Buffer.byteLength(g);
    if (out.length + g.length > maxChars || bytes + b > maxBytes) break;
    out += g;
    bytes += b;
  }
  return out;
}

export function safeSegment(s: string, maxLen = 40): string {
  const folded = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  const trimmed = cut(folded, maxLen).replace(/[-_]+$/g, '');
  return WINDOWS_RESERVED.test(trimmed) ? `${trimmed}_` : trimmed;
}

export function certFileName(parts: { event?: string; id?: string; name?: string; category?: string }): string {
  const segs = [
    safeSegment(parts.event ?? '', 30),
    safeSegment(parts.id ?? '', 24),
    safeSegment(parts.name ?? '', 40),
    safeSegment(parts.category ?? '', 20),
  ].filter(Boolean);
  let base = cut(segs.join('_') || 'certificate', MAX_NAME_CHARS - 4, MAX_BASE_BYTES).replace(/[-_]+$/g, '') || 'certificate';
  if (WINDOWS_RESERVED.test(base)) base = `${base}_`;
  return `${base}.pdf`;
}

export function uniqueFileNames(names: string[]): string[] {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    if (!seen.has(key)) { seen.add(key); return n; }
    const stem = n.replace(/\.pdf$/i, '');
    let i = counters.get(key) ?? 1;
    let candidate: string;
    do {
      i++;
      const suffix = `-${i}`;
      candidate = `${cut(stem, MAX_NAME_CHARS - 4 - suffix.length, MAX_BASE_BYTES - suffix.length).replace(/[-_]+$/g, '')}${suffix}.pdf`;
    } while (taken.has(candidate.toLowerCase()) || seen.has(candidate.toLowerCase()));
    counters.set(key, i);
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}
