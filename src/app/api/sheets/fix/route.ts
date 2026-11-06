import { removeUpload, readUpload, saveUpload } from '@/lib/secrets/uploads';
import { parseSheet } from '@/lib/ingest/parse';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

const FIXED = ' (corrected).csv';

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; edits?: { rowNumber: number; column: string; value: string }[] }>(req);
  if (typeof body.uploadId !== 'string') throw badRequest('Please upload your student sheet first.');
  if (!Array.isArray(body.edits) || !body.edits.length || body.edits.length > 5000) throw badRequest('There is nothing to save.');
  const up = readUpload(db, org.id, body.uploadId);
  if (up.kind !== 'sheet') throw badRequest('That upload is not a student sheet.');
  const sheet = parseSheet(up.bytes, up.name);
  const index = new Map(sheet.rowNumbers.map((n, i) => [n, i]));
  for (const e of body.edits) {
    const i = index.get(Number(e.rowNumber));
    if (i === undefined) throw badRequest(`Row ${e.rowNumber} is not in the sheet.`);
    if (!sheet.headers.includes(e.column)) throw badRequest(`There is no column called "${e.column}".`);
    sheet.rows[i][e.column] = String(e.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  const lines: string[] = [];
  const at = (n: number, text: string) => { while (lines.length < n - 1) lines.push(''); lines[n - 1] = text; };
  at(sheet.headerRowNumber, sheet.headers.map(cell).join(','));
  sheet.rows.forEach((row, i) => at(sheet.rowNumbers[i], sheet.headers.map((h) => cell(row[h] ?? '')).join(',')));
  const base = up.name.replace(/ \(corrected\)\.csv$/i, '').replace(/\.[A-Za-z0-9]+$/, '');
  const saved = saveUpload(db, org.id, 'sheet', `${base}${FIXED}`, new TextEncoder().encode(`﻿${lines.join('\r\n')}\r\n`));
  if (up.name.endsWith(FIXED)) removeUpload(db, org.id, body.uploadId);
  return { ok: true, uploadId: saved.id, id: saved.id, name: `${base}${FIXED}` };
});
