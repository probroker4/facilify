import type { ColumnProfile } from '@/lib/contracts';
import { listDocs, saveDoc } from '@/lib/db/repo';
import { randomId } from '@/lib/secrets/crypto';
import { badRequest, plainText, readJsonBody, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ db, org }) => ({
  profiles: listDocs<ColumnProfile>(db, 'column_profiles', org.id).map((d) => ({ ...d.doc, id: d.id, name: d.name })),
}));

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ name?: string; matches?: Record<string, string> }>(req);
  const name = plainText(body.name, 80);
  if (!name) throw badRequest('Give this column setup a name, for example "Hackathon sheet".');
  const matches: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.matches ?? {})) if (typeof v === 'string' && v.trim()) matches[plainText(k, 40)] = plainText(v, 120);
  if (!Object.keys(matches).length) throw badRequest('There are no column choices to save yet.');
  const id = randomId('prof');
  const profile: ColumnProfile = { id, name, matches };
  saveDoc(db, 'column_profiles', org.id, id, name, profile);
  return { ok: true, id, profile };
});
