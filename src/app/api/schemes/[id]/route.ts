import type { AwardScheme } from '@/lib/contracts';
import { deleteDoc, getDoc, saveDoc } from '@/lib/db/repo';
import { badRequest, notFound, plainText, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const s = getDoc<AwardScheme>(db, 'schemes', org.id, params.id);
  if (!s) throw notFound('That award setup was not found.');
  return { ok: true, scheme: { ...s, id: params.id } };
});

export const PUT = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  if (!getDoc(db, 'schemes', org.id, params.id)) throw notFound('That award setup was not found.');
  const body = await readJsonBody<{ scheme?: AwardScheme } & Partial<AwardScheme>>(req);
  const s = (body.scheme ?? body) as AwardScheme;
  if (!s || !Array.isArray(s.categories)) throw badRequest('That award setup is not valid.');
  const name = plainText(s.name, 80) || 'Award setup';
  saveDoc(db, 'schemes', org.id, params.id, name, { ...s, id: params.id, name });
  return { ok: true, id: params.id };
});

export const DELETE = withApi<{ id: string }>(async ({ db, org, params }) => {
  deleteDoc(db, 'schemes', org.id, params.id);
  return { ok: true };
});
