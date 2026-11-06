import { renderCertificate } from '@/lib/render';
import { rasterizePdf } from '@/lib/render/raster';
import { fonts, templateBackground, verifyUrlFor } from '@/lib/pipeline/services';
import { buildPlan, categoryLabel } from '../../_plan';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; draft?: unknown; index?: number; scale?: number }>(req);
  const plan = buildPlan(db, org, body);
  const a = plan.routed.assignments[Number.isInteger(body.index) ? (body.index as number) : 0];
  if (!a) throw badRequest('There is no certificate to preview.');
  const rec = plan.records.get(a.recordId)!;
  const template = plan.config.templates[a.templateId];
  const { label } = categoryLabel(plan.config, a.categoryId, rec);
  const bg = await templateBackground(db, org.id, template);
  const code = 'SAMPLE-0000';
  const cert = await renderCertificate({
    template, background: bg.bytes, backgroundType: bg.type,
    values: { ...rec.values, CERTIFICATE_TYPE: label, CATEGORY: label, VERIFY_CODE: code },
    certId: a.certId, recordId: rec.recordId, personKey: rec.personKey, verifyCode: code, verifyUrl: verifyUrlFor(code),
    fileName: 'preview.pdf', issuedAt: new Date(plan.config.issuedAt),
  }, fonts());
  const raster = await rasterizePdf(cert.pdf, Math.min(2, Math.max(0.5, Number(body.scale) || 1.2)));
  return new Response(new Uint8Array(raster.png()), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
});
