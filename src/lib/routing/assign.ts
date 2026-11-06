import type { AwardCategory, AwardScheme, CertAssignment, Condition, Issue, StudentRecord } from '@/lib/contracts';
import { stableId } from '@/lib/hash';
import { normKey, normWords } from './norm';
import { canonicalAward, cellValue, cmpText, discoverCategories, splitAwards, type DiscoveredCategory } from './discover';

function num(v: string): number | null {
  const m = /-?\d+(?:[.,]\d+)*/.exec(String(v ?? '').replace(/\s+/g, ''));
  if (!m) return null;
  let s = m[0];
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) || /^-?\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function condNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') return num(v);
  return null;
}

function condRange(v: Condition['value']): [number, number] | null {
  let parts: unknown[] | null = null;
  if (Array.isArray(v)) parts = v;
  else if (typeof v === 'string') {
    const m = /^\s*(-?[\d.]+)\s*(?:-|–|\.\.|to|,|;|and)\s*(-?[\d.]+)\s*$/i.exec(v);
    if (m) parts = [m[1], m[2]];
  }
  if (!parts || parts.length !== 2) return null;
  const lo = condNumber(parts[0]);
  const hi = condNumber(parts[1]);
  if (lo === null || hi === null) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function condList(v: Condition['value']): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return String(v ?? '').split(/[,;|\n]/).map((x) => x.trim()).filter(Boolean);
}

function sameText(a: string, b: string): boolean {
  const na = normWords(a);
  const nb = normWords(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = /^-?\d+(\.\d+)?$/.test(a.trim()) ? Number(a.trim()) : NaN;
  const pb = /^-?\d+(\.\d+)?$/.test(b.trim()) ? Number(b.trim()) : NaN;
  if (Number.isFinite(pa) && Number.isFinite(pb)) return pa === pb;
  return canonicalAward(a) === canonicalAward(b);
}

export function testCondition(values: Record<string, string>, c: Condition): boolean {
  const raw = cellValue(values, c.column).trim();
  const parts = [raw, ...(splitAwards(raw).length > 1 ? splitAwards(raw) : [])];
  switch (c.op) {
    case 'isEmpty': return normWords(raw) === '';
    case 'equals': return parts.some((p) => sameText(p, String(c.value ?? '')));
    case 'contains': {
      const needle = normWords(Array.isArray(c.value) ? c.value.join(' ') : String(c.value ?? ''));
      return needle !== '' && normWords(raw).includes(needle);
    }
    case 'startsWith': {
      const prefix = normWords(String(c.value ?? ''));
      return prefix !== '' && parts.some((p) => normWords(p).startsWith(prefix));
    }
    case 'oneOf': {
      const list = condList(c.value);
      return list.length > 0 && parts.some((p) => list.some((x) => sameText(p, x)));
    }
    case 'gte': { const n = num(raw); const t = condNumber(c.value); return n !== null && t !== null && n >= t; }
    case 'lte': { const n = num(raw); const t = condNumber(c.value); return n !== null && t !== null && n <= t; }
    case 'between': {
      const n = num(raw);
      const r = condRange(c.value);
      return n !== null && r !== null && n >= r[0] && n <= r[1];
    }
    default: return false;
  }
}

function isAdvanced(cat: AwardCategory): boolean {
  return !!cat.match && !!(cat.match.all?.length || cat.match.any?.length);
}

function advancedMatch(values: Record<string, string>, cat: AwardCategory): boolean {
  const allOk = (cat.match?.all ?? []).every((c) => testCondition(values, c));
  const anyOk = !cat.match?.any?.length || cat.match.any.some((c) => testCondition(values, c));
  return allOk && anyOk;
}

function resolveValue(awardValue: string, cats: AwardCategory[]): AwardCategory[] {
  return makeResolver(cats)(awardValue);
}

function makeResolver(cats: AwardCategory[]): (awardValue: string) => AwardCategory[] {
  const simple = cats.filter((c) => !isAdvanced(c) && c.values?.length).map((c) => ({
    c, spellings: new Set(c.values!.map(normWords)), canon: c.values!.map(canonicalAward),
  }));
  const memo = new Map<string, AwardCategory[]>();
  return (awardValue: string) => {
    const hit = memo.get(awardValue);
    if (hit) return hit;
    let out: AwardCategory[] = [];
    const exact = normWords(awardValue);
    if (exact) {
      out = simple.filter((x) => x.spellings.has(exact)).map((x) => x.c);
      if (!out.length) {
        const key = canonicalAward(awardValue);
        let best: AwardCategory | undefined;
        let bestScore = 0;
        for (const x of simple) {
          const score = x.canon.filter((k) => k === key).length;
          if (score > bestScore) { best = x.c; bestScore = score; }
        }
        if (best) out = [best];
      }
    }
    memo.set(awardValue, out);
    return out;
  };
}

function awardTokens(values: Record<string, string>, awardColumns: string[]): { column: string; value: string }[] {
  const out: { column: string; value: string }[] = [];
  for (const column of awardColumns) for (const value of splitAwards(cellValue(values, column))) out.push({ column, value });
  return out;
}

function awardKeyed(cats: AwardCategory[]): boolean {
  return cats.some((c) => !isAdvanced(c) && !!c.values?.length);
}

function advancedCovers(values: Record<string, string>, cat: AwardCategory, token: { column: string; value: string }): boolean {
  const conds = [...(cat.match?.all ?? []), ...(cat.match?.any ?? [])];
  if (!conds.some((c) => normKey(c.column) === normKey(token.column))) return false;
  const only: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) only[k] = normKey(k) === normKey(token.column) ? token.value : v;
  if (!(token.column in values) && !Object.keys(values).some((k) => normKey(k) === normKey(token.column))) only[token.column] = token.value;
  return advancedMatch(only, cat);
}

export function matchesCategory(values: Record<string, string>, cat: AwardCategory, awardColumns: string[], siblings?: AwardCategory[]): boolean {
  if (isAdvanced(cat)) return advancedMatch(values, cat);
  if (!cat.values?.length) return false;
  const pool = siblings && siblings.includes(cat) ? siblings : [cat];
  return awardTokens(values, awardColumns).some((t) => resolveValue(t.value, pool).includes(cat));
}

export interface AssignResult {
  assignments: CertAssignment[];
  issues: Issue[];
  unmatchedValues: string[];
}

export const DEFAULT_CATEGORY_ID = 'default';

function sortedCategories(scheme: AwardScheme): AwardCategory[] {
  return scheme.categories.map((c, i) => ({ c, i })).sort((a, b) => a.c.priority - b.c.priority || a.i - b.i).map((x) => x.c);
}

function quoteList(vals: string[]): string {
  return vals.map((v) => `"${v}"`).join(', ');
}

export function assignCertificates(records: StudentRecord[], scheme: AwardScheme): AssignResult {
  const cats = sortedCategories(scheme);
  const assignments: CertAssignment[] = [];
  const issues: Issue[] = [];
  const unmatched = new Map<string, string>();
  const seen = new Map<string, number>();
  const firstCol = scheme.awardColumns[0];
  const resolve = makeResolver(cats);
  const keyed = awardKeyed(cats);
  const defaultCat: AwardCategory | null = scheme.defaultTemplateId
    ? { id: DEFAULT_CATEGORY_ID, label: 'Default', priority: Number.MAX_SAFE_INTEGER, templateId: scheme.defaultTemplateId }
    : null;

  for (const r of records) {
    const tokens = awardTokens(r.values, scheme.awardColumns);
    let matched = cats.filter((c) => (isAdvanced(c) ? advancedMatch(r.values, c) : tokens.some((t) => resolve(t.value).includes(c))));
    if (scheme.multiAward === 'first-match') matched = matched.slice(0, 1);

    let uncovered: { column: string; value: string }[] = [];
    if (!matched.length) uncovered = tokens;
    else if (scheme.multiAward === 'all-matches' && keyed) {
      uncovered = tokens.filter((t) => !resolve(t.value).length && !matched.some((c) => isAdvanced(c) && advancedCovers(r.values, c, t)));
    }
    const uncoveredVals = [...new Set(uncovered.map((t) => t.value))];
    for (const v of uncoveredVals) if (!unmatched.has(normWords(v))) unmatched.set(normWords(v), v);

    const event = normWords(r.values.EVENT ?? '');
    const give: { cat: AwardCategory; dupKey: string }[] = matched.map((cat) => ({ cat, dupKey: `${r.personKey}#${event}#${cat.id}` }));
    if (!matched.length || uncoveredVals.length) {
      if (defaultCat) {
        const what = [...new Set(uncoveredVals.map((v) => canonicalAward(v)))].sort(cmpText).join('|');
        give.push({ cat: defaultCat, dupKey: `${r.personKey}#${event}#${DEFAULT_CATEGORY_ID}#${what}` });
      } else if (!matched.length) {
        issues.push({ row: r.rowNumber, column: uncovered[0]?.column ?? firstCol, code: 'NO_TEMPLATE_MATCH', severity: 'error',
          message: uncoveredVals.length
            ? `No certificate template is chosen for ${quoteList(uncoveredVals)}. Pick a template for it or set a default template.`
            : 'This row has no award value, no category matches it and there is no default template.' });
        continue;
      } else {
        issues.push({ row: r.rowNumber, column: uncovered[0]?.column ?? firstCol, code: 'NO_TEMPLATE_MATCH', severity: 'warning',
          message: `No certificate template is chosen for ${quoteList(uncoveredVals)}, so no certificate is made for it. This row's other certificates are still made.` });
      }
    }

    for (const { cat, dupKey } of give) {
      const first = seen.get(dupKey);
      if (first !== undefined) {
        const byRule = isAdvanced(cat);
        issues.push({ row: r.rowNumber, column: firstCol, code: 'DUPLICATE_RECORD', severity: byRule ? 'warning' : 'error',
          message: byRule
            ? `This person already gets the "${cat.label}" certificate (row ${first}), so it is not made twice.`
            : `This person already gets the "${cat.label}" certificate (row ${first}).` });
        continue;
      }
      seen.set(dupKey, r.rowNumber);
      assignments.push({ certId: stableId('cert', r.recordId, cat.id), recordId: r.recordId, personKey: r.personKey, categoryId: cat.id, templateId: cat.templateId });
    }
  }
  return { assignments, issues, unmatchedValues: [...unmatched.values()].sort(cmpText) };
}

export function schemeFromDiscovery(
  id: string, name: string, awardColumns: string[], groups: DiscoveredCategory[], templateFor: (g: DiscoveredCategory) => string,
  opts: Partial<Pick<AwardScheme, 'multiAward' | 'delivery' | 'defaultTemplateId'>> = {},
): AwardScheme {
  return {
    id, name, awardColumns,
    categories: groups.map((g, i) => ({ id: stableId('cat', id, g.key), label: g.label, values: [...g.values], priority: i, templateId: templateFor(g) })),
    multiAward: opts.multiAward ?? 'all-matches',
    delivery: opts.delivery ?? 'one-email',
    defaultTemplateId: opts.defaultTemplateId,
  };
}

export function schemeCoverage(scheme: AwardScheme, rows: Record<string, string>[]): { covered: string[]; newValues: string[] } {
  const cats = sortedCategories(scheme);
  const resolve = makeResolver(cats);
  const keyed = awardKeyed(cats);
  const covered = new Map<string, string>();
  const fresh = new Map<string, string>();
  for (const row of rows) {
    for (const t of awardTokens(row, scheme.awardColumns)) {
      const hit = !keyed || resolve(t.value).length > 0 || cats.some((c) => isAdvanced(c) && advancedCovers(row, c, t));
      const k = normWords(t.value);
      if (hit) { if (!covered.has(k)) covered.set(k, t.value); } else if (!fresh.has(k)) fresh.set(k, t.value);
    }
  }
  const sort = (m: Map<string, string>) => [...m.values()].sort(cmpText);
  return { covered: sort(covered), newValues: sort(fresh) };
}

export function newCategoriesFor(
  scheme: AwardScheme, rows: Record<string, string>[], templateFor: (g: DiscoveredCategory) => string,
): AwardCategory[] {
  const { newValues } = schemeCoverage(scheme, rows);
  if (!newValues.length) return [];
  const isNew = new Set(newValues.map(normWords));
  let priority = scheme.categories.reduce((m, c) => Math.max(m, c.priority), 0);
  return discoverCategories(rows, scheme.awardColumns)
    .filter((g) => g.values.every((v) => isNew.has(normWords(v))))
    .map((g) => ({ id: stableId('cat', scheme.id, g.key), label: g.label, values: [...g.values], priority: ++priority, templateId: templateFor(g) }));
}

export function categoryById(scheme: AwardScheme, id: string): AwardCategory | undefined {
  return scheme.categories.find((c) => c.id === id);
}

export function resolveCategory(scheme: AwardScheme, categoryId: string): AwardCategory | undefined {
  if (categoryId === DEFAULT_CATEGORY_ID && scheme.defaultTemplateId) {
    return categoryById(scheme, categoryId) ?? { id: DEFAULT_CATEGORY_ID, label: 'Default', priority: Number.MAX_SAFE_INTEGER, templateId: scheme.defaultTemplateId };
  }
  return categoryById(scheme, categoryId);
}

export interface DeliveryGroup<T> {
  key: string;
  personKey: string;
  items: T[];
}

export function groupForDelivery<T extends Pick<CertAssignment, 'certId' | 'personKey'>>(
  assignments: T[], delivery: AwardScheme['delivery'],
): DeliveryGroup<T>[] {
  const groups = new Map<string, DeliveryGroup<T>>();
  for (const a of assignments) {
    const key = delivery === 'one-email' ? a.personKey : a.certId;
    const g = groups.get(key) ?? { key, personKey: a.personKey, items: [] };
    if (g.personKey !== a.personKey) throw new Error(`Certificate ${a.certId} would be grouped with another person's certificates.`);
    if (!g.items.some((x) => x.certId === a.certId)) g.items.push(a);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export interface CertificateSettings {
  categoryId: string;
  label: string;
  templateId: string;
  emailTemplateId?: string;
  driveSubfolder?: string;
  linkedInTitle?: string;
}

export function certificateSettings(scheme: AwardScheme, categoryId: string): CertificateSettings | undefined {
  const c = resolveCategory(scheme, categoryId);
  if (!c) return undefined;
  const isDefault = categoryId === DEFAULT_CATEGORY_ID && !categoryById(scheme, categoryId);
  return {
    categoryId: c.id, label: c.label, templateId: c.templateId,
    emailTemplateId: isDefault ? undefined : c.emailTemplateId,
    driveSubfolder: isDefault ? undefined : c.driveSubfolder,
    linkedInTitle: isDefault ? undefined : c.linkedInTitle,
  };
}

export function emailTemplateIdForGroup(scheme: AwardScheme, categoryIds: string[]): string | undefined {
  const best = categoryIds
    .map((id) => categoryById(scheme, id))
    .filter((c): c is AwardCategory => !!c?.emailTemplateId)
    .sort((a, b) => a.priority - b.priority)[0];
  return best?.emailTemplateId;
}
