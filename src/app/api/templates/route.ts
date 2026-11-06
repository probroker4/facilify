import type { CertTemplate } from '@/lib/contracts';
import { listDocs, saveDoc } from '@/lib/db/repo';
import { listBuiltinTemplates } from '@/lib/render/builtin';
import { randomId } from '@/lib/secrets/crypto';
import { badRequest, plainText, readJsonBody, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ db, org }) => {
  const saved = listDocs<CertTemplate>(db, 'templates', org.id).map((d) => ({ ...d.doc, id: d.id, name: d.name }));
  const builtins = listBuiltinTemplates();
  return { templates: [...builtins, ...saved], builtins, saved };
});

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ template?: CertTemplate } & Partial<CertTemplate>>(req);
  const t = (body.template ?? body) as CertTemplate;
  if (!t || !Array.isArray(t.layers) || !Array.isArray(t.pageSize)) throw badRequest('That design is not valid.');
  const id = randomId('tpl');
  const name = plainText(t.name, 80) || 'My certificate design';
  const template: CertTemplate = { ...t, id, name };
  saveDoc(db, 'templates', org.id, id, name, template);
  return { ok: true, id, template };
});
