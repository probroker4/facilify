import type { FitResult, TextStyle } from '@/lib/contracts';

export type Measure = (text: string, size: number, letterSpacing: number) => number;

const graphemes = (s: string): string[] => {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  return Seg ? [...new Seg('en', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
};

export function abbreviationSteps(name: string): string[] {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 2) return [];
  const steps: string[] = [];
  const cur = [...parts];
  for (let i = parts.length - 2; i >= 1; i--) {
    const g = graphemes(cur[i]);
    if (g.length <= 2 && cur[i].endsWith('.')) continue;
    cur[i] = `${g[0].toLocaleUpperCase()}.`;
    steps.push(cur.join(' '));
  }
  return steps;
}

export function balancedLines(words: string[], n: number, width: (s: string) => number): string[] | null {
  if (n > words.length) return null;
  const W = words.length;
  const lineW = (i: number, j: number) => width(words.slice(i, j).join(' '));
  const memo = new Map<string, { cost: number; cuts: number[] }>();
  const best = (start: number, linesLeft: number): { cost: number; cuts: number[] } => {
    const key = `${start}:${linesLeft}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let res: { cost: number; cuts: number[] };
    if (linesLeft === 1) res = { cost: lineW(start, W), cuts: [] };
    else {
      res = { cost: Infinity, cuts: [] };
      for (let end = start + 1; end <= W - (linesLeft - 1); end++) {
        const rest = best(end, linesLeft - 1);
        const cost = Math.max(lineW(start, end), rest.cost);
        if (cost < res.cost) res = { cost, cuts: [end, ...rest.cuts] };
      }
    }
    memo.set(key, res);
    return res;
  };
  const { cuts } = best(0, n);
  const out: string[] = [];
  let s = 0;
  for (const c of [...cuts, W]) { out.push(words.slice(s, c).join(' ')); s = c; }
  return out;
}

function hardWrap(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    if (width(word) <= maxWidth) { line = word; continue; }
    let chunk = '';
    for (const g of graphemes(word)) {
      if (width(`${chunk}${g}-`) > maxWidth && chunk) { lines.push(`${chunk}-`); chunk = g; } else chunk += g;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

interface Box { width: number; height: number }

export function fitText(rawText: string, box: Box, style: TextStyle, measure: Measure, sizeCap?: number): FitResult {
  const text = (style.uppercase ? rawText.toLocaleUpperCase() : rawText).replace(/\s+/g, ' ').trim();
  const lh = Math.max(0.8, style.lineHeight || 1.2);
  const maxSize = Math.min(style.size, sizeCap ?? Infinity);
  const minSize = Math.min(style.minSize || style.size, maxSize);
  const lsMax = style.letterSpacing;
  const lsMin = Math.min(lsMax, style.fit.minLetterSpacing);
  const W = box.width * 0.995;
  const fitsLines = (lines: string[], size: number, ls: number) =>
    lines.length * size * lh <= box.height + 0.01 && lines.every((l) => measure(l, size, ls) <= W);
  const base = { abbreviated: false, overflow: false };
  if (!text) return { lines: [''], fontSize: maxSize, letterSpacing: lsMax, shrunk: maxSize < style.size, wrapped: false, ...base };

  const largestSize = (lines: string[], ls: number): number | null => {
    if (!fitsLines(lines, minSize, ls)) return null;
    if (fitsLines(lines, maxSize, ls)) return maxSize;
    let lo = minSize, hi = maxSize;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fitsLines(lines, mid, ls)) lo = mid; else hi = mid; }
    return Math.floor(lo * 100) / 100;
  };

  const attempt = (t: string): FitResult | null => {
    const single = [t];
    if (fitsLines(single, maxSize, lsMax)) return { lines: single, fontSize: maxSize, letterSpacing: lsMax, shrunk: maxSize < style.size, wrapped: false, ...base };
    if (lsMin < lsMax && fitsLines(single, maxSize, lsMin)) {
      let lo = lsMin, hi = lsMax;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fitsLines(single, maxSize, mid)) lo = mid; else hi = mid; }
      return { lines: single, fontSize: maxSize, letterSpacing: Math.floor(lo * 100) / 100, shrunk: maxSize < style.size, wrapped: false, ...base };
    }
    const s1 = largestSize(single, lsMin);
    const candidates: { lines: string[]; size: number }[] = [];
    if (s1 !== null) candidates.push({ lines: single, size: s1 });
    if (style.fit.mode !== 'shrink' && style.maxLines >= 2) {
      const words = t.split(' ');
      const refWidth = (s: string) => measure(s, 10, lsMin);
      for (let n = 2; n <= Math.min(style.maxLines, words.length); n++) {
        const lines = balancedLines(words, n, refWidth);
        if (!lines) continue;
        const s = largestSize(lines, lsMin);
        if (s !== null) candidates.push({ lines, size: s });
      }
    }
    if (!candidates.length) return null;
    const singleC = candidates.find((c) => c.lines.length === 1);
    let pick = candidates.reduce((a, b) => (b.size > a.size * 1.05 ? b : a));
    if (singleC && (style.fit.mode === 'shrink' || singleC.size >= 0.8 * maxSize || singleC.size >= pick.size * 0.95)) pick = singleC;
    if (style.fit.mode === 'wrap' && pick.lines.length === 1 && pick.size < maxSize) {
      const wrapped = candidates.filter((c) => c.lines.length > 1).sort((a, b) => b.size - a.size)[0];
      if (wrapped) pick = wrapped;
    }
    return { lines: pick.lines, fontSize: pick.size, letterSpacing: lsMin, shrunk: pick.size < style.size, wrapped: pick.lines.length > 1, ...base };
  };

  const direct = attempt(text);
  if (direct) return direct;
  if (style.fit.allowAbbreviate) {
    for (const step of abbreviationSteps(text)) {
      const r = attempt(step);
      if (r) return { ...r, abbreviated: true };
    }
  }
  const lines = hardWrap(text, W, (s) => measure(s, minSize, lsMin));
  const overflow = !fitsLines(lines, minSize, lsMin);
  return { lines, fontSize: minSize, letterSpacing: lsMin, shrunk: true, wrapped: lines.length > 1, abbreviated: false, overflow };
}
