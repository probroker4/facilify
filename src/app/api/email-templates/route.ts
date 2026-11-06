import type { EmailTemplate } from '@/lib/contracts';
import { cleanEmailTemplate } from '../_emailtpl';
import { listDocs, saveDoc } from '@/lib/db/repo';
import { DEFAULT_EMAIL_TEMPLATE } from '@/lib/pipeline/config';
import { randomId } from '@/lib/secrets/crypto';
import { readJsonBody, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ db, org }) => {
  const saved = listDocs<EmailTemplate>(db, 'email_templates', org.id).map((d) => ({ ...d.doc, id: d.id, name: d.name }));
  return { templates: [{ ...DEFAULT_EMAIL_TEMPLATE, name: 'Standard wording' }, ...saved] };
});

export const POST = withApi(async ({ req, db, org }) => {
  const id = randomId('etpl');
  const { template, name } = cleanEmailTemplate(await readJsonBody(req), id);
  saveDoc(db, 'email_templates', org.id, id, name, template);
  return { ok: true, id, template };
});
