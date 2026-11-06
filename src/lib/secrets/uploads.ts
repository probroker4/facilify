import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, nowIso, run, type DB } from '@/lib/db/db';
import { dataDir } from '@/lib/paths';

export type UploadKind = 'sheet' | 'template' | 'font';

export const UPLOAD_LIMITS: Record<UploadKind, number> = { sheet: 15 * 1024 * 1024, template: 20 * 1024 * 1024, font: 10 * 1024 * 1024 };

export class UploadError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'UploadError'; }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const BINARY_SIGNATURES: number[][] = [
  [0x25, 0x50, 0x44, 0x46],
  [0x89, 0x50, 0x4e, 0x47],
  [0xff, 0xd8, 0xff],
  [0x47, 0x49, 0x46, 0x38],
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xcf, 0xfa, 0xed, 0xfe], [0xfe, 0xed, 0xfa, 0xce], [0xca, 0xfe, 0xba, 0xbe],
  [0x1f, 0x8b],
  [0x52, 0x61, 0x72, 0x21],
  [0x37, 0x7a, 0xbc, 0xaf],
  [0x42, 0x5a, 0x68],
  [0x00, 0x01, 0x00, 0x00], [0x4f, 0x54, 0x54, 0x4f],
  [0x52, 0x49, 0x46, 0x46],
];

function startsWith(b: Uint8Array, sig: number[]): boolean {
  return sig.every((v, i) => b[i] === v);
}

function looksLikeText8(b: Uint8Array): boolean {
  const head = b.subarray(0, 8192);
  if (!head.length) return false;
  let control = 0;
  for (const c of head) {
    if (c === 0) return false;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c) control++;
  }
  return control / head.length < 0.02;
}

function looksLikeUtf16NoBom(b: Uint8Array): boolean {
  const head = b.subarray(0, 4096 - (b.length % 2 === 0 ? 0 : 1));
  if (head.length < 4) return false;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i + 1 < head.length; i += 2) {
    if (head[i] === 0) evenZero++;
    if (head[i + 1] === 0) oddZero++;
  }
  const pairs = Math.floor(head.length / 2);
  const hi = Math.max(evenZero, oddZero);
  const lo = Math.min(evenZero, oddZero);
  return hi / pairs > 0.6 && lo / pairs < 0.05;
}

function zipHasEntry(b: Uint8Array, name: string): boolean {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes(Buffer.from(name, 'latin1'));
}

export function sniffMime(kind: UploadKind, b: Uint8Array): string | null {
  const starts = (...sig: number[]) => startsWith(b, sig);
  if (kind === 'sheet') {
    if (starts(0x50, 0x4b, 0x03, 0x04)) return zipHasEntry(b, 'xl/workbook.xml') ? XLSX_MIME : null;
    if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'application/vnd.ms-excel';
    if (starts(0xff, 0xfe) || starts(0xfe, 0xff)) return b.length > 2 ? 'text/csv' : null;
    if (BINARY_SIGNATURES.some((s) => startsWith(b, s)) || starts(0x50, 0x4b)) return null;
    if (looksLikeText8(b) || looksLikeUtf16NoBom(b)) return 'text/csv';
    return null;
  }
  if (kind === 'template') {
    if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    return null;
  }
  if (starts(0x00, 0x01, 0x00, 0x00) || starts(0x74, 0x72, 0x75, 0x65)) return 'font/ttf';
  if (starts(0x4f, 0x54, 0x54, 0x4f)) return 'font/otf';
  return null;
}

export function checkFileName(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(name) || name.includes('..') || /%(2e|2f|5c)/i.test(name)) {
    throw new UploadError('That file name is not allowed. Rename the file (letters, numbers, spaces) and try again.');
  }
  return name;
}

function uploadsRoot(): string {
  const d = path.join(dataDir(), 'uploads');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(d, 0o700); } catch {  }
  return d;
}

export function uploadPath(id: string): string {
  if (typeof id !== 'string' || !/^up_[A-Za-z0-9_-]{1,64}$/.test(id)) throw new UploadError('Bad upload id', 400);
  const root = uploadsRoot();
  const p = path.join(root, id);
  if (path.dirname(p) !== root) throw new UploadError('Bad upload id', 400);
  return p;
}

export function saveUpload(db: DB, organizerId: string, kind: UploadKind, originalName: string, bytes: Uint8Array): { id: string; mime: string } {
  if (!(kind in UPLOAD_LIMITS)) throw new UploadError('Unknown upload type.');
  checkFileName(originalName);
  if (bytes.length === 0) throw new UploadError('The file is empty.');
  if (bytes.length > UPLOAD_LIMITS[kind]) throw new UploadError(`The file is too large (max ${Math.round(UPLOAD_LIMITS[kind] / 1024 / 1024)} MB).`, 413);
  const mime = sniffMime(kind, bytes);
  if (!mime) {
    throw new UploadError(kind === 'sheet' ? 'Please upload an Excel (.xlsx, .xls) or CSV file.'
      : kind === 'template' ? 'Please upload a PDF, PNG or JPG certificate design.' : 'Please upload a .ttf or .otf font file.', 415);
  }
  const id = `up_${crypto.randomBytes(16).toString('base64url')}`;
  const file = uploadPath(id);
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
  try {
    run(db, 'INSERT INTO uploads (id, organizer_id, kind, original_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, organizerId, kind, originalName, mime, bytes.length, nowIso());
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
  return { id, mime };
}

export function readUpload(db: DB, organizerId: string, id: string): { bytes: Uint8Array; mime: string; name: string; kind: UploadKind } {
  const row = get<{ mime: string; original_name: string; kind: UploadKind }>(db, 'SELECT mime, original_name, kind FROM uploads WHERE id = ? AND organizer_id = ?', id, organizerId);
  if (!row) throw new UploadError('File not found.', 404);
  try {
    return { bytes: new Uint8Array(fs.readFileSync(uploadPath(id))), mime: row.mime, name: row.original_name, kind: row.kind };
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError('File not found.', 404);
  }
}

export function removeUpload(db: DB, organizerId: string, id: string) {
  const row = get<{ id: string }>(db, 'SELECT id FROM uploads WHERE id = ? AND organizer_id = ?', id, organizerId);
  if (!row) return;
  fs.rmSync(uploadPath(id), { force: true });
  run(db, 'DELETE FROM uploads WHERE id = ?', id);
}
