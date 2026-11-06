import type { AwardScheme } from '@/lib/contracts';
import { listDocs, saveDoc } from '@/lib/db/repo';
import { randomId } from '@/lib/secrets/crypto';
import { badRequest, plainText, readJsonBody, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ db, org }) => ({
  schemes: listDocs<AwardScheme>(db, 'schemes', org.id).map((d) => ({ ...d.doc, id: d.id, name: d.name })),
}));

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ scheme?: AwardScheme } & Partial<AwardScheme>>(req);
  const s = (body.scheme ?? body) as AwardScheme;
  if (!s || !Array.isArray(s.categories) || !s.categories.length) throw badRequest('There are no awards to save yet.');
  const name = plainText(s.name, 80);
  if (!name) throw badRequest('Give this award setup a name, for example "Hackathon prizes".');
  const id = randomId('sch');
  const scheme: AwardScheme = { ...s, id, name };
  saveDoc(db, 'schemes', org.id, id, name, scheme);
  return { ok: true, id, scheme };
});
