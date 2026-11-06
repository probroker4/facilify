
const LATIN_ACCENTS = /[\u0300-\u036f]/g;
const JOINERS = /[\u200b-\u200d\u2060\ufeff]/g;
export function normKey(s: string): string {
  return (s ?? '').normalize('NFKD').replace(LATIN_ACCENTS, '').replace(JOINERS, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

export function normWords(s: string): string {
  return (s ?? '').normalize('NFKD').replace(LATIN_ACCENTS, '').replace(JOINERS, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function fillPlaceholders(text: string, values: Record<string, string>, escape?: (v: string) => string): string {
  const norm = new Map<string, string>();
  for (const [k, v] of Object.entries(values)) norm.set(normKey(k), v);
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, key: string) => {
    const v = key in values ? values[key] : norm.get(normKey(key)) ?? '';
    return escape ? escape(v) : v;
  });
}

export function listPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
