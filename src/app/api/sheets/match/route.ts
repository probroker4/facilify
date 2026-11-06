import { matchTypedHeading, suggestMappings } from '@/lib/ingest/headers';
import { STANDARD_PLACEHOLDERS } from '@/lib/contracts';
import { loadSheet } from '../../_draft';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; headers?: string[]; typed?: Record<string, string> }>(req);
  const headers = body.uploadId ? loadSheet(db, org, body.uploadId).headers : body.headers;
  if (!Array.isArray(headers) || !headers.length) throw badRequest('Upload your sheet first so there are headings to match.');
  const typed = body.typed && typeof body.typed === 'object' ? body.typed : {};
  const placeholders = [...new Set<string>([...STANDARD_PLACEHOLDERS, ...Object.keys(typed)])];
  const matches = suggestMappings(headers, placeholders).map((m) => {
    const t = typeof typed[m.placeholder] === 'string' ? typed[m.placeholder].trim() : '';
    return t ? matchTypedHeading(t, headers, m.placeholder) : m;
  });
  return { matches };
});
