import { discoverCategories } from '@/lib/routing/discover';
import { loadSheet } from '../../_draft';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; awardColumns?: string[]; skipRows?: number[] }>(req);
  const awardColumns = Array.isArray(body.awardColumns) ? body.awardColumns.filter((c) => typeof c === 'string' && c) : [];
  if (!awardColumns.length) throw badRequest('Choose which column says what award each student gets.');
  const sheet = loadSheet(db, org, body.uploadId, Array.isArray(body.skipRows) ? body.skipRows : []);
  const missing = awardColumns.filter((c) => !sheet.headers.includes(c));
  if (missing.length) throw badRequest(`The column "${missing[0]}" is not in your sheet.`);
  return { ok: true, categories: discoverCategories(sheet.rows, awardColumns), rowCount: sheet.rows.length };
});
