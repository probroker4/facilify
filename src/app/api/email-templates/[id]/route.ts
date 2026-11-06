import { deleteDoc, getDoc, saveDoc } from '@/lib/db/repo';
import { notFound, readJsonBody, withApi } from '../../_shared';
import { cleanEmailTemplate } from '../../_emailtpl';

export const dynamic = 'force-dynamic';

export const PUT = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  if (!getDoc(db, 'email_templates', org.id, params.id)) throw notFound('That email wording was not found.');
  const { template, name } = cleanEmailTemplate(await readJsonBody(req), params.id);
  saveDoc(db, 'email_templates', org.id, params.id, name, template);
  return { ok: true, id: params.id, template };
});

export const DELETE = withApi<{ id: string }>(async ({ db, org, params }) => {
  deleteDoc(db, 'email_templates', org.id, params.id);
  return { ok: true };
});
