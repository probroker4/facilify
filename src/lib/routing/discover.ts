import { normKey, normWords } from './norm';

const canonCache = new Map<string, string>();
export function canonicalAward(value: string): string {
  const key = value ?? '';
  const hit = canonCache.get(key);
  if (hit !== undefined) return hit;
  const out = computeCanonicalAward(key);
  if (canonCache.size > 50_000) canonCache.clear();
  canonCache.set(key, out);
  return out;
}

function computeCanonicalAward(value: string): string {
  let s = normWords(value);
  if (!s) return '';
  s = s.replace(/\b[a-z](?: [a-z]\b)+/g, (m) => m.replace(/ /g, ''));
  s = s.replace(/\b(hon|honourable|honorable|hons|honours|honors|honour|honor)\b/g, 'honorable');
  if (s === 'hm') s = 'honorable mention';
  s = s.replace(/\bfirst\b/g, '1st').replace(/\bsecond\b/g, '2nd').replace(/\bthird\b/g, '3rd')
    .replace(/\bfourth\b/g, '4th').replace(/\bfifth\b/g, '5th');
  s = s.replace(/\b(\d+) (st|nd|rd|th)\b/g, '$1$2');
  s = s.replace(/\brunners? up\b/g, 'runnerup');
  s = s.replace(/\b1st runnerup\b/g, '2nd').replace(/\b2nd runnerup\b/g, '3rd').replace(/\b3rd runnerup\b/g, '4th');
  s = s.replace(/\b(participant|participants|participated)\b/g, 'participation');
  s = s.replace(/\b(mention|winner|finalist|volunteer|mentor|runnerup)s\b/g, '$1');
  s = s.replace(/\b(prize|place|position|pos|rank|award|awards|certificate|cert|of|the|in|for)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (s === 'runnerup') s = '2nd';
  if (s === 'winner' || s === 'overall winner' || s === 'grand winner' || s === 'champion') s = '1st';
  if (/^\d+$/.test(s)) s = ordinal(Number(s));
  s = s.replace(/^(\d+)(st|nd|rd|th)$/, (_m, n: string) => ordinal(Number(n)));
  if (!s) s = normWords(value);
  return s;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function splitAwards(cell: string): string[] {
  return String(cell ?? '').split(/[;|\r\n]+/).map((v) => v.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

const nkCache = new Map<string, string>();
function normKeyCached(s: string): string {
  let v = nkCache.get(s);
  if (v === undefined) {
    v = normKey(s);
    if (nkCache.size > 10_000) nkCache.clear();
    nkCache.set(s, v);
  }
  return v;
}

export const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function cellValue(row: Record<string, string>, column: string): string {
  if (Object.hasOwn(row, column)) return row[column] ?? '';
  const target = normKeyCached(column);
  if (!target) return '';
  for (const k in row) if (Object.hasOwn(row, k) && normKeyCached(k) === target) return row[k] ?? '';
  return '';
}

export interface DiscoveredCategory {
  key: string;
  label: string;
  values: string[];
  count: number;
  valueCounts?: Record<string, number>;
}

export function discoverCategories(rows: Record<string, string>[], awardColumns: string[]): DiscoveredCategory[] {

  const groups = new Map<string, { spellings: Map<string, { display: string; rows: number }>; count: number }>();
  for (const row of rows) {
    const keysInRow = new Set<string>();
    const spellingsInRow = new Set<string>();
    for (const col of awardColumns) {
      for (const raw of splitAwards(cellValue(row, col))) {
        const key = canonicalAward(raw);
        if (!key) continue;
        const g = groups.get(key) ?? { spellings: new Map(), count: 0 };
        groups.set(key, g);
        const sk = normWords(raw);
        const sp = g.spellings.get(sk) ?? { display: raw, rows: 0 };
        g.spellings.set(sk, sp);
        if (!spellingsInRow.has(sk)) { sp.rows++; spellingsInRow.add(sk); }
        if (!keysInRow.has(key)) { g.count++; keysInRow.add(key); }
      }
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const spellings = [...g.spellings.values()].sort((a, b) => b.rows - a.rows || cmpText(a.display, b.display));
      return {
        key, label: spellings[0].display, values: spellings.map((s) => s.display), count: g.count,
        valueCounts: Object.fromEntries(spellings.map((s) => [s.display, s.rows])),
      };
    })
    .sort(byRank);
}

export const discoverAwards = discoverCategories;

function byRank(a: DiscoveredCategory, b: DiscoveredCategory): number {
  return rankOf(a.key) - rankOf(b.key) || b.count - a.count || cmpText(a.label, b.label);
}

function rankOf(key: string): number {
  const m = /^(\d+)(st|nd|rd|th)$/.exec(key);
  if (m) return Number(m[1]);
  if (key.includes('honorable')) return 50;
  if (key.includes('particip')) return 1000;
  return 100;
}

export function splitValue(cats: DiscoveredCategory[], value: string): DiscoveredCategory[] {
  const want = normWords(value);
  const src = cats.find((c) => c.values.some((v) => normWords(v) === want));
  if (!src || src.values.length < 2) return cats;
  const spelling = src.values.find((v) => normWords(v) === want)!;
  const moved = src.valueCounts?.[spelling] ?? 0;
  const out = cats.map((c) => {
    if (c !== src) return c;
    const values = c.values.filter((v) => v !== spelling);
    const valueCounts = c.valueCounts ? Object.fromEntries(Object.entries(c.valueCounts).filter(([k]) => k !== spelling)) : undefined;
    return { ...c, values, label: values.includes(c.label) ? c.label : values[0], count: Math.max(0, c.count - moved), valueCounts };
  });
  let key = `split:${want}`;
  for (let i = 2; out.some((c) => c.key === key); i++) key = `split:${want}#${i}`;
  return [...out, { key, label: spelling, values: [spelling], count: moved, valueCounts: { [spelling]: moved } }];
}

export function mergeCategories(cats: DiscoveredCategory[], aKey: string, bKey: string): DiscoveredCategory[] {
  if (aKey === bKey) return cats;
  const a = cats.find((c) => c.key === aKey);
  const b = cats.find((c) => c.key === bKey);
  if (!a || !b) return cats;
  const values = [...a.values, ...b.values.filter((v) => !a.values.some((x) => normWords(x) === normWords(v)))];
  const valueCounts = a.valueCounts || b.valueCounts ? { ...(b.valueCounts ?? {}), ...(a.valueCounts ?? {}) } : undefined;
  return cats.filter((c) => c.key !== bKey).map((c) => (c.key === aKey ? { ...c, values, count: c.count + b.count, valueCounts } : c));
}
