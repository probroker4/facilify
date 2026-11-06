import * as XLSX from 'xlsx';
import type { ParsedSheet, RawRow } from '@/lib/contracts';
import { ValidationError } from '@/lib/contracts';
import { normKey } from '@/lib/routing/norm';
import { SYNONYMS } from './headers';

export function parseSheet(bytes: Uint8Array, fileName: string): ParsedSheet {
  const kind = detectKind(bytes, fileName);
  if (kind === 'csv' || kind === 'text-xls') {
    const decoded = decodeText(bytes);
    let text = decoded.text;
    let delim: string | null = null;
    const hint = /^sep=(.)[ \t]*(?:\r\n|\n|\r|$)/i.exec(text);
    if (hint) { delim = hint[1]; text = text.slice(hint[0].length); }
    return gridToSheet(parseCsv(text, delim ?? detectDelimiter(text)), fileName, decoded.encoding);
  }
  let grids: string[][][];
  let encoding: string = kind;
  if (kind === 'html-xls') {
    const decoded = decodeText(bytes);
    encoding = `html-${decoded.encoding}`;
    grids = readWorkbookGrids(decoded.text, 'string');
  } else {
    grids = readWorkbookGrids(bytes, 'array');
  }
  let best: { sheet: ParsedSheet; score: number } | null = null;
  let firstError: unknown = null;
  for (const grid of grids) {
    try {
      const sheet = gridToSheet(grid, fileName, encoding);
      const known = sheet.headers.filter((h) => KNOWN_HEADINGS.has(normKey(h))).length;
      const score = known * 1_000_000 + sheet.rows.length;
      if (!best || score > best.score) best = { sheet, score };
    } catch (e) { firstError ??= e; }
  }
  if (!best) throw firstError ?? new ValidationError('The Excel file has no data in any sheet.');
  return best.sheet;
}

function detectKind(bytes: Uint8Array, fileName: string): 'csv' | 'xlsx' | 'xls' | 'text-xls' | 'html-xls' {
  if (bytes.length === 0) throw new ValidationError(`"${fileName}" is empty.`);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls';
  const lower = fileName.toLowerCase();
  if (/\.(xls|xlsx|html?)$/.test(lower) && looksLikeHtml(bytes)) return 'html-xls';
  if (lower.endsWith('.xls') && looksLikeText(bytes)) return 'text-xls';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    throw new ValidationError(`"${fileName}" does not look like a real Excel file. Try saving it again from Excel, or export it as CSV.`);
  }
  return 'csv';
}

function asciiHead(bytes: Uint8Array, n: number): string {
  let out = '';
  const end = Math.min(bytes.length, n);
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = asciiHead(bytes, 512).replace(/^[\s\u00ef\u00bb\u00bf]+/, '');
  return /^<(?:!doctype|html|table|\?xml|meta|head|body)/i.test(head) && /<table/i.test(asciiHead(bytes, 65536));
}

function looksLikeText(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0 || (b < 0x09) || (b > 0x0d && b < 0x20 && b !== 0x1b)) return false;
  }
  return !/^\s*</.test(asciiHead(bytes, 64));
}

function sniffUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length - (bytes.length % 2), 400);
  if (n < 4) return null;
  let evenZero = 0, oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++;
    if (bytes[i + 1] === 0) oddZero++;
  }
  const pairs = n / 2;
  if (oddZero > pairs * 0.4 && evenZero < pairs * 0.05) return 'utf-16le';
  if (evenZero > pairs * 0.4 && oddZero < pairs * 0.05) return 'utf-16be';
  return null;
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  const u16 = sniffUtf16(bytes);
  if (u16) return { text: new TextDecoder(u16).decode(bytes), encoding: u16 };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: decodeCp1252(bytes), encoding: 'windows-1252' };
  }
}

const CP1252_HIGH = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
export function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  }
  return out;
}

function detectDelimiter(text: string): string {
  const delims = [',', ';', '\t'];
  const perLine: number[][] = delims.map(() => [0]);
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 30; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (inQuotes) continue;
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines++;
      perLine.forEach((l) => l.push(0));
      continue;
    }
    const d = delims.indexOf(ch);
    if (d >= 0) perLine[d][perLine[d].length - 1]++;
  }
  let best = ',';
  let bestScore = 0;
  delims.forEach((d, k) => {
    const counts = perLine[k].filter((n) => n > 0);
    if (!counts.length) return;
    const freq = new Map<number, number>();
    for (const n of counts) freq.set(n, (freq.get(n) ?? 0) + 1);
    let mode = 0, consistent = 0;
    for (const [n, f] of freq) if (f > consistent || (f === consistent && n > mode)) { mode = n; consistent = f; }
    const score = consistent * 1000 + mode;
    if (score > bestScore) { best = d; bestScore = score; }
  });
  return best;
}

export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === '') { inQuotes = true; field = ''; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (inQuotes) {
    throw new ValidationError(`A quotation mark opened in row ${rows.length + 1} is never closed, so the rest of the file would be swallowed into one cell. Check that row, or re-export the file as CSV.`);
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readWorkbookGrids(input: Uint8Array | string, type: 'array' | 'string'): string[][][] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(input, { type, cellDates: false, cellNF: true, cellHTML: false, cellFormula: false, raw: type === 'string' });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/password|encrypt/i.test(msg)) {
      throw new ValidationError('This Excel file is password-protected. Open it in Excel, remove the password (File > Info > Protect Workbook), save it, and upload it again.');
    }
    throw new ValidationError(`Could not read this Excel file (${msg}). Try saving it again from Excel, or export it as CSV.`);
  }
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const hidden = new Set<string>();
  (wb.Workbook?.Sheets ?? []).forEach((s, i) => { if (s.Hidden) hidden.add(wb.SheetNames[i]); });
  const names = [...wb.SheetNames.filter((n) => !hidden.has(n)), ...wb.SheetNames.filter((n) => hidden.has(n))];
  const grids: string[][][] = [];
  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const cells: { r: number; c: number; text: string }[] = [];
    let minC = Infinity, maxC = -1, maxR = -1;
    for (const key of Object.keys(ws)) {
      if (key.charCodeAt(0) === 33 ) continue;
      const text = cellText(ws[key] as XLSX.CellObject, date1904);
      if (text === '') continue;
      const a = XLSX.utils.decode_cell(key);
      cells.push({ r: a.r, c: a.c, text });
      if (a.c < minC) minC = a.c;
      if (a.c > maxC) maxC = a.c;
      if (a.r > maxR) maxR = a.r;
    }
    if (!cells.length) continue;
    const width = maxC - minC + 1;
    const grid: string[][] = Array.from({ length: maxR + 1 }, () => new Array<string>(width).fill(''));
    for (const { r, c, text } of cells) grid[r][c - minC] = text;
    for (const m of ws['!merges'] ?? []) {
      if (m.e.r <= m.s.r || m.s.r > maxR) continue;
      const v = grid[m.s.r]?.[m.s.c - minC];
      if (!v) continue;
      for (let r = m.s.r; r <= Math.min(m.e.r, maxR); r++) {
        for (let c = m.s.c; c <= m.e.c; c++) if (c >= minC && c <= maxC && grid[r][c - minC] === '') grid[r][c - minC] = v;
      }
    }
    grids.push(grid);
  }
  if (!grids.length) throw new ValidationError('The Excel file has no data in any sheet.');
  return grids;
}

function cellText(cell: XLSX.CellObject | undefined, date1904: boolean): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n') {
    const v = cell.v as number;
    const fmt = typeof cell.z === 'string' ? cell.z : '';
    const shown = typeof cell.w === 'string' ? cell.w.trim() : '';
    if (fmt && XLSX.SSF.is_date(fmt)) {
      if (v >= 0 && v < 1) return shown || String(v);
      const d = XLSX.SSF.parse_date_code(v, { date1904 });
      if (d) return `${String(d.y).padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    if (Number.isInteger(v)) {
      if (/^0\d+$/.test(shown) && Number(shown) === v) return shown;
      return String(v);
    }
    return shown && !/,/.test(shown) ? shown : String(v);
  }
  if (cell.t === 'd') {
    const d = cell.v as Date;
    return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'e') return '';
  return String(cell.v);
}

const KNOWN_HEADINGS = new Set(Object.values(SYNONYMS).flat().map(normKey));
const INVISIBLE = /[\u200b\u2060\ufeff\u00ad]/g;
const EDGE_INVISIBLE = /^[\s\u200b-\u200f\u2060\ufeff]+|[\s\u200b-\u200f\u2060\ufeff]+$/g;
const SPACE_RUN = /[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g;
export function cleanCell(v: string | undefined): string {
  if (!v) return '';
  return v.replace(INVISIBLE, '').replace(EDGE_INVISIBLE, '').replace(SPACE_RUN, ' ').normalize('NFC');
}

function gridToSheet(grid: string[][], sourceName: string, encoding: string): ParsedSheet {
  const cleaned = grid.map((r) => r.map(cleanCell));
  let width = 0;
  for (const r of cleaned) {
    let n = 0;
    for (const v of r) if (v) n++;
    if (n > width) width = n;
  }
  if (width === 0) throw new ValidationError('The file is empty.');
  let firstCandidate = -1;
  let headerIdx = -1;
  for (let i = 0; i < Math.min(cleaned.length, 25); i++) {
    const filled = cleaned[i].filter(Boolean);
    if (filled.length < Math.max(width === 1 ? 1 : 2, Math.ceil(width * 0.6))) continue;
    const distinct = new Set(filled.map((v) => v.toLowerCase())).size === filled.length;
    const textual = filled.filter((v) => !/^[\d.,\-\/: ]+$/.test(v)).length >= Math.ceil(filled.length * 0.75);
    if (!textual) continue;
    if (filled.some((v) => KNOWN_HEADINGS.has(normKey(v)))) { headerIdx = i; break; }
    if (distinct && firstCandidate < 0) firstCandidate = i;
  }
  if (headerIdx < 0) headerIdx = firstCandidate;
  if (headerIdx < 0) throw new ValidationError('Could not find a heading row. Make sure the first row of your table has column names like "Name" and "Email".');
  const rawHeaders = cleaned[headerIdx];
  let maxCols = rawHeaders.length;
  for (let i = headerIdx + 1; i < cleaned.length; i++) if (cleaned[i].length > maxCols) maxCols = cleaned[i].length;
  let lastCol = maxCols - 1;
  while (lastCol >= 0 && !rawHeaders[lastCol] && !cleaned.slice(headerIdx + 1).some((r) => r[lastCol])) lastCol--;
  const used = new Set<string>();
  const headers: string[] = [];
  for (let c = 0; c <= lastCol; c++) {
    const base = rawHeaders[c] || `Column ${c + 1}`;
    let h = base;
    for (let n = 2; used.has(h.toLowerCase()); n++) h = `${base} (${n})`;
    used.add(h.toLowerCase());
    headers.push(h);
  }
  const rows: RawRow[] = [];
  const rowNumbers: number[] = [];
  for (let i = headerIdx + 1; i < cleaned.length; i++) {
    const line = cleaned[i];
    if (!line.some(Boolean)) continue;
    const row: RawRow = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = line[c] ?? '';
    rows.push(row);
    rowNumbers.push(i + 1);
  }
  return { headers, rows, sourceName, encoding, headerRowNumber: headerIdx + 1, rowNumbers };
}
