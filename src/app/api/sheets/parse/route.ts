import { suggestMappings } from '@/lib/ingest/headers';
import { loadSheet } from '../../_draft';
import { readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string }>(req);
  const sheet = loadSheet(db, org, body.uploadId);
  if (!sheet.rows.length) {
    throw Object.assign(new Error('This sheet has headings but no student rows underneath. Add at least one student and upload it again.'), { status: 400 });
  }
  return {
    sourceName: sheet.sourceName,
    headers: sheet.headers,
    rows: sheet.rows.slice(0, 500),
    rowNumbers: sheet.rowNumbers.slice(0, 500),
    rowCount: sheet.rows.length,
    encoding: sheet.encoding,
    headerRowNumber: sheet.headerRowNumber,
    suggestions: suggestMappings(sheet.headers),
  };
});
