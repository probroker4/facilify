import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as XLSX from 'xlsx';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-ingest-'));
process.env.CERTFLOW_DATA_DIR = tmp;

const FIX = path.join(process.cwd(), 'fixtures', 'ingest');
fs.mkdirSync(FIX, { recursive: true });

type Ingest = typeof import('../../src/lib/ingest');
type Row = Record<string, string>;

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
function save(name: string, bytes: Uint8Array): Uint8Array {
  fs.writeFileSync(path.join(FIX, name), bytes);
  return new Uint8Array(fs.readFileSync(path.join(FIX, name)));
}

function csvField(v: string, delim: string): string {
  return /["\r\n]/.test(v) || v.includes(delim) ? `"${v.replace(/"/g, '""')}"` : v;
}
function toCsv(headers: string[], rows: string[][], delim = ',', eol = '\n'): string {
  return [headers, ...rows].map((r) => r.map((v) => csvField(v, delim)).join(delim)).join(eol) + eol;
}
function utf16le(text: string, bom = true): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[o++] = c & 0xff; out[o++] = c >> 8; }
  return out;
}
const CP1252_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
function cp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const c = ch.charCodeAt(0);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[i] = c;
    else if (ch in CP1252_EXTRA) out[i] = CP1252_EXTRA[ch];
    else throw new Error(`cannot encode ${ch} in cp1252`);
  }
  return out;
}
function serial(y: number, m: number, d: number): number {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}
type XCell = string | number | { date: [number, number, number]; fmt: string };
function sheetOf(aoa: XCell[][], date1904 = false): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  aoa.forEach((line, r) => line.forEach((v, c) => {
    maxC = Math.max(maxC, c);
    const ref = XLSX.utils.encode_cell({ r, c });
    if (typeof v === 'number') ws[ref] = { t: 'n', v };
    else if (typeof v === 'string') { if (v !== '') ws[ref] = { t: 's', v }; }
    else ws[ref] = { t: 'n', v: serial(...v.date) - (date1904 ? 1462 : 0), z: v.fmt };
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: maxC } });
  return ws;
}
function workbook(aoa: XCell[][], bookType: 'xlsx' | 'xls', date1904 = false): Uint8Array {
  const wb = XLSX.utils.book_new();
  if (date1904) wb.Workbook = { WBProps: { date1904: true } };
  XLSX.utils.book_append_sheet(wb, sheetOf(aoa, date1904), 'Students');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType }) as Buffer);
}

const HEADERS = ['Person Name', 'Student ID', 'Student Email', 'Personal Email', 'Event', 'Award', 'Date'];
const EXPECTED_ROWS: Row[] = [
  { 'Person Name': 'José Núñez', 'Student ID': '1001', 'Student Email': 'jose@uni.edu', 'Personal Email': 'jose.n@gmail.com', Event: 'HackFest 2026', Award: '1st Prize', Date: '2026-03-15' },
  { 'Person Name': 'Zoë O’Brien-Müller', 'Student ID': '202612345678', 'Student Email': 'zoe@uni.edu', 'Personal Email': '', Event: 'HackFest 2026', Award: 'Best UI, Design', Date: '2026-12-31' },
  { 'Person Name': 'François "Frank" Dœ', 'Student ID': '1003', 'Student Email': 'frank@uni.edu', 'Personal Email': 'f@x.org', Event: 'HackFest 2026', Award: 'Participation', Date: '2026-01-01' },
  { 'Person Name': 'अनन्या शर्मा', 'Student ID': '1004', 'Student Email': 'ananya@uni.edu', 'Personal Email': '', Event: 'HackFest 2026', Award: 'Hon. Mention', Date: '2025-02-28' },
  { 'Person Name': 'Ünal Şahin', 'Student ID': '1005', 'Student Email': 'unal@uni.edu', 'Personal Email': '', Event: 'HackFest 2026', Award: '2nd Prize', Date: '2024-02-29' },
];
const LATIN_ROWS = EXPECTED_ROWS.filter((r) => { try { cp1252(Object.values(r).join('')); return true; } catch { return false; } });
const DATES: [number, number, number][] = [[2026, 3, 15], [2026, 12, 31], [2026, 1, 1], [2025, 2, 28], [2024, 2, 29]];
const DATE_FORMATS = ['yyyy-mm-dd', 'm/d/yy', 'dd/mm/yyyy', 'd-mmm-yyyy', 'dddd, mmmm d, yyyy'];
const lines = (rows: Row[]) => rows.map((r) => HEADERS.map((h) => r[h]));

async function caseParse(ing: Ingest): Promise<string> {
  const full = toCsv(HEADERS, lines(EXPECTED_ROWS));
  const variants: { name: string; bytes: Uint8Array; rows: Row[]; encoding?: string }[] = [
    { name: 'utf8-comma-lf.csv', bytes: new TextEncoder().encode(full), rows: EXPECTED_ROWS, encoding: 'utf-8' },
    { name: 'utf8bom-comma-crlf.csv', bytes: new TextEncoder().encode('﻿' + toCsv(HEADERS, lines(EXPECTED_ROWS), ',', '\r\n')), rows: EXPECTED_ROWS, encoding: 'utf-8-bom' },
    { name: 'utf8-semicolon-crlf.csv', bytes: new TextEncoder().encode(toCsv(HEADERS, lines(EXPECTED_ROWS), ';', '\r\n')), rows: EXPECTED_ROWS },
    { name: 'utf16le-bom-comma.csv', bytes: utf16le(full), rows: EXPECTED_ROWS, encoding: 'utf-16le' },
    { name: 'utf16le-bom-tab-crlf.csv', bytes: utf16le(toCsv(HEADERS, lines(EXPECTED_ROWS), '\t', '\r\n')), rows: EXPECTED_ROWS, encoding: 'utf-16le' },
    { name: 'utf16le-nobom-semicolon.csv', bytes: utf16le(toCsv(HEADERS, lines(EXPECTED_ROWS), ';'), false), rows: EXPECTED_ROWS, encoding: 'utf-16le' },
    { name: 'cp1252-semicolon-crlf.csv', bytes: cp1252(toCsv(HEADERS, lines(LATIN_ROWS), ';', '\r\n')), rows: LATIN_ROWS, encoding: 'windows-1252' },
    { name: 'cp1252-comma-lf.csv', bytes: cp1252(toCsv(HEADERS, lines(LATIN_ROWS))), rows: LATIN_ROWS, encoding: 'windows-1252' },
  ];
  check(variants[6].bytes.includes(0xe9) && !Buffer.from(variants[6].bytes).includes(Buffer.from('é')), 'cp1252 fixture is not really cp1252');
  eq(LATIN_ROWS.map((r) => r['Person Name']), ['José Núñez', 'Zoë O’Brien-Müller', 'François "Frank" Dœ'], 'rows that can be written as Windows-1252');
  check(variants[6].bytes.includes(0x92) && variants[6].bytes.includes(0x9c), 'cp1252 fixture lacks 0x92/0x9C bytes');

  for (const book of ['xlsx', 'xls'] as const) {
    for (const date1904 of book === 'xlsx' ? [false, true] : [false]) {
      const aoa: XCell[][] = [HEADERS, ...EXPECTED_ROWS.map((r, i) => [
        r['Person Name'], Number(r['Student ID']), r['Student Email'], r['Personal Email'], r.Event, r.Award, { date: DATES[i], fmt: DATE_FORMATS[i] },
      ])];
      variants.push({ name: `students${date1904 ? '-1904' : ''}.${book}`, bytes: workbook(aoa, book, date1904), rows: EXPECTED_ROWS, encoding: book });
    }
  }
  {
    const ws = sheetOf([HEADERS, ...lines(EXPECTED_ROWS)]);
    const shifted: XLSX.WorkSheet = {};
    for (const [k, v] of Object.entries(ws)) {
      if (k.startsWith('!')) continue;
      const a = XLSX.utils.decode_cell(k);
      shifted[XLSX.utils.encode_cell({ r: a.r + 3, c: a.c + 2 })] = v;
    }
    shifted['!ref'] = XLSX.utils.encode_range({ s: { r: 3, c: 2 }, e: { r: 3 + EXPECTED_ROWS.length, c: 2 + HEADERS.length - 1 } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, shifted, 'Offset');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const s = ing.parseSheet(save('offset.xlsx', bytes), 'offset.xlsx');
    eq(s.rows, EXPECTED_ROWS, 'offset.xlsx rows');
    eq(s.headerRowNumber, 4, 'offset.xlsx header row number');
    eq(s.rowNumbers, [5, 6, 7, 8, 9], 'offset.xlsx row numbers');
  }

  for (const v of variants) {
    let sheet;
    try { sheet = ing.parseSheet(save(v.name, v.bytes), v.name); } catch (e) { check(false, `${v.name} threw ${(e as Error).message}`); continue; }
    eq(sheet.headers, HEADERS, `${v.name} headers`);
    eq(sheet.rows, v.rows, `${v.name} rows`);
    eq(sheet.headerRowNumber, 1, `${v.name} header row number`);
    eq(sheet.rowNumbers, v.rows.map((_, i) => i + 2), `${v.name} row numbers`);
    if (v.encoding) eq(sheet.encoding, v.encoding, `${v.name} encoding`);
  }
  const x = ing.parseSheet(new Uint8Array(fs.readFileSync(path.join(FIX, 'students.xlsx'))), 'students.xlsx');
  check(x.rows[3]['Person Name'] === 'अनन्या शर्मा', 'Devanagari name lost in xlsx');
  check(x.rows[1]['Student ID'] === '202612345678', `numeric ID changed: ${x.rows[1]['Student ID']}`);
  check(x.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.Date)), 'dates are not YYYY-MM-DD');
  const c = ing.parseSheet(new Uint8Array(fs.readFileSync(path.join(FIX, 'cp1252-semicolon-crlf.csv'))), 'x.csv');
  check(c.rows[0]['Person Name'] === 'José Núñez', `cp1252 name decoded as ${c.rows[0]['Person Name']}`);

  let threw = '';
  try { ing.parseSheet(new TextEncoder().encode('not really excel'), 'fake.xlsx'); } catch (e) { threw = (e as Error).name; }
  eq(threw, 'ValidationError', 'fake .xlsx must throw ValidationError');
  threw = '';
  try { ing.parseSheet(new Uint8Array(0), 'empty.csv'); } catch (e) { threw = (e as Error).name; }
  eq(threw, 'ValidationError', 'empty file must throw ValidationError');
  check(new TextDecoder('utf-8').decode(variants[6].bytes).includes('�'), 'negative control: naive UTF-8 decode of cp1252 should be lossy');
  const tx = ing.parseSheet(save('text-export.xls', new TextEncoder().encode(toCsv(HEADERS, lines(EXPECTED_ROWS), '\t'))), 'text-export.xls');
  eq(tx.rows, EXPECTED_ROWS, 'tab-separated text named .xls');
  const P = (text: string, name = 'x.csv') => ing.parseSheet(new TextEncoder().encode(text), name);
  eq(P('Name;Score;Note\nAnn;89,5;a, b, c\nBob;90,5;d, e, f\n').rows, [{ Name: 'Ann', Score: '89,5', Note: 'a, b, c' }, { Name: 'Bob', Score: '90,5', Note: 'd, e, f' }], 'semicolon file with decimal commas and commas in notes (as many commas as semicolons)');
  eq(P('Name\tCity\nSmith, John\tPune\nLee, Ann\tGoa\n').rows[0], { Name: 'Smith, John', City: 'Pune' }, 'tab file with commas inside names');
  eq(P('Name,Email,Award\nAnn,a@b.co,Participation; Best UI\nBob,b@b.co,1st\n').rows[0].Award, 'Participation; Best UI', 'comma file with a semicolon list inside a cell');
  eq(P('Name,Email\n"क्\u200dष",a@b.co\n').rows[0].Name, 'क्\u200dष', 'ZWJ inside a Devanagari conjunct survives');
  eq(P('Name,Email\nمی\u200cخواهم,a@b.co\n').rows[0].Name, 'می\u200cخواهم', 'ZWNJ inside a Persian word survives');
  eq(P('Name,Email\n\u200bAnn\u200b\u00a0,a@b.co\n').rows[0].Name, 'Ann', 'zero-width space and nbsp around a name are removed');
  eq(P('Name,Email\nJose\u0301 Lee,a@b.co\n').rows[0].Name, 'José Lee', 'decomposed accents are composed (Mac exports)');
  eq(P('Name,Email\nAnn   Marie\u3000Lee ,a@b.co\n').rows[0].Name, 'Ann Marie Lee', 'runs of spaces become one');
  const sep = P('sep=;\nName;Email\nAnn;a@b.co\n');
  eq([sep.headers, sep.headerRowNumber, sep.rowNumbers], [['Name', 'Email'], 1, [2]], 'sep= line is honoured and dropped');
  eq(P('Name,Email\rAnn,a@b.co\rBob,b@b.co').rows.length, 2, 'old-Mac CR line endings');
  eq(P('Name,Email\nAnn, "a@b.co"\n').rows[0].Email, 'a@b.co', 'a space before an opening quote');
  let unclosed = '';
  try { P('Name,Email\n"Ann,a@b.co\nBob,b@b.co\n'); } catch (e) { unclosed = (e as Error).name; }
  eq(unclosed, 'ValidationError', 'an unclosed quote is reported instead of swallowing the file');
  eq(P('Name,Email,Email\nA,b@c.de,d@e.fg\n').headers, ['Name', 'Email', 'Email (2)'], 'duplicate headings');
  const mkBook = (sheets: [string, XLSX.WorkSheet][]) => {
    const wb = XLSX.utils.book_new();
    for (const [n, w] of sheets) XLSX.utils.book_append_sheet(wb, w, n);
    return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  };
  const lz: XLSX.WorkSheet = { A1: { t: 's', v: 'Name' }, B1: { t: 's', v: 'Student ID' }, A2: { t: 's', v: 'Ann' }, B2: { t: 'n', v: 123, z: '00000' }, '!ref': 'A1:B2' };
  eq(ing.parseSheet(mkBook([['S', lz]]), 'lz.xlsx').rows, [{ Name: 'Ann', 'Student ID': '00123' }], 'numeric ID shown with leading zeros keeps them');
  const mg: XLSX.WorkSheet = { A1: { t: 's', v: 'Name' }, B1: { t: 's', v: 'Award' }, A2: { t: 's', v: 'Ann' }, B2: { t: 's', v: '1st Prize' }, A3: { t: 's', v: 'Bob' }, A4: { t: 's', v: 'Cy' }, '!ref': 'A1:B4', '!merges': [XLSX.utils.decode_range('B2:B3')] };
  eq(ing.parseSheet(mkBook([['S', mg]]), 'mg.xlsx').rows.map((r) => r.Award), ['1st Prize', '1st Prize', ''], 'a merged Award cell applies to every row it spans, and no further');
  const guide = XLSX.utils.aoa_to_sheet([['How to use this file'], ['Fill in the next tab'], ['Thank you']]);
  const data = XLSX.utils.aoa_to_sheet([['Name', 'Email'], ['Ann', 'a@b.co'], ['Bob', 'b@b.co'], ['Cy', 'c@b.co']]);
  eq(ing.parseSheet(mkBook([['Instructions', guide], ['Data', data]]), 'two.xlsx').rows.length, 3, 'the data tab is chosen over an instructions tab');
  const tm: XLSX.WorkSheet = { A1: { t: 's', v: 'Name' }, B1: { t: 's', v: 'Time' }, A2: { t: 's', v: 'Ann' }, B2: { t: 'n', v: 0.5, z: 'hh:mm' }, '!ref': 'A1:B2' };
  eq(ing.parseSheet(mkBook([['S', tm]]), 'tm.xlsx').rows[0].Time, '12:00', 'a time of day is not turned into 1899-12-30');
  const ml = XLSX.utils.aoa_to_sheet([['Name', 'Email'], ['Ann', 'a@b.co']]);
  ml['!ref'] = 'A1:H1048576';
  eq(ing.parseSheet(mkBook([['S', ml]]), 'big-range.xlsx').rows.length, 1, 'a sheet whose formatting runs to the last row still parses');
  const html = ing.parseSheet(new TextEncoder().encode('<html><body><table><tr><th>Name</th><th>ID</th></tr><tr><td>Ann</td><td>00123</td></tr></table></body></html>'), 'portal.xls');
  eq(html.rows, [{ Name: 'Ann', ID: '00123' }], 'an HTML table saved with an .xls name is read');

  const nl = ing.parseCsv('a,b\r\n"line1\nline2","x ""q"""\r\n', ',');
  eq(nl, [['a', 'b'], ['line1\nline2', 'x "q"']], 'parseCsv quoted newline / doubled quotes');
  return 'INGEST PARSE OK';
}

const VHEAD = ['Person Name', 'Student ID', 'Student Email', 'Personal Email', 'Event', 'Award', 'Date'];
const VOPTS = {
  batchId: 'b-verify',
  mapping: [
    { placeholder: 'NAME', column: 'Person Name' }, { placeholder: 'ID', column: 'Student ID' }, { placeholder: 'EVENT', column: 'Event' },
    { placeholder: 'CERTIFICATE_TYPE', column: 'Award' }, { placeholder: 'DATE', column: 'Date' },
  ],
  email: { primary: 'Student Email' },
  required: ['EVENT', 'DATE'],
  awardColumns: ['Award'],
};

async function caseValidate(ing: Ingest): Promise<string> {
  const dirty = [
    ['Asha Rao', 'S001', 'asha@uni.edu', '', 'HackFest', '1st Prize', '2026-03-15'],
    ['', 'S002', 'b@uni.edu', '', 'HackFest', 'Participation', '2026-03-15'],
    ['Chen Li', 'S003', '', '', 'HackFest', 'Participation', '2026-03-15'],
    ['Dev Patel', 'S004', 'dev-at-uni.edu', '', 'HackFest', 'Participation', '2026-03-15'],
    ['Asha Rao', 'S001', 'asha@uni.edu', '', 'HackFest', '1st Prize', '2026-03-15'],
    ['Asha Rao', 'S001', 'asha@uni.edu', '', 'HackFest', 'Best UI', '2026-03-15'],
    ['Asha R.', 'S999', 'asha@uni.edu', '', 'HackFest', 'Best UI', '2026-03-15'],
    ['Eva Gomez', 'S005', 'eva@uni.edu', '', '', 'Participation', '2026-03-15'],
    ['Farah Khan', 'S006', 'farah@uni.edu', '', 'HackFest', 'Participation', ''],
    ['Asha Rao', 'S001', 'asha@uni.edu', '', 'DevSummit', '1st Prize', '2026-04-01'],
    ['Gita Iyer', 'S007', 'gita@uni.edu', '', 'HackFest', '1st Prize', '2026-03-15'],
    ['Gita Iyer', 'S007', 'gita@uni.edu', '', 'HackFest', 'First Prize', '2026-03-15'],
    ['', '', '', '', '', '', ''],
    ['Hiro Sato', 'S008', 'hiro @uni.edu', '', 'HackFest', 'Participation', '2026-03-15'],
    ['', 'S009', '', '', 'HackFest', 'Participation', '2026-03-15'],
    ['Asha Rao', 's 001', 'asha@uni.edu', '', 'HackFest', '1st Prize', '2026-03-15'],
  ];
  const EXPECTED: [number, string, 'error' | 'warning'][] = [
    [3, 'MISSING_NAME', 'error'], [4, 'MISSING_EMAIL', 'error'], [5, 'INVALID_EMAIL', 'error'], [6, 'DUPLICATE_RECORD', 'error'],
    [8, 'DUPLICATE_RECORD', 'warning'], [9, 'MISSING_REQUIRED', 'error'], [10, 'MISSING_REQUIRED', 'error'],
    [13, 'DUPLICATE_RECORD', 'error'], [15, 'INVALID_EMAIL', 'error'], [16, 'MISSING_EMAIL', 'error'], [16, 'MISSING_NAME', 'error'],
    [17, 'DUPLICATE_RECORD', 'error'],
  ];
  const csv = toCsv(VHEAD, dirty).replace(/\n,,,,,,\n/, '\n\n');
  const sheet = ing.parseSheet(save('dirty.csv', new TextEncoder().encode(csv)), 'dirty.csv');
  eq(sheet.rowNumbers, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17], 'dirty row numbers (blank row 14 skipped)');
  const res = ing.validateSheet(sheet, VOPTS);
  const got = res.issues.map((i) => [i.row, i.code, i.severity] as [number, string, string])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  eq(got, EXPECTED, 'dirty fixture issues (row, code, severity)');
  eq(res.invalid.map((i) => i.rowNumber), [3, 4, 5, 6, 9, 10, 13, 15, 16, 17], 'invalid rows');
  eq(res.valid.map((r) => r.rowNumber), [2, 7, 8, 11, 12], 'valid rows');
  const byRow = new Map(res.valid.map((r) => [r.rowNumber, r]));
  check(byRow.get(2)?.personKey === byRow.get(7)?.personKey, 'one person with two different awards must share a personKey');
  check(byRow.get(2)?.recordId !== byRow.get(7)?.recordId, 'two rows must get two recordIds');
  check(res.issues.find((i) => i.row === 9)?.column === 'Event', 'row 9 issue should point at the Event column');
  check(res.issues.find((i) => i.row === 6)?.message.includes('row 2') ?? false, 'duplicate message should name the first row');
  check(byRow.get(2)?.values.NAME === 'Asha Rao' && byRow.get(2)?.values.CERTIFICATE_TYPE === '1st Prize', 'mapped values missing');

  const multi = [
    ['Quinn', 'Q1', 'q@uni.edu', '', 'HackFest', 'Participation; Best UI', '2026-03-15'],
    ['Quinn', 'Q1', 'q@uni.edu', '', 'HackFest', 'best ui;participation', '2026-03-15'],
    ['Quinn', 'Q1', 'q@uni.edu', '', 'HackFest', 'Participation', '2026-03-15'],
  ];
  const mr = ing.validateSheet(ing.parseSheet(new TextEncoder().encode(toCsv(VHEAD, multi)), 'm.csv'), { ...VOPTS, mapping: VOPTS.mapping.map((m) => ({ ...m, column: m.column.toUpperCase() })), email: { primary: 'student  EMAIL' }, awardColumns: ['AWARD'] });
  eq(mr.issues.map((i) => [i.row, i.code]), [[3, 'DUPLICATE_RECORD']], 'same set of awards twice is a duplicate; headings matched ignoring case/spacing');

  const awards = ['1st Prize', '2nd Prize', 'Hon. Mention', 'Best UI', 'Participation'];
  const clean = Array.from({ length: 24 }, (_, i) => [
    i === 4 ? 'अनन्या शर्मा' : i === 9 ? 'José Núñez' : `Student ${i + 1}`, `S${100 + i}`, `s${i}@uni.edu`, '', 'HackFest', awards[i % 5], '2026-03-15',
  ]);
  clean.push(['Student 1', 'S100', 's0@uni.edu', '', 'HackFest', 'Best Pitch', '2026-03-15']);
  const cs = ing.parseSheet(save('clean.csv', new TextEncoder().encode(toCsv(VHEAD, clean))), 'clean.csv');
  eq(cs.rows.length, 25, 'clean fixture has 25 rows');
  const cr = ing.validateSheet(cs, VOPTS);
  eq(cr.issues, [], 'clean fixture issues');
  eq(cr.valid.length, 25, 'clean fixture valid count');
  const broken = clean.map((r) => [...r]);
  broken[10][2] = 'nobody';
  const br = ing.validateSheet(ing.parseSheet(new TextEncoder().encode(toCsv(VHEAD, broken)), 'b.csv'), VOPTS);
  eq(br.issues.map((i) => [i.row, i.code]), [[12, 'INVALID_EMAIL']], 'clean fixture with one broken email');
  return 'INGEST VALIDATE OK';
}

async function caseEmailSelect(ing: Ingest): Promise<string> {
  const rows = [
    ['Ann', 'S1', 'ann@uni.edu', 'ann@gmail.com', 'HackFest', 'P', '2026-03-15'],
    ['Ben', 'S2', '', 'ben@gmail.com', 'HackFest', 'P', '2026-03-15'],
    ['Cat', 'S3', 'cat(at)uni', 'cat@gmail.com', 'HackFest', 'P', '2026-03-15'],
    ['Dan', 'S4', '', '', 'HackFest', 'P', '2026-03-15'],
    ['Eve', 'S5', '', 'eve@@gmail', 'HackFest', 'P', '2026-03-15'],
    ['Fay', 'S6', ' mailto:Fay@Uni.edu ', '', 'HackFest', 'P', '2026-03-15'],
    ['Gus', 'S7', 'Gus Ho <gus@uni.edu>', 'gus@gmail.com', 'HackFest', 'P', '2026-03-15'],
  ];
  const sheet = ing.parseSheet(save('emails.csv', new TextEncoder().encode(toCsv(VHEAD, rows))), 'emails.csv');
  const issuesOf = (r: ReturnType<Ingest['validateSheet']>) => r.issues.map((i) => [i.row, i.code, i.severity, i.column ?? null]);

  const withFb = ing.validateSheet(sheet, { ...VOPTS, email: { primary: 'Student Email', fallback: 'Personal Email' } });
  const sel = (r: ReturnType<Ingest['validateSheet']>) => Object.fromEntries(r.valid.map((v) => [v.rowNumber, [v.email, v.emailSource]]));
  eq(sel(withFb), {
    2: ['ann@uni.edu', 'primary'], 3: ['ben@gmail.com', 'fallback'], 4: ['cat@gmail.com', 'fallback'],
    7: ['Fay@Uni.edu', 'primary'], 8: ['gus@uni.edu', 'primary'],
  }, 'email selection with fallback');
  eq(issuesOf(withFb), [
    [3, 'FALLBACK_USED', 'warning', 'Personal Email'], [4, 'FALLBACK_USED', 'warning', 'Personal Email'],
    [5, 'MISSING_EMAIL', 'error', 'Student Email'], [6, 'INVALID_EMAIL', 'error', 'Personal Email'],
  ], 'issues with fallback');

  const noFb = ing.validateSheet(sheet, VOPTS);
  eq(sel(noFb), { 2: ['ann@uni.edu', 'primary'], 7: ['Fay@Uni.edu', 'primary'], 8: ['gus@uni.edu', 'primary'] }, 'email selection without fallback');
  eq(issuesOf(noFb), [
    [3, 'MISSING_EMAIL', 'error', 'Student Email'], [4, 'INVALID_EMAIL', 'error', 'Student Email'],
    [5, 'MISSING_EMAIL', 'error', 'Student Email'], [6, 'MISSING_EMAIL', 'error', 'Student Email'],
  ], 'issues without fallback');
  check(!noFb.issues.some((i) => i.code === 'FALLBACK_USED'), 'FALLBACK_USED without a configured fallback');
  check(noFb.valid.every((v) => v.emailSource === 'primary'), 'fallback used without being configured');

  for (const ok of ['a@b.co', 'first.last+tag@sub.uni.edu', "o'neil@x.org"]) check(ing.isValidEmail(ok), `${ok} should be valid`);
  for (const bad of ['', 'a@b', 'a@@b.com', 'a b@c.com', '.a@b.com', 'a..b@c.com', 'a@b.c', 'a@-b.com']) check(!ing.isValidEmail(bad), `${bad} should be invalid`);
  return 'INGEST EMAIL SELECT OK';
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function caseAutomap(ing: Ingest): Promise<string> {
  const head = ['Person Name', 'Roll No', 'College Email', 'Personal Email', 'Event Name', 'Award', 'Achievement', 'Date of Issue'];
  const data = [
    ['Asha Rao', 'R1', 'asha@uni.edu', 'asha@gmail.com', 'HackFest', '1st Prize', 'Winning build', '2026-03-15'],
    ['José Núñez', 'R2', 'jose@uni.edu', '', 'HackFest', 'Participation', 'Taking part', '2026-03-15'],
    ['अनन्या शर्मा', 'R3', 'ananya@uni.edu', '', 'HackFest', 'Best UI', 'Beautiful UI', '2026-03-15'],
  ];
  const EXPECTED: Record<string, string> = {
    NAME: 'Person Name', ID: 'Roll No', EMAIL: 'College Email', PERSONAL_EMAIL: 'Personal Email', EVENT: 'Event Name',
    CERTIFICATE_TYPE: 'Award', ACHIEVEMENT: 'Achievement', DATE: 'Date of Issue',
  };
  const titles = [['Annual HackFest 2026 — Certificates'], ['Prepared by the organizing team', '', '', 'March 2026']];
  const orders = [head.map((_, i) => i), [...head.keys()].reverse(), ...[1, 2, 3, 4, 5].map((s) => seededShuffle([...head.keys()], s))];
  eq(new Set(orders.map((o) => o.join(','))).size, orders.length, 'shuffles are distinct');
  const base = { suggestions: null as unknown, rows: null as unknown };
  orders.forEach((order, k) => {
    const h = order.map((i) => head[i]);
    const d = data.map((r) => order.map((i) => r[i]));
    const xb = workbook([...titles, h, ...d], 'xlsx');
    const cb = new TextEncoder().encode(toCsv(['Annual HackFest 2026'], [[''], h, ...d]).replace(/^Annual HackFest 2026\n\n/, 'Annual HackFest 2026\nPrepared by the team,,,March 2026\n'));
    for (const [name, bytes] of [[`shuffled-${k}.xlsx`, xb], [`shuffled-${k}.csv`, cb]] as const) {
      const s = ing.parseSheet(save(name, bytes), name);
      eq(s.headerRowNumber, 3, `${name} header row below 2 title rows`);
      eq(s.headers, h, `${name} headers in file order`);
      eq(s.rowNumbers, [4, 5, 6], `${name} row numbers`);
      const sugg = ing.suggestMappings(s.headers);
      const asMap = Object.fromEntries(sugg.map((m) => [m.placeholder, m.column]));
      eq(asMap, EXPECTED, `${name} suggested mapping`);
      check(sugg.every((m) => !m.ambiguous), `${name} nothing ambiguous`);
      const byHeading = s.rows.map((r) => head.map((x) => r[x]));
      if (base.suggestions === null) { base.suggestions = sugg; base.rows = byHeading; }
      eq(sugg, base.suggestions, `${name} suggestMappings identical to the ordered sheet`);
      eq(byHeading, base.rows, `${name} row values by heading identical to the ordered sheet`);
    }
  });
  const emailPositions = new Set(orders.map((o) => o.indexOf(2)));
  check(emailPositions.size >= 3, 'shuffles did not move the email column');
  const amb = ing.suggestMappings(['Name', 'Email Address', 'E-mail ID'], ['NAME', 'EMAIL']);
  check(amb[0].column === 'Name', 'NAME should map with two email columns present');
  check(amb[1].ambiguous && amb[1].column === null && amb[1].candidates.length === 2, `two email columns should be ambiguous: ${JSON.stringify(amb[1])}`);
  return 'INGEST AUTOMAP OK';
}

async function caseTyped(ing: Ingest): Promise<string> {
  const headers = ['Student ID', 'Person Name', 'Student Email', 'Personal Email', 'Event', 'Award', 'Date'];
  for (const typed of ['person name', 'Person  Name', 'persn name', 'Participant', ' PERSON-NAME ', 'Full name']) {
    const m = ing.matchTypedHeading(typed, headers, 'NAME');
    check(m.column === 'Person Name' && !m.ambiguous, `typed "${typed}" -> ${JSON.stringify(m)}`);
  }
  const hi = ['क्रमांक', 'नाम', 'ईमेल'];
  const hm = ing.matchTypedHeading('नाम', hi, 'NAME');
  check(hm.column === 'नाम' && hm.confidence === 1, `Devanagari heading: ${JSON.stringify(hm)}`);
  const hm2 = ing.matchTypedHeading('नमक', ['नाम'], 'NAME');
  check(hm2.column === null || hm2.confidence < 1, 'a different Devanagari word does not match exactly');
  const amb = ing.matchTypedHeading('email', headers, 'EMAIL');
  check(amb.ambiguous === true && amb.column === null, `"email" should be ambiguous: ${JSON.stringify(amb)}`);
  check(amb.candidates.includes('Student Email') && amb.candidates.includes('Personal Email'), `ambiguous candidates: ${amb.candidates}`);
  const exact = ing.matchTypedHeading('Student Email', headers, 'EMAIL');
  check(exact.column === 'Student Email' && exact.confidence === 1 && !exact.ambiguous, `exact control: ${JSON.stringify(exact)}`);
  const none = ing.matchTypedHeading('Favourite colour', headers, 'X');
  check(none.column === null && !none.ambiguous, `unrelated heading should not match: ${JSON.stringify(none)}`);

  const typedMap: Record<string, string> = { NAME: 'persn name', ID: 'Student ID', EMAIL: 'Student Email', PERSONAL_EMAIL: 'Personal Email', EVENT: 'event', DATE: 'Date' };
  const confirmed = Object.entries(typedMap).map(([ph, t]) => ing.matchTypedHeading(t, headers, ph));
  const profile = ing.makeProfile('p1', 'HackFest layout', confirmed);
  eq(profile.matches, { NAME: 'Person Name', ID: 'Student ID', EMAIL: 'Student Email', PERSONAL_EMAIL: 'Personal Email', EVENT: 'Event', DATE: 'Date' }, 'profile contents');
  const file = path.join(tmp, 'profile.json');
  fs.writeFileSync(file, JSON.stringify(profile));
  const reloaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(reloaded, profile, 'profile JSON round-trip');
  const reordered = ['Date', 'Award', 'Personal Email', 'Event', 'Student Email', 'Person Name', 'Student ID'];
  const xb = workbook([reordered, ['2026-03-15', 'P', 'a@gmail.com', 'HackFest', 'a@uni.edu', 'Asha', 'S1']], 'xlsx');
  const s = ing.parseSheet(save('profile-reordered.xlsx', xb), 'profile-reordered.xlsx');
  const applied = ing.applyProfile(reloaded, s.headers);
  eq(Object.fromEntries(applied.map((m) => [m.placeholder, m.column])), profile.matches, 'profile applied to reordered sheet');
  check(applied.every((m) => m.confidence === 1 && !m.ambiguous), 'profile matches should be exact');
  const missing = ing.applyProfile(reloaded, ['Person Name', 'Student Email', 'Event']);
  const mm = Object.fromEntries(missing.map((m) => [m.placeholder, m.column]));
  check(mm.PERSONAL_EMAIL === null && mm.ID === null && mm.DATE === null, `missing columns should be null: ${JSON.stringify(mm)}`);
  check(mm.NAME === 'Person Name' && mm.EMAIL === 'Student Email', 'present columns still match');
  return 'INGEST TYPED HEADINGS OK';
}

async function casePerf(ing: Ingest): Promise<string> {
  const N = 10_000;
  const aoa: XCell[][] = [VHEAD];
  for (let i = 0; i < N; i++) {
    aoa.push([`Student ${i} Núñez`, `S${100000 + i}`, `s${i}@uni.edu`, i % 3 ? '' : `p${i}@gmail.com`, 'HackFest 2026', ['1st Prize', 'Participation', 'Best UI'][i % 3], { date: [2026, 3, 15], fmt: 'yyyy-mm-dd' }]);
  }
  const bytes = save('perf-10k.xlsx', workbook(aoa, 'xlsx'));
  const t0 = performance.now();
  const sheet = ing.parseSheet(bytes, 'perf-10k.xlsx');
  const t1 = performance.now();
  const res = ing.validateSheet(sheet, { ...VOPTS, email: { primary: 'Student Email', fallback: 'Personal Email' } });
  const t2 = performance.now();
  console.log(`parse ${(t1 - t0).toFixed(0)} ms, validate ${(t2 - t1).toFixed(0)} ms, total ${(t2 - t0).toFixed(0)} ms`);
  eq(sheet.rows.length, N, 'perf row count');
  eq(res.valid.length, N, 'perf valid count');
  eq(res.issues.length, 0, 'perf issues');
  eq(sheet.rows[5000], { 'Person Name': 'Student 5000 Núñez', 'Student ID': 'S105000', 'Student Email': 's5000@uni.edu', 'Personal Email': '', Event: 'HackFest 2026', Award: 'Best UI', Date: '2026-03-15' }, 'perf row 5000');
  check(t2 - t0 < 3000, `parse+validate took ${(t2 - t0).toFixed(0)} ms (budget 3000 ms)`);
  return 'INGEST PERF OK';
}

const CASES: Record<string, (i: Ingest) => Promise<string>> = {
  parse: caseParse, validate: caseValidate, 'email-select': caseEmailSelect, automap: caseAutomap, perf: casePerf, 'typed-headings': caseTyped,
};

async function main(): Promise<void> {
  const idx = process.argv.indexOf('--case');
  const name = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!name || !CASES[name]) { console.error(`usage: --case ${Object.keys(CASES).join('|')}`); process.exit(2); }
  const ing = await import('../../src/lib/ingest');
  const token = await CASES[name](ing);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures) { console.error(`${failures} assertion(s) failed in case ${name}`); process.exit(1); }
  console.log(token);
}

main().catch((e) => { console.error(`FAIL: ${(e as Error).stack ?? e}`); process.exit(1); });
