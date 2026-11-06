import { DEFAULT_EMAIL_TEMPLATE } from '@/lib/pipeline/config';
import { composeEmail, type MailCertificate } from '@/lib/mail';
import { certFileName } from '@/lib/render';
import { baseUrl } from '@/lib/paths';
import { orgSettings, senderAddress, buildTransport } from '@/lib/pipeline/services';
import { buildShareLinks } from '@/lib/share';
import { buildPlan, categoryLabel } from '../../_plan';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; draft?: unknown; index?: number }>(req);
  const plan = buildPlan(db, org, body);
  const first = plan.routed.assignments[Number.isInteger(body.index) ? (body.index as number) : 0];
  if (!first) throw badRequest('There is no email to preview.');
  const mine = plan.config.scheme.delivery === 'one-email'
    ? plan.routed.assignments.filter((a) => a.personKey === first.personKey)
    : [first];
  const rec = plan.records.get(first.recordId)!;
  const o = orgSettings(db, org.id);
  const certs: MailCertificate[] = mine.map((a, i) => {
    const r = plan.records.get(a.recordId)!;
    const { cat, label } = categoryLabel(plan.config, a.categoryId, r);
    const code = `SAMPLE-${String(i + 1).padStart(4, '0')}`;
    const verifyUrl = `${baseUrl()}/verify/${code}`;
    const links = plan.config.linkedIn && o.linkedInEnabled
      ? buildShareLinks({
        title: cat?.linkedInTitle || `${label}${r.values.EVENT ? ` - ${r.values.EVENT}` : ''}`,
        organizationName: plan.config.organizationName, organizationId: plan.config.organizationId,
        dateText: r.values.DATE, issuedAt: new Date(plan.config.issuedAt), verifyUrl, verifyCode: code, customizeUrl: `${baseUrl()}/linkedin/sample`,
      })
      : null;
    return {
      certId: a.certId, fileName: certFileName({ event: r.values.EVENT, id: r.values.ID, name: r.values.NAME, category: label }),
      pdf: new Uint8Array(0), sha256: '', verifyCode: code, verifyUrl, categoryLabel: label,
      linkedInAddUrl: links?.addToProfile, linkedInShareUrl: links?.share, linkedInCustomizeUrl: links?.customize,
      reportUrl: `${baseUrl()}/report/sample`,
    };
  });
  const firstCat = plan.config.scheme.categories.find((c) => c.id === first.categoryId);
  const tpl = plan.config.emailTemplates[firstCat?.emailTemplateId ?? plan.config.defaultEmailTemplateId] ?? DEFAULT_EMAIL_TEMPLATE;
  const transport = buildTransport(db, org.id);
  const mail = composeEmail({
    template: tpl, values: { ...rec.values, CERTIFICATE_TYPE: certs[0].categoryLabel, CATEGORY: certs[0].categoryLabel },
    to: rec.email, personKey: rec.personKey, from: senderAddress(db, org.id, transport), certs,
    organizationName: plan.config.organizationName, messageId: '<preview@certflow.local>',
  });
  return { subject: mail.subject, html: mail.html, text: mail.text, to: mail.to, from: mail.from ?? '', attachments: mail.attachments.map((a) => a.fileName), name: rec.values.NAME ?? '' };
});
