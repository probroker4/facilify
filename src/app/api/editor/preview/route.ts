import { renderCertificate, uniformSizeCaps } from '@/lib/render';
import { rasterizePdf } from '@/lib/render/raster';
import { auth, checkTemplate, clampScale, previewValues, fonts, jsonError, PREVIEW_VERIFY_CODE, previewVerifyUrl, pngResponse, readJson, templateBackground } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { template: unknown; values?: unknown; scale?: number; rows?: unknown[]; format?: 'png' | 'pdf' }

export async function POST(req: Request) {
  try {
    const { db, org } = auth(req);
    const body = await readJson<Body>(req);
    const template = checkTemplate(body.template);
    const values = previewValues(body.values);
    const bg = await templateBackground(db, org.id, template);
    let sizeCaps: Record<string, number> | undefined;
    if (template.layers.some((l) => l.style.fit?.uniformAcrossBatch) && Array.isArray(body.rows) && body.rows.length) {
      sizeCaps = await uniformSizeCaps(template, body.rows.slice(0, 2000).map(previewValues), fonts());
    }
    const cert = await renderCertificate({
      template, background: bg.bytes, backgroundType: bg.type, values,
      certId: 'preview', recordId: 'preview', personKey: 'preview', verifyCode: PREVIEW_VERIFY_CODE,
      verifyUrl: previewVerifyUrl(), fileName: 'preview.pdf', sizeCaps,
    }, fonts());
    if (body.format === 'pdf') {
      return new Response(new Uint8Array(cert.pdf), {
        headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="sample-certificate.pdf"', 'cache-control': 'private, no-store' },
      });
    }
    const raster = await rasterizePdf(cert.pdf, clampScale(body.scale));
    return pngResponse(raster.png());
  } catch (e) {
    return jsonError(e);
  }
}
