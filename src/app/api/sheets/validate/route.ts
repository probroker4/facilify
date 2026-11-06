import type { EmailSelection, FieldMapping } from '@/lib/contracts';
import { validateSheet } from '@/lib/ingest/validate';
import { loadSheet } from '../../_draft';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

interface Body {
  uploadId?: string;
  mapping?: FieldMapping[];
  email?: EmailSelection;
  required?: string[];
  awardColumns?: string[];
  skipRows?: number[];
}

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<Body>(req);
  if (!Array.isArray(body.mapping)) throw badRequest('Match your columns first.');
  if (!body.email?.primary) throw badRequest('Choose which column holds the email address.');
  const skipRows = Array.isArray(body.skipRows) ? body.skipRows : [];
  const full = loadSheet(db, org, body.uploadId);
  const sheet = loadSheet(db, org, body.uploadId, skipRows);
  const result = validateSheet(sheet, {
    batchId: 'validate',
    mapping: body.mapping,
    email: body.email,
    required: body.required,
    awardColumns: body.awardColumns,
  });
  const byNumber = new Map(sheet.rowNumbers.map((n, i) => [n, sheet.rows[i]]));
  const perRow = new Map<number, typeof result.issues>();
  for (const i of result.issues) perRow.set(i.row, [...(perRow.get(i.row) ?? []), i]);
  const rows = [...perRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, issues]) => ({
      rowNumber,
      values: byNumber.get(rowNumber) ?? {},
      issues,
      blocking: issues.some((i) => i.severity === 'error'),
    }));
  const skip = new Set(skipRows);
  const skippedRows = full.rowNumbers.map((n, i) => ({ rowNumber: n, values: full.rows[i] })).filter((r) => skip.has(r.rowNumber));
  return {
    skippedRows,
    total: full.rows.length,
    skipped: full.rows.length - sheet.rows.length,
    validCount: result.valid.length,
    errorRows: result.invalid.length,
    invalid: result.invalid,
    issues: result.issues,
    rows,
    headers: sheet.headers,
  };
});
