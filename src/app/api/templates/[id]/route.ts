import type { CertTemplate } from '@/lib/contracts';
import { deleteDoc, getDoc, saveDoc } from '@/lib/db/repo';
import { resolveTemplate } from '../../_draft';
import { badRequest, notFound, plainText, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const id = decodeURIComponent(params.id);
  try {
    return { ok: true, template: resolveTemplate(db, org, id) };
  } catch {
    throw notFound('That certificate design was not found.');
  }
});

export const PUT = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const id = decodeURIComponent(params.id);
  if (id.startsWith('builtin:')) throw badRequest('Built-in designs cannot be changed. Save a copy instead.');
  if (!getDoc(db, 'templates', org.id, id)) throw notFound('That certificate design was not found.');
  const body = await readJsonBody<{ template?: CertTemplate } & Partial<CertTemplate>>(req);
  const t = (body.template ?? body) as CertTemplate;
  if (!t || !Array.isArray(t.layers) || !Array.isArray(t.pageSize)) throw badRequest('That design is not valid.');
  const name = plainText(t.name, 80) || 'My certificate design';
  const template: CertTemplate = { ...t, id, name };
  saveDoc(db, 'templates', org.id, id, name, template);
  return { ok: true, id, template };
});

export const DELETE = withApi<{ id: string }>(async ({ db, org, params }) => {
  deleteDoc(db, 'templates', org.id, decodeURIComponent(params.id));
  return { ok: true };
});
