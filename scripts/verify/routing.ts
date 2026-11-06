import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as XLSX from 'xlsx';

process.removeAllListeners('warning');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-routing-'));
process.env.CERTFLOW_DATA_DIR = tmp;

const FIX = path.join(process.cwd(), 'fixtures', 'routing');
fs.mkdirSync(FIX, { recursive: true });

type Ing = typeof import('../../src/lib/ingest');
type Rt = typeof import('../../src/lib/routing');
type AwardScheme = import('../../src/lib/contracts').AwardScheme;
type AwardCategory = import('../../src/lib/contracts').AwardCategory;
type Condition = import('../../src/lib/contracts').Condition;
type StudentRecord = import('../../src/lib/contracts').StudentRecord;
interface Mods { ing: Ing; rt: Rt; db: typeof import('../../src/lib/db') }

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    failures++;
    console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}
const sorted = <T,>(a: T[]): T[] => [...a].sort();

function csvField(v: string): string { return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}
function saveText(name: string, text: string): Uint8Array {
  fs.writeFileSync(path.join(FIX, name), text, 'utf8');
  return new Uint8Array(fs.readFileSync(path.join(FIX, name)));
}
function saveXlsx(name: string, aoa: (string | number)[][]): Uint8Array {
  const ws: XLSX.WorkSheet = {};
  aoa.forEach((line, r) => line.forEach((v, c) => {
    if (v === '') return;
    ws[XLSX.utils.encode_cell({ r, c })] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v };
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: Math.max(...aoa.map((l) => l.length)) - 1 } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Awards');
  fs.writeFileSync(path.join(FIX, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  return new Uint8Array(fs.readFileSync(path.join(FIX, name)));
}

const HEAD = ['Name', 'Student ID', 'Email', 'Event', 'Award', 'Rank', 'Score', 'Track', 'Date'];
type GroupKey = '1st' | '2nd' | '3rd' | 'hm' | 'special' | 'ui' | 'pitch' | 'innov' | 'jury' | 'mentor' | 'vol' | 'part';
interface Row { id: string; name: string; award: string; rank: string; score: string; track: string; group: GroupKey }
const EVENT = 'HackFest 2026';
const R = (id: string, name: string, award: string, rank: string, score: string, track: string, group: GroupKey): Row => ({ id, name, award, rank, score, track, group });
const ROWS: Row[] = [
  R('S001', 'Aarav Sharma', '1st Prize', '1', '96', 'AI', '1st'),
  R('S001', 'Aarav Sharma', 'Best UI', '', '96', 'AI', 'ui'),
  R('S001', 'Aarav Sharma', 'Participation', '', '', 'AI', 'part'),
  R('S002', 'Diya Patel', 'Second Prize', '2', '91', 'Web', '2nd'),
  R('S002', 'Diya Patel', 'Special Mention', '', '91', 'Web', 'special'),
  R('S003', 'Rohan Mehta', '3rd', '3', '84', 'AI', '3rd'),
  R('S003', 'Rohan Mehta', 'Honourable Mention', '', '84', 'AI', 'hm'),
  R('S004', 'Ananya Iyer', 'Best UI', '', '88', 'Web', 'ui'),
  R('S005', 'Kabir Singh', 'First Place', '1', '92', 'Web', '1st'),
  R('S006', 'Meera Nair', 'Runner Up', '2', '89.5', 'AI', '2nd'),
  R('S007', 'Vihaan Gupta', '3rd Prize', '3', '79', 'Mobile', '3rd'),
  R('S008', 'Ishita Reddy', 'Best Pitch', '', '77', 'Mobile', 'pitch'),
  R('S009', 'Arjun Krishnan', 'Hon. Mention', '', '70', 'Web', 'hm'),
  R('S010', 'Saanvi Joshi', 'Honorable Mention', '', '72', 'AI', 'hm'),
  R('S011', 'Elena Petrova', 'Special Mention', '', '68', 'ML Vision', 'special'),
  R('S012', 'José Núñez', 'Best Innovation', '', '90', 'ML Vision', 'innov'),
  R('S013', 'अनन्या शर्मा', 'Special Jury', '', '86', 'Web', 'jury'),
  R('S014', 'Zoë O’Brien', 'Mentor', '', '', 'Mentoring', 'mentor'),
  R('S015', 'Ünal Şahin', 'Volunteer', '', '', 'Ops', 'vol'),
  R('S016', 'Lakshmi Narayanan', 'Winner', '1', '99', 'Mobile', '1st'),
  R('S017', 'Dev Malhotra', 'HM', '', '65', 'Web', 'hm'),
  R('S018', 'Riya Fernandes', 'participation', '', '', 'Web', 'part'),
  R('S019', 'Aryan Bhatt', 'Certificate of Participation', '', '', 'AI', 'part'),
  R('S020', 'Yash Agarwal', 'PARTICIPATION', '', '', 'Web', 'part'),
  R('S021', 'Harsh Chauhan', 'Participation', '', '', 'Web', 'part'),
  R('S022', 'Tanvi Kulkarni', '1st', '1', '94', 'AI', '1st'),
  R('S023', 'Nisha Bansal', 'Best Pitch', '', '81', 'Web', 'pitch'),
  R('S024', 'Rahul Desai', '2nd', '2', '87', 'Mobile', '2nd'),
];
const GROUPS: GroupKey[] = ['1st', '2nd', '3rd', 'hm', 'special', 'ui', 'pitch', 'innov', 'jury', 'mentor', 'vol', 'part'];
const emailOf = (r: Row) => `${r.id.toLowerCase()}@example.edu`;
const rowCells = (r: Row) => [r.name, r.id, emailOf(r), EVENT, r.award, r.rank, r.score, r.track, '2026-03-14'];
const tplOf = (g: GroupKey) => `T-${g}`;
const SPELLING_GROUP = new Map(ROWS.map((r) => [r.award.toLowerCase(), r.group]));
const groupOfSpelling = (v: string): GroupKey => {
  const g = SPELLING_GROUP.get(v.toLowerCase().trim());
  if (!g) throw new Error(`oracle bug: spelling "${v}" is not in the hand table`);
  return g;
};

const MAP = [
  { placeholder: 'NAME', column: 'Name' }, { placeholder: 'ID', column: 'Student ID' }, { placeholder: 'EVENT', column: 'Event' },
  { placeholder: 'CERTIFICATE_TYPE', column: 'Award' }, { placeholder: 'DATE', column: 'Date' },
];
const VALIDATE = { batchId: 'b-routing', mapping: MAP, email: { primary: 'Email' }, required: ['EVENT'], awardColumns: ['Award'] };

function awardsCsv(extra: Row[] = []): string { return toCsv(HEAD, [...ROWS, ...extra].map(rowCells)); }
function recordsOf(m: Mods, bytes: Uint8Array, name: string, awardColumns = ['Award']) {
  const sheet = m.ing.parseSheet(bytes, name);
  const v = m.ing.validateSheet(sheet, { ...VALIDATE, awardColumns });
  return { sheet, validation: v, records: v.valid };
}
const byRow = (records: StudentRecord[]) => new Map(records.map((r) => [r.rowNumber, r]));

function schemeFor(m: Mods, rows: Record<string, string>[], opts: Partial<AwardScheme> = {}): AwardScheme {
  const groups = m.rt.discoverCategories(rows, ['Award']);
  return { ...m.rt.schemeFromDiscovery('scheme-awards', 'HackFest awards', ['Award'], groups, (g) => tplOf(groupOfSpelling(g.values[0])), { multiAward: 'first-match' }), ...opts };
}

async function caseDiscover(m: Mods): Promise<string> {
  const bytes = saveText('awards.csv', awardsCsv());
  const { sheet } = recordsOf(m, bytes, 'awards.csv');
  eq(sheet.rows.length, ROWS.length, 'fixture row count');

  const expectedCount = new Map<GroupKey, number>();
  for (const r of ROWS) expectedCount.set(r.group, (expectedCount.get(r.group) ?? 0) + 1);
  check(GROUPS.length >= 10, 'the awards fixture must have 10+ categories');

  const cats = m.rt.discoverCategories(sheet.rows, ['Award']);
  eq(cats.length, GROUPS.length, `number of categories (${cats.map((c) => c.key).join(', ')})`);
  const seenGroups = new Set<GroupKey>();
  for (const c of cats) {
    const gs = new Set(c.values.map(groupOfSpelling));
    check(gs.size === 1, `category "${c.label}" mixes groups ${[...gs].join(' + ')} (values: ${c.values.join(' | ')})`);
    const g = [...gs][0];
    check(!seenGroups.has(g), `group ${g} is split over several categories`);
    seenGroups.add(g);
    eq(c.count, expectedCount.get(g), `row count of "${c.label}"`);
    check(c.values.includes(c.label), `label "${c.label}" is one of its spellings`);
    eq(c.valueCounts ? Object.values(c.valueCounts).reduce((a, b) => a + b, 0) : -1, c.count, `valueCounts of "${c.label}" add up to its count`);
  }
  eq(seenGroups.size, GROUPS.length, 'all groups discovered');
  eq(cats.reduce((a, c) => a + c.count, 0), ROWS.length, 'category counts add up to the row total');
  const rawDistinct = new Set(ROWS.map((r) => r.award.toLowerCase().trim()));
  const listed = new Set(cats.flatMap((c) => c.values.map((v) => v.toLowerCase().trim())));
  eq(sorted([...listed]), sorted([...rawDistinct]), 'every distinct award value appears exactly once');

  const catOf = (spelling: string) => cats.find((c) => c.values.some((v) => v.toLowerCase() === spelling.toLowerCase()))!;
  eq(catOf('1st Prize'), catOf('First Place'), '"1st Prize" and "First Place" are one category');
  eq(catOf('1st'), catOf('Winner'), '"1st" and "Winner" are one category');
  eq(catOf('Runner Up'), catOf('Second Prize'), '"Runner Up" and "Second Prize" are one category');
  eq(catOf('Hon. Mention'), catOf('Honorable Mention'), '"Hon. Mention" and "Honorable Mention" are one category');
  eq(catOf('HM'), catOf('Honourable Mention'), '"HM" and "Honourable Mention" are one category');
  eq(catOf('PARTICIPATION'), catOf('Certificate of Participation'), 'participation spellings are one category');
  eq(catOf('participation').count, 5, 'participation rows');
  const distinct = (a: string, b: string) => check(catOf(a).key !== catOf(b).key, `"${a}" must not be grouped with "${b}"`);
  distinct('Best UI', 'Best Pitch');
  distinct('Special Mention', 'Honourable Mention');
  distinct('Special Mention', 'Special Jury');
  distinct('Best Innovation', 'Best UI');
  distinct('Mentor', 'Volunteer');
  distinct('1st Prize', '2nd');
  distinct('2nd', '3rd');
  distinct('Participation', 'Honorable Mention');

  const withMentor = m.ing.parseSheet(saveText('awards-best-mentor.csv', awardsCsv([R('S090', 'Maya Rao', 'Best Mentor', '', '', 'Mentoring', 'mentor')])), 'awards-best-mentor.csv');
  const cats2 = m.rt.discoverCategories(withMentor.rows, ['Award']);
  eq(cats2.length, GROUPS.length + 1, 'adding "Best Mentor" adds exactly one category');
  const bm = cats2.find((c) => c.values.some((v) => v === 'Best Mentor'));
  check(!!bm && bm.count === 1 && bm.values.length === 1, `"Best Mentor" category: ${JSON.stringify(bm)}`);
  const mentor = cats2.find((c) => c.values.includes('Mentor'));
  check(!!mentor && mentor.count === 1 && !mentor.values.includes('Best Mentor'), '"Mentor" stays separate from "Best Mentor"');
  eq(cats.map((c) => c.key), cats2.filter((c) => c !== bm).map((c) => c.key), 'the other categories are unchanged by the new value');
  const noUi = m.rt.discoverCategories(sheet.rows.filter((r) => r.Award !== 'Best UI'), ['Award']);
  check(!noUi.some((c) => c.values.includes('Best UI')), 'category disappears with its rows');

  const shuffled = [...sheet.rows].reverse();
  eq(m.rt.discoverCategories(shuffled, ['Award']).map((c) => [c.key, c.count]), cats.map((c) => [c.key, c.count]), 'same categories in the same order for reversed rows');
  eq(m.rt.discoverCategories(sheet.rows, ['  AWARD']).map((c) => c.count), cats.map((c) => c.count), 'award column found by heading, ignoring case/space');
  eq(cats.slice(0, 3).map((c) => c.key), ['1st', '2nd', '3rd'], 'podium places come first');
  eq(cats[cats.length - 1].values.map(groupOfSpelling)[0], 'part', 'participation comes last');

  const hindi = m.rt.discoverCategories([{ Award: 'पहला पुरस्कार' }, { Award: 'पहली पुरस्कार' }, { Award: 'पहला  पुरस्कार' }, { Award: 'सहभागिता' }], ['Award']);
  eq(hindi.map((c) => c.count).sort(), [1, 1, 2], 'Devanagari awards: spelling variants of spacing merge, vowel-sign variants stay apart');
  const same = (a: string, b: string) => m.rt.canonicalAward(a) === m.rt.canonicalAward(b);
  check(same('Honourable Mentions', 'Honorable Mention') && same('Winners', '1st') && same('Mentors', 'Mentor') && same('H.M.', 'Hon. Mention'), 'plurals and abbreviations fold');
  check(!same('Honorary Mention', 'Honorable Mention') && !same('Mentors', 'Best Mentor') && !same('Best UX', 'Best UI') && !same('Runner Up', '3rd'), 'near-miss names stay apart');
  const blanks = m.rt.discoverCategories([{ Award: '' }, { Award: '   ' }, { Award: ' Best UI ' }, { Award: 'best  ui' }], ['Award']);
  eq(blanks.map((c) => [c.label.toLowerCase().replace(/\s+/g, ' ').trim(), c.count]), [['best ui', 2]], 'blank cells are ignored, spelling variants of case/space merge');
  const two = m.rt.discoverCategories([{ A: 'Best UI', B: 'Mentor' }, { A: 'Best UI', B: '' }, { A: '', B: 'Volunteer' }], ['A', 'B']);
  eq(two.map((c) => c.count).sort(), [1, 1, 2], 'two award columns');

  const first = cats.find((c) => c.key === '1st')!;
  eq(first.values.length, 4, '1st has four spellings');
  const split = m.rt.splitValue(cats, 'Winner');
  const winner = split.find((c) => c.values.length === 1 && c.values[0] === 'Winner')!;
  check(!!winner && winner.count === 1, 'splitting "Winner" creates its own category with its row');
  eq(split.find((c) => c.key === '1st')!.count, first.count - 1, 'the rest of 1st loses that row');
  check(!split.find((c) => c.key === '1st')!.values.includes('Winner'), '1st no longer lists Winner');
  eq(split.reduce((a, c) => a + c.count, 0), ROWS.length, 'splitting keeps the total');
  eq(m.rt.splitValue(cats, 'Mentor'), cats, 'a spelling that is alone cannot be split');
  eq(m.rt.splitValue(cats, 'No Such Award'), cats, 'unknown spelling: no change');
  const merged = m.rt.mergeCategories(cats, 'best pitch', 'best ui');
  const mp = merged.find((c) => c.key === 'best pitch')!;
  eq(mp.count, 4, 'merged count');
  check(mp.values.includes('Best UI') && !merged.some((c) => c.key === 'best ui'), 'merge moves the spellings');
  eq(merged.length, cats.length - 1, 'merge removes one category');
  eq(m.rt.mergeCategories(cats, '1st', '1st'), cats, 'merging a category with itself does nothing');
  return 'ROUTING DISCOVER OK';
}

async function caseAssign(m: Mods): Promise<string> {
  const { sheet, validation, records } = recordsOf(m, saveText('awards.csv', awardsCsv()), 'awards.csv');
  eq(validation.issues, [], 'awards fixture validates clean');
  eq(records.length, ROWS.length, 'all rows are valid records');
  const cats = m.rt.discoverCategories(sheet.rows, ['Award']);
  const scheme = schemeFor(m, sheet.rows);
  eq(scheme.categories.length, GROUPS.length, 'one category per discovered group');
  eq(new Set(scheme.categories.map((c) => c.id)).size, GROUPS.length, 'category ids are unique');

  for (const mode of ['first-match', 'all-matches'] as const) {
    const res = m.rt.assignCertificates(records, { ...scheme, multiAward: mode });
    eq(res.issues, [], `${mode}: no issues`);
    eq(res.unmatchedValues, [], `${mode}: nothing unmatched`);
    eq(res.assignments.length, ROWS.length, `${mode}: one certificate per row`);
    const rec = byRow(records);
    ROWS.forEach((row, i) => {
      const r = rec.get(i + 2)!;
      const a = res.assignments.filter((x) => x.recordId === r.recordId);
      eq(a.map((x) => x.templateId), [tplOf(row.group)], `${mode}: row ${i + 2} "${row.award}" template`);
      eq(a.map((x) => x.personKey), [r.personKey], `${mode}: row ${i + 2} person`);
    });
    eq(new Set(res.assignments.map((a) => a.certId)).size, ROWS.length, `${mode}: certificate ids are unique`);
    const aarav = res.assignments.filter((a) => a.personKey === rec.get(2)!.personKey);
    eq(sorted(aarav.map((a) => a.templateId)), sorted([tplOf('1st'), tplOf('ui'), tplOf('part')]), `${mode}: Aarav's three awards`);
    eq(m.rt.assignCertificates(records, { ...scheme, multiAward: mode }).assignments, res.assignments, `${mode}: deterministic`);
  }

  const changed: AwardScheme = { ...scheme, categories: scheme.categories.map((c) => (c.templateId === tplOf('ui') ? { ...c, templateId: 'T-other' } : c)) };
  const res2 = m.rt.assignCertificates(records, changed);
  const diff = ROWS.map((row, i) => [i + 2, res2.assignments.find((a) => a.recordId === byRow(records).get(i + 2)!.recordId)!.templateId] as const)
    .filter(([i, t]) => t !== tplOf(ROWS[i - 2].group)).map(([i]) => i);
  eq(diff, [3, 9], 'only the "Best UI" rows moved to the new template');

  const split = m.rt.splitValue(cats, 'Winner');
  const splitScheme = m.rt.schemeFromDiscovery('s2', 'split', ['Award'], split, (g) => (g.values[0] === 'Winner' ? 'T-winner' : tplOf(groupOfSpelling(g.values[0]))), { multiAward: 'first-match' });
  const res3 = m.rt.assignCertificates(records, splitScheme);
  const rec = byRow(records);
  const t3 = (row: number) => res3.assignments.find((a) => a.recordId === rec.get(row)!.recordId)!.templateId;
  eq(t3(21), 'T-winner', 'split spelling "Winner" -> its own template');
  eq([t3(2), t3(10), t3(27)], [tplOf('1st'), tplOf('1st'), tplOf('1st')], 'the rest of 1st keep the 1st template');
  eq(res3.issues, [], 'split scheme: no issues');

  const extra = recordsOf(m, saveText('awards-spelling.csv', toCsv(HEAD, [rowCells(R('S100', 'Late Entry', 'Rank 1', '', '', '', '1st')), rowCells(R('S101', 'Another', 'honourable mention', '', '', '', 'hm')), rowCells(R('S102', 'Third', 'Third Place', '', '', '', '3rd'))])), 'awards-spelling.csv');
  const res4 = m.rt.assignCertificates(extra.records, scheme);
  eq(res4.assignments.map((a) => a.templateId), [tplOf('1st'), tplOf('hm'), tplOf('3rd')], 'unseen spellings of known awards follow their award');
  eq(res4.issues, [], 'unseen spellings: no issue');

  const novel = recordsOf(m, saveText('awards-novel.csv', toCsv(HEAD, [rowCells(R('S103', 'Newbie', 'Best Mentor', '', '', '', 'mentor'))])), 'awards-novel.csv');
  const res5 = m.rt.assignCertificates(novel.records, scheme);
  eq(res5.assignments, [], 'a new award with no category gets no certificate');
  eq(res5.issues.map((i) => [i.code, i.severity, i.row]), [['NO_TEMPLATE_MATCH', 'error', 2]], 'a new award is flagged');
  check(res5.issues[0]?.message.includes('Best Mentor') ?? false, 'the message names the value');

  const bigRows: Record<string, string>[] = [];
  const names = Array.from({ length: 30 }, (_, i) => `Special Award ${i + 1}`);
  for (let i = 0; i < 10_000; i++) bigRows.push({ Name: `P${i}`, 'Student ID': `X${i}`, Email: `p${i}@example.edu`, Event: EVENT, Award: i % 40 === 39 ? 'Participation' : names[i % 30], Date: '2026-03-14' });
  const bigSheet = { headers: ['Name', 'Student ID', 'Email', 'Event', 'Award', 'Date'], rows: bigRows, sourceName: 'big', encoding: 'utf-8', headerRowNumber: 1, rowNumbers: bigRows.map((_, i) => i + 2) };
  const t0 = performance.now();
  const bigRecs = m.ing.validateSheet(bigSheet, VALIDATE).valid;
  const bigScheme = m.rt.schemeFromDiscovery('big', 'big', ['Award'], m.rt.discoverCategories(bigRows, ['Award']), (g) => `T-${g.key}`, { multiAward: 'all-matches' });
  const bigRes = m.rt.assignCertificates(bigRecs, bigScheme);
  const ms = performance.now() - t0;
  console.log(`10,000 rows, ${bigScheme.categories.length} categories: validate + discover + assign in ${ms.toFixed(0)} ms`);
  eq(bigRes.assignments.length, 10_000, 'scale: one certificate per row');
  eq(bigRes.issues, [], 'scale: no issues');
  check(ms < 8000, `scale: took ${ms.toFixed(0)} ms (budget 8000 ms)`);
  return 'ROUTING ASSIGN OK';
}

async function caseConditions(m: Mods): Promise<string> {
  const t = (values: Record<string, string>, c: Condition) => m.rt.testCondition(values, c);
  const row = { Award: 'Best Pitch Award', Rank: '2', Score: '89.5', Track: ' AI  Safety ', Empty: '   ', Pct: '90%', Comma: '90,5', Thousands: '1,234', Lakh: '1,23,456', Text: 'abc' };
  const truth: [string, Condition, boolean][] = [
    ['equals exact', { column: 'Track', op: 'equals', value: 'AI Safety' }, true],
    ['equals ignores case and spaces', { column: 'Track', op: 'equals', value: '  ai   SAFETY' }, true],
    ['equals different text', { column: 'Track', op: 'equals', value: 'AI' }, false],
    ['equals number', { column: 'Rank', op: 'equals', value: 2 }, true],
    ['equals number as text 2.0', { column: 'Rank', op: 'equals', value: '2.0' }, true],
    ['equals other number', { column: 'Rank', op: 'equals', value: 3 }, false],
    ['equals heading case/space-insensitive', { column: ' rank ', op: 'equals', value: '2' }, true],
    ['equals on a column that does not exist', { column: 'Nope', op: 'equals', value: 'x' }, false],
    ['equals empty value does not match filled', { column: 'Track', op: 'equals', value: '' }, false],
    ['equals without a value does not match empty cells', { column: 'Empty', op: 'equals' }, false],
    ['contains word', { column: 'Award', op: 'contains', value: 'pitch' }, true],
    ['contains ignores case/space', { column: 'Award', op: 'contains', value: 'BEST  pitch' }, true],
    ['contains missing text', { column: 'Award', op: 'contains', value: 'ui' }, false],
    ['contains empty needle never matches', { column: 'Award', op: 'contains', value: '' }, false],
    ['startsWith', { column: 'Award', op: 'startsWith', value: 'best' }, true],
    ['startsWith (not the middle)', { column: 'Award', op: 'startsWith', value: 'pitch' }, false],
    ['startsWith empty never matches', { column: 'Award', op: 'startsWith', value: '' }, false],
    ['oneOf array', { column: 'Track', op: 'oneOf', value: ['Web', 'ai safety'] }, true],
    ['oneOf comma text', { column: 'Track', op: 'oneOf', value: 'Web, Mobile, AI Safety' }, true],
    ['oneOf none', { column: 'Track', op: 'oneOf', value: ['Web', 'Mobile'] }, false],
    ['oneOf empty list never matches', { column: 'Track', op: 'oneOf', value: [] }, false],
    ['isEmpty on spaces', { column: 'Empty', op: 'isEmpty' }, true],
    ['isEmpty on missing column', { column: 'Nope', op: 'isEmpty' }, true],
    ['isEmpty on filled', { column: 'Rank', op: 'isEmpty' }, false],
    ['between inside', { column: 'Score', op: 'between', value: [80, 90] }, true],
    ['between lower bound is inclusive', { column: 'Rank', op: 'between', value: [2, 5] }, true],
    ['between upper bound is inclusive', { column: 'Rank', op: 'between', value: [1, 2] }, true],
    ['between outside', { column: 'Rank', op: 'between', value: [3, 5] }, false],
    ['between reversed bounds', { column: 'Rank', op: 'between', value: [3, 1] }, true],
    ['between text bounds', { column: 'Rank', op: 'between', value: ['1', '3'] }, true],
    ['between "1-3"', { column: 'Rank', op: 'between', value: '1-3' }, true],
    ['between on text cell', { column: 'Text', op: 'between', value: [0, 100] }, false],
    ['between without a range', { column: 'Rank', op: 'between' }, false],
    ['gte equal', { column: 'Rank', op: 'gte', value: 2 }, true],
    ['gte above', { column: 'Score', op: 'gte', value: 90 }, false],
    ['gte decimal', { column: 'Score', op: 'gte', value: 89.5 }, true],
    ['gte percent cell', { column: 'Pct', op: 'gte', value: 90 }, true],
    ['gte decimal comma', { column: 'Comma', op: 'gte', value: 90.5 }, true],
    ['gte thousands separator', { column: 'Thousands', op: 'gte', value: 1234 }, true],
    ['gte Indian digit grouping 1,23,456', { column: 'Lakh', op: 'gte', value: 123456 }, true],
    ['lte below Indian grouping', { column: 'Lakh', op: 'lte', value: 123455 }, false],
    ['gte on text', { column: 'Text', op: 'gte', value: 0 }, false],
    ['gte on empty cell', { column: 'Empty', op: 'gte', value: 0 }, false],
    ['lte equal', { column: 'Rank', op: 'lte', value: 2 }, true],
    ['lte below', { column: 'Rank', op: 'lte', value: 1 }, false],
    ['lte on empty cell', { column: 'Empty', op: 'lte', value: 1000 }, false],
    ['lte on text value', { column: 'Rank', op: 'lte', value: 'abc' }, false],
  ];
  for (const [name, cond, want] of truth) eq(t(row, cond), want, `operator: ${name}`);
  check(truth.filter((x) => x[2]).length >= 15 && truth.filter((x) => !x[2]).length >= 15, 'truth table has both outcomes');
  const ops = new Set(truth.map((x) => x[1].op));
  eq(sorted([...ops]), sorted(['equals', 'contains', 'startsWith', 'oneOf', 'isEmpty', 'between', 'gte', 'lte']), 'every operator is exercised');

  const { sheet, records } = recordsOf(m, saveText('awards.csv', awardsCsv()), 'awards.csv');
  const rec = byRow(records);
  const cat = (id: string, priority: number, match: AwardCategory['match']): AwardCategory => ({ id, label: id, match, priority, templateId: `T-${id}` });
  const categories: AwardCategory[] = [
    cat('podium', 1, { all: [{ column: 'Rank', op: 'between', value: [1, 3] }] }),
    cat('high', 2, { all: [{ column: 'Score', op: 'gte', value: 90 }] }),
    cat('tech', 3, { any: [{ column: 'Track', op: 'equals', value: 'ai' }, { column: 'Track', op: 'startsWith', value: 'ml' }] }),
    cat('creative', 4, { all: [{ column: 'Award', op: 'oneOf', value: ['Best UI', 'Best Pitch'] }], any: [{ column: 'Track', op: 'equals', value: 'WEB' }, { column: 'Track', op: 'equals', value: 'mobile' }] }),
    cat('noscore', 5, { all: [{ column: 'Score', op: 'isEmpty' }] }),
    cat('low', 6, { all: [{ column: 'Score', op: 'lte', value: 70 }] }),
    cat('mention', 7, { all: [{ column: 'Award', op: 'contains', value: 'mention' }] }),
  ];
  const num = (s: string) => (s === '' ? null : Number(s));
  const truthFor: Record<string, (r: Row) => boolean> = {
    podium: (r) => num(r.rank) !== null && num(r.rank)! >= 1 && num(r.rank)! <= 3,
    high: (r) => num(r.score) !== null && num(r.score)! >= 90,
    tech: (r) => r.track.toLowerCase() === 'ai' || r.track.toLowerCase().startsWith('ml'),
    creative: (r) => ['best ui', 'best pitch'].includes(r.award.toLowerCase()) && ['web', 'mobile'].includes(r.track.toLowerCase()),
    noscore: (r) => r.score === '',
    low: (r) => num(r.score) !== null && num(r.score)! <= 70,
    mention: (r) => r.award.toLowerCase().includes('mention'),
  };
  const order = categories.map((c) => c.id);
  const mk = (extra: Partial<AwardScheme>): AwardScheme => ({ id: 'adv', name: 'adv', awardColumns: ['Award'], categories, multiAward: 'first-match', delivery: 'one-email', ...extra });
  const all = m.rt.assignCertificates(records, mk({ multiAward: 'all-matches', defaultTemplateId: 'T-default' }));
  const first = m.rt.assignCertificates(records, mk({ multiAward: 'first-match', defaultTemplateId: 'T-default' }));
  const catsOf = (res: typeof all, rowNo: number) => res.assignments.filter((a) => a.recordId === rec.get(rowNo)!.recordId).map((a) => a.categoryId);
  let anyDefault = 0, anyMulti = 0;
  const grantedAll = new Map<string, Set<string>>();
  const grantedFirst = new Map<string, Set<string>>();
  const dupRowsAll: number[] = [];
  ROWS.forEach((r, i) => {
    const matches = order.filter((id) => truthFor[id](r));
    const gotAll = catsOf(all, i + 2);
    const seenAll = grantedAll.get(r.id) ?? new Set<string>();
    grantedAll.set(r.id, seenAll);
    const expectAll = matches.filter((id) => !seenAll.has(id));
    if (matches.length !== expectAll.length) dupRowsAll.push(i + 2);
    for (const id of expectAll) seenAll.add(id);
    eq(gotAll, matches.length ? expectAll : ['default'], `all-matches row ${i + 2} "${r.award}" categories`);
    const seenFirst = grantedFirst.get(r.id) ?? new Set<string>();
    grantedFirst.set(r.id, seenFirst);
    const pick = matches.length ? [matches[0]] : ['default'];
    const expectFirst = pick.filter((id) => !seenFirst.has(id));
    for (const id of expectFirst) seenFirst.add(id);
    eq(catsOf(first, i + 2), expectFirst, `first-match row ${i + 2} "${r.award}"`);
    if (!matches.length) anyDefault++;
    if (matches.length > 1) anyMulti++;
  });
  check(anyDefault >= 1 && anyMulti >= 5, `fixture exercises priority and the default (default ${anyDefault}, overlaps ${anyMulti})`);
  eq(all.issues.filter((i) => i.code === 'DUPLICATE_RECORD').map((i) => i.row), dupRowsAll.flatMap((r) => all.issues.filter((i) => i.row === r).map((i) => i.row)), 'duplicate warnings sit on the repeat rows');
  check(dupRowsAll.length >= 2 && all.issues.every((i) => i.severity === 'warning'), 'repeats through rules are warnings, never errors');
  eq([...new Set(all.issues.map((i) => i.row))], dupRowsAll, 'only the repeat rows are reported');
  eq(catsOf(first, 2), ['podium'], 'Aarav 1st (rank 1, score 96): podium beats high-score by priority');
  eq(catsOf(all, 2), ['podium', 'high', 'tech'], 'Aarav 1st in all-matches mode');
  eq(catsOf(first, 6), ['high'], 'Diya Special Mention (score 91): high beats mention');
  eq(catsOf(first, 9), ['creative'], 'Ananya Best UI on Web: creative (all + any)');
  eq(catsOf(first, 14), ['low'], 'Arjun Hon. Mention (score 70): low beats mention');
  eq(catsOf(first, 22), ['low'], 'Dev "HM" (score 65): low (HM does not contain the word mention)');
  eq(catsOf(first, 19), ['noscore'], 'Zoë Mentor (no score, Mentoring track): noscore');
  eq(catsOf(first, 20), ['noscore'], 'Ünal Volunteer: noscore');
  eq(catsOf(first, 13), ['creative'], 'Ishita Best Pitch Mobile score 77: creative');
  const reversed = mk({ categories: [...categories].reverse() });
  eq(m.rt.assignCertificates(records, reversed).assignments.map((a) => a.categoryId), m.rt.assignCertificates(records, mk({})).assignments.map((a) => a.categoryId), 'list order does not matter, priority does');
  const flipped = mk({ categories: categories.map((c) => (c.id === 'podium' ? { ...c, priority: 99 } : c)) });
  const afterFlip = m.rt.assignCertificates(records, flipped).assignments.find((a) => a.recordId === rec.get(2)!.recordId)!.categoryId;
  eq(afterFlip, 'high', 'control: lowering the podium priority makes the high-score category win for Aarav');

  const rowA = { Rank: '1', Score: '50', Track: 'AI' };
  const both = (cond: AwardCategory['match']) => m.rt.matchesCategory(rowA, { id: 'x', label: 'x', match: cond, priority: 0, templateId: 't' }, ['Award']);
  check(both({ all: [{ column: 'Rank', op: 'equals', value: 1 }, { column: 'Score', op: 'gte', value: 40 }] }), 'all-of: both true');
  check(!both({ all: [{ column: 'Rank', op: 'equals', value: 1 }, { column: 'Score', op: 'gte', value: 60 }] }), 'all-of: one false');
  check(both({ any: [{ column: 'Rank', op: 'equals', value: 9 }, { column: 'Track', op: 'equals', value: 'ai' }] }), 'any-of: one true');
  check(!both({ any: [{ column: 'Rank', op: 'equals', value: 9 }, { column: 'Track', op: 'equals', value: 'web' }] }), 'any-of: none true');
  check(both({ all: [{ column: 'Rank', op: 'equals', value: 1 }], any: [{ column: 'Score', op: 'gte', value: 60 }, { column: 'Track', op: 'equals', value: 'AI' }] }), 'all + any together');
  check(!both({ all: [{ column: 'Rank', op: 'equals', value: 2 }], any: [{ column: 'Track', op: 'equals', value: 'AI' }] }), 'all + any: failing all-of fails the rule');
  check(!both({ all: [{ column: 'Rank', op: 'equals', value: 1 }], any: [{ column: 'Track', op: 'equals', value: 'Web' }] }), 'all + any: failing any-of fails the rule');
  check(!both({}) && !both({ all: [], any: [] }), 'a rule with no conditions matches nothing');

  const strict = mk({ categories: categories.filter((c) => c.id === 'podium') });
  const resStrict = m.rt.assignCertificates(records, strict);
  const unmatchedRows = ROWS.map((r, i) => [i + 2, r] as const).filter(([, r]) => !truthFor.podium(r));
  eq(resStrict.issues.map((i) => i.row), unmatchedRows.map(([n]) => n), 'NO_TEMPLATE_MATCH on exactly the unmatched rows');
  check(resStrict.issues.every((i) => i.code === 'NO_TEMPLATE_MATCH' && i.severity === 'error'), 'NO_TEMPLATE_MATCH is an error');
  for (const i of resStrict.issues) check(i.message.includes(ROWS[i.row - 2].award), `row ${i.row} message names "${ROWS[i.row - 2].award}": ${i.message}`);
  eq(resStrict.assignments.length, ROWS.length - unmatchedRows.length, 'matched rows still get certificates');
  eq(sorted(resStrict.unmatchedValues).length, new Set(unmatchedRows.map(([, r]) => r.award.toLowerCase())).size, 'unmatchedValues lists each unmatched value once (case-insensitively)');
  const withDefault = m.rt.assignCertificates(records, { ...strict, defaultTemplateId: 'T-default' });
  eq(withDefault.issues, [], 'with a default template there is no NO_TEMPLATE_MATCH');
  eq(withDefault.assignments.filter((a) => a.templateId === 'T-default').length, unmatchedRows.length, 'unmatched rows use the default template');
  eq(withDefault.assignments.filter((a) => a.categoryId === m.rt.DEFAULT_CATEGORY_ID).length, unmatchedRows.length, 'default certificates carry the default category id');
  const messy = recordsOf(m, saveText('awards-messy.csv', toCsv(HEAD, [rowCells(R('S200', 'Messy One', '  BEST   ui ', '', '', 'wEb', 'ui'))])), 'awards-messy.csv');
  const msch = mk({ categories: [cat('ui-web', 1, { all: [{ column: 'Award', op: 'equals', value: 'best ui' }, { column: 'track', op: 'equals', value: 'WEB' }] })] });
  eq(m.rt.assignCertificates(messy.records, msch).assignments.map((a) => a.categoryId), ['ui-web'], 'messy case/space matches');
  const blank = recordsOf(m, saveText('awards-blank.csv', toCsv(HEAD, [rowCells(R('S201', 'No Award', '', '', '88', 'AI', 'part'))])), 'awards-blank.csv');
  const noAward = m.rt.assignCertificates(blank.records, mk({ categories: categories.filter((c) => c.id === 'podium') }));
  eq(noAward.issues.map((i) => [i.code, i.row]), [['NO_TEMPLATE_MATCH', 2]], 'a row without any award and no matching rule is flagged');
  void sheet;
  return 'ROUTING CONDITIONS OK';
}

const MA_HEAD = ['Name', 'Student ID', 'Email', 'Event', 'Award', 'Rank', 'Score', 'Date'];
const maRow = (name: string, id: string, award: string, rank: string, score: string) => [name, id, `${id.toLowerCase()}@example.edu`, EVENT, award, rank, score, '2026-03-14'];
async function caseMultiAward(m: Mods): Promise<string> {
  const rows = [
    maRow('Priya Nair', 'P1', 'Participation', '', ''),
    maRow('Priya Nair', 'P1', 'Best UI', '', '95'),
    maRow('Priya Nair', 'P1', '2nd Prize', '2', '70'),
    maRow('Quinn Ortiz', 'Q1', 'Participation; Best UI', '', '50'),
    maRow('Quinn Ortiz', 'Q1', 'Participation', '', ''),
    maRow('Rae Chen', 'R1', 'Participation', '', ''),
    maRow('Rae Chen', 'R1', 'participation', '', ''),
    maRow('Sam Okafor', 'S1', '2nd Prize', '2', '92'),
  ];
  const bytes = saveText('multi-award.csv', toCsv(MA_HEAD, rows));
  const sheet = m.ing.parseSheet(bytes, 'multi-award.csv');
  const mapping = [...MAP];
  const v = m.ing.validateSheet(sheet, { ...VALIDATE, mapping });

  eq(v.issues.map((i) => [i.row, i.code, i.severity]), [[8, 'DUPLICATE_RECORD', 'error']], 'validate: only the repeated Participation (row 8) is a duplicate');
  eq(v.valid.map((r) => r.rowNumber), [2, 3, 4, 5, 6, 7, 9], 'validate: valid rows');
  const rec = byRow(v.valid);
  check(rec.get(2)!.personKey === rec.get(3)!.personKey && rec.get(3)!.personKey === rec.get(4)!.personKey, 'Priya\'s three rows are one person');
  check(new Set([rec.get(2)!.recordId, rec.get(3)!.recordId, rec.get(4)!.recordId]).size === 3, 'three rows, three record ids');
  const otherEvent = m.ing.validateSheet(m.ing.parseSheet(new TextEncoder().encode(toCsv(MA_HEAD, [maRow('Rae Chen', 'R1', 'Participation', '', ''), [...maRow('Rae Chen', 'R1', 'Participation', '', '')].map((x, i) => (i === 3 ? 'DevSummit' : x))])), 'oe.csv'), { ...VALIDATE, mapping });
  eq(otherEvent.issues, [], 'same person, same award, different event: not a duplicate');

  const cat = (id: string, priority: number, extra: Partial<AwardCategory>): AwardCategory => ({ id, label: id, priority, templateId: `T-${id}`, ...extra });
  const categories: AwardCategory[] = [
    cat('high', 1, { match: { all: [{ column: 'Score', op: 'gte', value: 90 }] } }),
    cat('second', 2, { values: ['2nd Prize'] }),
    cat('ui', 3, { values: ['Best UI'] }),
    cat('part', 5, { values: ['Participation'] }),
  ];
  const scheme = (multiAward: AwardScheme['multiAward']): AwardScheme => ({ id: 'ma', name: 'ma', awardColumns: ['Award'], categories, multiAward, delivery: 'one-email' });

  const all = m.rt.assignCertificates(v.valid, scheme('all-matches'));
  const catsOf = (res: typeof all, rowNo: number) => res.assignments.filter((a) => a.recordId === rec.get(rowNo)!.recordId).map((a) => a.categoryId);
  eq(catsOf(all, 2), ['part'], 'all-matches row 2');
  eq(catsOf(all, 3), ['high', 'ui'], 'all-matches row 3: Best UI with score 95 -> both categories');
  eq(catsOf(all, 4), ['second'], 'all-matches row 4');
  eq(catsOf(all, 5), ['ui', 'part'], 'all-matches row 5: one cell with two awards -> two certificates');
  eq(catsOf(all, 6), [], 'all-matches row 6: second Participation for Quinn is not made again');
  eq(catsOf(all, 7), ['part'], 'all-matches row 7');
  eq(catsOf(all, 9), ['high', 'second'], 'all-matches row 9');
  eq(all.issues.map((i) => [i.row, i.code, i.severity]), [[6, 'DUPLICATE_RECORD', 'error']], 'routing flags Quinn\'s repeated Participation (row 6) as a duplicate');
  check(all.issues[0]?.message.includes('row 5') ?? false, 'the duplicate message points at the first row (5)');
  eq(all.assignments.length, 1 + 2 + 1 + 2 + 0 + 1 + 2, 'certificate count');
  eq(new Set(all.assignments.map((a) => a.certId)).size, all.assignments.length, 'certificate ids are unique');
  const priya = all.assignments.filter((a) => a.personKey === rec.get(2)!.personKey);
  eq(sorted(priya.map((a) => a.categoryId)), ['high', 'part', 'second', 'ui'], 'Priya gets four different certificates (3 rows, one with two categories)');
  eq(new Set(priya.map((a) => a.personKey)).size, 1, 'all of Priya\'s certificates belong to one person');

  const fm = m.rt.assignCertificates(v.valid, scheme('first-match'));
  eq([2, 3, 4, 5, 6, 7, 9].map((r) => catsOf(fm, r)), [['part'], ['high'], ['second'], ['ui'], ['part'], ['part'], ['high']], 'first-match: at most one certificate per row');
  eq(fm.issues, [], 'first-match: no duplicates because row 5 only produced "Best UI"');
  check(all.assignments.length > fm.assignments.length, 'all-matches yields more certificates than first-match');

  const twice = m.rt.assignCertificates([rec.get(7)!, { ...rec.get(7)!, rowNumber: 99, recordId: 'rec-copy' }], scheme('all-matches'));
  eq(twice.assignments.length, 1, 'same person + same award twice yields one certificate');
  eq(twice.issues.map((i) => [i.row, i.code]), [[99, 'DUPLICATE_RECORD']], 'and a DUPLICATE_RECORD for the second');
  const two = m.rt.assignCertificates([rec.get(7)!, rec.get(2)!], scheme('all-matches'));
  eq(two.assignments.length, 2, 'two people with the same award: two certificates');
  eq(two.issues, [], 'two people with the same award: no issue');
  const e1 = { ...rec.get(7)!, values: { ...rec.get(7)!.values, EVENT: 'HackFest 2026' } };
  const e2 = { ...rec.get(7)!, rowNumber: 50, recordId: 'rec-e2', values: { ...rec.get(7)!.values, EVENT: 'DevSummit 2026' } };
  const events = m.rt.assignCertificates([e1, e2], scheme('all-matches'));
  eq(events.assignments.length, 2, 'same person and award at two different events: two certificates');
  eq(events.issues, [], 'same person and award at two different events: no duplicate');
  return 'ROUTING MULTI AWARD OK';
}

async function caseOverrides(m: Mods): Promise<string> {
  const rows = [
    maRow('Priya Nair', 'P1', 'Participation', '', ''),
    maRow('Priya Nair', 'P1', 'Best UI', '', '95'),
    maRow('Priya Nair', 'P1', '2nd Prize', '2', '70'),
    maRow('Quinn Ortiz', 'Q1', 'Participation', '', ''),
    maRow('Rae Chen', 'R1', 'Best UI', '', '60'),
    maRow('Sam Okafor', 'S1', 'Volunteer', '', ''),
  ];
  const sheet = m.ing.parseSheet(saveText('overrides.csv', toCsv(MA_HEAD, rows)), 'overrides.csv');
  const v = m.ing.validateSheet(sheet, { ...VALIDATE, mapping: MAP });
  eq(v.issues, [], 'overrides fixture is clean');
  const rec = byRow(v.valid);
  const categories: AwardCategory[] = [
    { id: 'high', label: 'High scorer', priority: 1, templateId: 'T-high', match: { all: [{ column: 'Score', op: 'gte', value: 90 }] }, driveSubfolder: 'High scorers' },
    { id: 'second', label: '2nd Prize', priority: 2, templateId: 'T-second', values: ['2nd Prize'], emailTemplateId: 'email-podium', driveSubfolder: 'Podium', linkedInTitle: 'Runner-up, HackFest 2026' },
    { id: 'ui', label: 'Best UI', priority: 3, templateId: 'T-ui', values: ['Best UI'], emailTemplateId: 'email-creative', driveSubfolder: 'Creative/UI', linkedInTitle: 'Best UI Award, HackFest 2026' },
    { id: 'part', label: 'Participation', priority: 5, templateId: 'T-part', values: ['Participation'] },
  ];
  const scheme = (delivery: AwardScheme['delivery']): AwardScheme => ({ id: 'ov', name: 'ov', awardColumns: ['Award'], categories, multiAward: 'all-matches', delivery, defaultTemplateId: 'T-default' });
  const res = m.rt.assignCertificates(v.valid, scheme('one-email'));
  eq(res.issues, [], 'no issues');
  const settings = (a: { categoryId: string }) => m.rt.certificateSettings(scheme('one-email'), a.categoryId);
  const EXPECT_BY_CAT: Record<string, { templateId: string; emailTemplateId?: string; driveSubfolder?: string; linkedInTitle?: string }> = {
    high: { templateId: 'T-high', driveSubfolder: 'High scorers' },
    second: { templateId: 'T-second', emailTemplateId: 'email-podium', driveSubfolder: 'Podium', linkedInTitle: 'Runner-up, HackFest 2026' },
    ui: { templateId: 'T-ui', emailTemplateId: 'email-creative', driveSubfolder: 'Creative/UI', linkedInTitle: 'Best UI Award, HackFest 2026' },
    part: { templateId: 'T-part' },
    default: { templateId: 'T-default' },
  };
  eq(res.assignments.length, 7, 'certificate count: Priya 4 (Participation, High scorer + Best UI, 2nd), Quinn 1, Rae 1, Sam 1 default');
  for (const a of res.assignments) {
    const s = settings(a)!;
    const want = EXPECT_BY_CAT[a.categoryId];
    eq({ templateId: s.templateId, emailTemplateId: s.emailTemplateId, driveSubfolder: s.driveSubfolder, linkedInTitle: s.linkedInTitle }, {
      templateId: want.templateId, emailTemplateId: want.emailTemplateId, driveSubfolder: want.driveSubfolder, linkedInTitle: want.linkedInTitle,
    }, `settings of the "${a.categoryId}" certificate (must not leak from other categories)`);
    eq(a.templateId, want.templateId, `assignment template of "${a.categoryId}"`);
  }
  for (const id of ['second', 'ui', 'high']) {
    const holders = res.assignments.filter((a) => a.categoryId === id);
    check(holders.length >= 1, `somebody holds "${id}"`);
    eq(sorted(holders.map((a) => settings(a)!.driveSubfolder ?? '')), sorted(holders.map(() => EXPECT_BY_CAT[id].driveSubfolder ?? '')), `subfolder only on ${id}`);
  }
  eq(res.assignments.filter((a) => settings(a)!.emailTemplateId === 'email-creative').length, 2, 'email-creative on the two Best UI certificates only');
  eq(res.assignments.filter((a) => settings(a)!.linkedInTitle === 'Runner-up, HackFest 2026').length, 1, 'the runner-up LinkedIn title on one certificate only');
  eq(res.assignments.filter((a) => settings(a)!.driveSubfolder === undefined).length, 3, 'certificates without a subfolder: Participation x2 and the default one');
  eq(m.rt.certificateSettings(scheme('one-email'), 'no-such-category'), undefined, 'unknown category: no settings');
  const defaultOnly = m.rt.certificateSettings({ ...scheme('one-email'), defaultTemplateId: undefined }, m.rt.DEFAULT_CATEGORY_ID);
  eq(defaultOnly, undefined, 'default category without a default template: no settings');

  const people = new Set(res.assignments.map((a) => a.personKey));
  const one = m.rt.groupForDelivery(res.assignments, 'one-email');
  eq(one.length, people.size, 'one-email: one group per person');
  for (const g of one) {
    const mine = res.assignments.filter((a) => a.personKey === g.personKey).map((a) => a.certId);
    eq(sorted(g.items.map((i) => i.certId)), sorted(mine), `one-email: group of ${g.personKey} holds exactly that person's certificates`);
    check(g.items.every((i) => i.personKey === g.personKey), 'one-email: a group never mixes people');
    eq(g.key, g.personKey, 'one-email: group key is the person key');
  }
  eq(one.find((g) => g.personKey === rec.get(2)!.personKey)!.items.length, 4, 'one-email: Priya\'s email carries four certificates');
  eq(one.reduce((a, g) => a + g.items.length, 0), res.assignments.length, 'one-email: every certificate is in exactly one email');
  const per = m.rt.groupForDelivery(res.assignments, 'email-per-certificate');
  eq(per.length, res.assignments.length, 'email-per-certificate: one email per certificate');
  check(per.every((g) => g.items.length === 1 && g.key === g.items[0].certId), 'email-per-certificate: each email carries one certificate');
  eq(per.map((g) => g.items[0].certId), res.assignments.map((a) => a.certId), 'email-per-certificate: input order is kept');
  const doubled = m.rt.groupForDelivery([...res.assignments, ...res.assignments], 'one-email');
  eq(doubled.map((g) => g.items.length), one.map((g) => g.items.length), 'a repeated certificate is not attached twice');
  eq(m.rt.groupForDelivery([], 'one-email'), [], 'nothing to send: no groups');
  check(one.length < per.length, 'one-email makes fewer emails than email-per-certificate here');

  const sc = scheme('one-email');
  const priyaCats = res.assignments.filter((a) => a.personKey === rec.get(2)!.personKey).map((a) => a.categoryId);
  eq(m.rt.emailTemplateIdForGroup(sc, priyaCats), 'email-podium', 'combined email takes the wording of the highest-priority category that has one');
  eq(m.rt.emailTemplateIdForGroup(sc, ['part']), undefined, 'no category wording: default wording');
  eq(m.rt.emailTemplateIdForGroup(sc, ['ui']), 'email-creative', 'a one-certificate email uses that category\'s wording');
  eq(m.rt.emailTemplateIdForGroup(sc, [m.rt.DEFAULT_CATEGORY_ID]), undefined, 'default certificate: default wording');
  return 'ROUTING OVERRIDES OK';
}

async function caseScheme(m: Mods): Promise<string> {
  const { sheet: sheetA, records: recsA } = recordsOf(m, saveText('awards.csv', awardsCsv()), 'awards.csv');
  const groups = m.rt.discoverCategories(sheetA.rows, ['Award']);
  const base = m.rt.schemeFromDiscovery('scheme-hackfest', 'HackFest awards', ['Award'], groups, (g) => tplOf(groupOfSpelling(g.values[0])), { multiAward: 'all-matches', delivery: 'one-email' });
  const topScorer: AwardCategory = { id: 'cat-top-scorer', label: 'Top scorer', priority: -1, templateId: 'T-top', match: { all: [{ column: 'Score', op: 'gte', value: 97 }] }, driveSubfolder: 'Top scorers' };
  const saved: AwardScheme = {
    ...base,
    categories: [topScorer, ...base.categories.map((c) => (c.templateId === tplOf('ui') ? { ...c, emailTemplateId: 'email-creative', driveSubfolder: 'Creative', linkedInTitle: 'Best UI' } : c))],
    defaultTemplateId: undefined,
  };
  delete saved.defaultTemplateId;

  const db = m.db.openDb();
  m.db.saveDoc(db, 'schemes', 'org-1', saved.id, saved.name, saved);
  const loaded = m.db.getDoc<AwardScheme>(db, 'schemes', 'org-1', saved.id)!;
  eq(loaded, JSON.parse(JSON.stringify(saved)), 'the saved scheme reloads unchanged');
  eq(m.db.listDocs<AwardScheme>(db, 'schemes', 'org-1').map((d) => d.name), ['HackFest awards'], 'the scheme is listed');
  eq(m.db.getDoc(db, 'schemes', 'org-2', saved.id), undefined, 'another organizer cannot load it');

  const same = m.rt.schemeCoverage(loaded, sheetA.rows);
  eq(same.newValues, [], 'control: the original sheet has no new values');
  eq(same.covered.length, new Set(ROWS.map((r) => r.award.toLowerCase())).size, 'control: every original value is covered');
  const resA = m.rt.assignCertificates(recsA, loaded);
  eq(resA.issues, [], 'control: original sheet routes without issues');

  const B_HEAD = ['Rank', 'AWARD', 'Score', 'Event', 'Email', 'Date', 'Name', 'Student ID', 'Track'];
  const B = [
    ['1', 'First Prize', '93', 'DevSummit 2027', 'b1@example.edu', '2027-02-01', 'Beta One', 'B001', 'AI'],
    ['', 'Honorable Mention', '71', 'DevSummit 2027', 'b2@example.edu', '2027-02-01', 'Beta Two', 'B002', 'Web'],
    ['', 'participation', '', 'DevSummit 2027', 'b3@example.edu', '2027-02-01', 'Beta Three', 'B003', 'Web'],
    ['', 'Best Mentor', '60', 'DevSummit 2027', 'b4@example.edu', '2027-02-01', 'Beta Four', 'B004', 'Ops'],
    ['', 'Best UI', '97', 'DevSummit 2027', 'b5@example.edu', '2027-02-01', 'Beta Five', 'B005', 'Web'],
    ['', 'Best Documentation', '97', 'DevSummit 2027', 'b6@example.edu', '2027-02-01', 'Beta Six', 'B006', 'Web'],
    ['', 'Special Jury', '85', 'DevSummit 2027', 'b7@example.edu', '2027-02-01', 'Beta Seven', 'B007', 'AI'],
    ['', 'best  mentor', '', 'DevSummit 2027', 'b8@example.edu', '2027-02-01', 'Beta Eight', 'B008', 'Ops'],
  ];
  const sheetB = m.ing.parseSheet(saveXlsx('awards-next-event.xlsx', [B_HEAD, ...B]), 'awards-next-event.xlsx');
  eq(sheetB.headers, B_HEAD, 'the new sheet keeps its own column order');
  const mapB = [
    { placeholder: 'NAME', column: 'Name' }, { placeholder: 'ID', column: 'Student ID' }, { placeholder: 'EVENT', column: 'Event' },
    { placeholder: 'CERTIFICATE_TYPE', column: 'AWARD' }, { placeholder: 'DATE', column: 'Date' },
  ];
  const vB = m.ing.validateSheet(sheetB, { ...VALIDATE, mapping: mapB, awardColumns: loaded.awardColumns });
  eq(vB.issues, [], 'the new sheet validates (award column found by heading "AWARD" for the saved "Award")');
  const recB = byRow(vB.valid);

  const cov = m.rt.schemeCoverage(loaded, sheetB.rows);
  eq(cov.newValues.map((v) => v.toLowerCase().replace(/\s+/g, ' ')), ['best documentation', 'best mentor'], 'only the genuinely new values are flagged');
  eq(sorted(cov.covered.map((v) => v.toLowerCase())), ['best ui', 'first prize', 'honorable mention', 'participation', 'special jury'], 'known awards are covered, spelled however the new sheet spells them');

  const resB = m.rt.assignCertificates(vB.valid, loaded);
  const certsOf = (rowNo: number) => resB.assignments.filter((a) => a.recordId === recB.get(rowNo)!.recordId);
  const catId = (g: GroupKey) => base.categories.find((c) => c.templateId === tplOf(g))!.id;
  eq(certsOf(2).map((a) => a.categoryId), [catId('1st')], 'row 2 "First Prize" -> the saved 1st category');
  eq(certsOf(3).map((a) => a.categoryId), [catId('hm')], 'row 3 "Honorable Mention" -> the saved honorable-mention category');
  eq(certsOf(4).map((a) => a.categoryId), [catId('part')], 'row 4 "participation" -> the saved participation category');
  eq(certsOf(6).map((a) => a.categoryId), [topScorer.id, catId('ui')], 'row 6 "Best UI" with score 97 -> Top scorer and Best UI, in priority order');
  eq(certsOf(8).map((a) => a.categoryId), [catId('jury')], 'row 8 "Special Jury" -> the saved jury category');
  eq(certsOf(2).map((a) => a.templateId), [tplOf('1st')], 'the 1st certificate keeps its saved template');
  check(resB.assignments.every((a) => loaded.categories.some((c) => c.id === a.categoryId)), 'every assignment uses a category from the saved scheme');
  const flagged = resB.issues.filter((i) => i.code === 'NO_TEMPLATE_MATCH');
  eq(flagged.map((i) => i.row), [5, 7, 9], 'NO_TEMPLATE_MATCH on the three rows holding new values');
  eq(flagged.map((i) => (i.message.match(/Best (Mentor|Documentation)/i) ?? [''])[0].toLowerCase()), ['best mentor', 'best documentation', 'best mentor'], 'each message names its new value');
  eq(flagged.map((i) => i.severity), ['error', 'warning', 'error'], 'severity: error when the row gets nothing, warning when other certificates are still made (row 7 also earns Top scorer)');
  eq(certsOf(7).map((a) => a.categoryId), [topScorer.id], 'row 7 still gets the Top scorer certificate');
  eq(certsOf(5), [], 'row 5 gets no certificate until the new value is assigned');
  eq(resB.unmatchedValues.map((v) => v.toLowerCase().replace(/\s+/g, ' ')), ['best documentation', 'best mentor'], 'unmatched values: only the new ones');
  eq(resB.issues.length, 3, 'no other issue appears');
  eq(loaded, JSON.parse(JSON.stringify(saved)), 'applying the scheme did not modify it');

  const proposed = m.rt.newCategoriesFor(loaded, sheetB.rows, (g) => (g.label.toLowerCase().includes('mentor') ? 'T-bestmentor' : 'T-bestdoc'));
  eq(proposed.map((c) => [c.label.toLowerCase().replace(/\s+/g, ' '), c.templateId, c.values?.length]).sort(), [['best documentation', 'T-bestdoc', 1], ['best mentor', 'T-bestmentor', 1]], 'proposed categories: exactly the new values ("Best Mentor" and "best  mentor" are one spelling)');
  check(proposed.every((c) => !loaded.categories.some((k) => k.id === c.id)) && new Set(proposed.map((c) => c.id)).size === 2, 'proposed categories have fresh unique ids');
  eq(m.rt.discoverCategories(sheetB.rows, ['AWARD']).find((c) => c.values.some((v) => /best\s+mentor/i.test(v)))?.count, 2, 'both Best Mentor rows are counted in that one category');
  eq(m.rt.newCategoriesFor(loaded, sheetA.rows, () => 'x'), [], 'control: nothing is proposed for the sheet the scheme came from');
  const extended: AwardScheme = { ...loaded, categories: [...loaded.categories, ...proposed] };
  const resB2 = m.rt.assignCertificates(vB.valid, extended);
  eq(resB2.issues, [], 'after adding the two categories there are no issues');
  eq([5, 7, 9].map((r) => resB2.assignments.filter((a) => a.recordId === recB.get(r)!.recordId).map((a) => a.templateId)), [['T-bestmentor'], ['T-top', 'T-bestdoc'], ['T-bestmentor']], 'the new categories route their rows (row 7 keeps Top scorer too)');
  eq(m.rt.schemeCoverage(extended, sheetB.rows).newValues, [], 'nothing is new any more');
  const withDefault = m.rt.assignCertificates(vB.valid, { ...loaded, defaultTemplateId: 'T-default' });
  eq(withDefault.issues, [], 'a default template absorbs new values');
  eq(withDefault.assignments.filter((a) => a.templateId === 'T-default').length, 3, 'three default certificates');
  const reorderedHead = ['Name', 'Student ID', 'Email', 'Event', 'AWARD', 'Rank', 'Score', 'Track', 'Date'];
  const reordered = m.ing.parseSheet(saveXlsx('awards-next-event-ordered.xlsx', [reorderedHead, ...B.map((r) => [r[6], r[7], r[4], r[3], r[1], r[0], r[2], r[8], r[5]])]), 'awards-next-event-ordered.xlsx');
  const vR = m.ing.validateSheet(reordered, { ...VALIDATE, mapping: mapB, awardColumns: loaded.awardColumns });
  const resR = m.rt.assignCertificates(vR.valid, loaded);
  eq(resR.assignments.map((a) => [a.categoryId, a.templateId]), resB.assignments.map((a) => [a.categoryId, a.templateId]), 'column order does not change any assignment');
  eq(resR.issues.map((i) => [i.row, i.code]), resB.issues.map((i) => [i.row, i.code]), 'column order does not change any issue');
  return 'ROUTING SCHEME OK';
}

const CASES: Record<string, (m: Mods) => Promise<string>> = {
  discover: caseDiscover, assign: caseAssign, conditions: caseConditions, 'multi-award': caseMultiAward, overrides: caseOverrides, scheme: caseScheme,
};

async function main(): Promise<void> {
  const idx = process.argv.indexOf('--case');
  const name = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!name || !CASES[name]) { console.error(`usage: --case ${Object.keys(CASES).join('|')}`); process.exit(2); }
  const mods: Mods = {
    ing: await import('../../src/lib/ingest'),
    rt: await import('../../src/lib/routing'),
    db: await import('../../src/lib/db'),
  };
  const token = await CASES[name](mods);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {  }
  if (failures) { console.error(`${failures} assertion(s) failed in case ${name}`); process.exit(1); }
  console.log(token);
}

main().catch((e) => { console.error(`FAIL: ${(e as Error).stack ?? e}`); process.exit(1); });
