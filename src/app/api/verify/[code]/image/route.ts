import { getCertByVerifyCode } from '@/lib/db/repo';
import { getOrRenderPdf } from '@/lib/public-cert';
import { rasterizePdf } from '@/lib/render/raster';
import { notFound, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ code: string }>(async ({ db, params }) => {
  const cert = getCertByVerifyCode(db, params.code.trim().toUpperCase());
  if (!cert) throw notFound('Certificate not found.');
  const file = await getOrRenderPdf(db, cert);
  if (!file) throw notFound('This certificate image is not available any more.');
  const raster = await rasterizePdf(file.pdf, 1.5);
  return new Response(new Uint8Array(raster.png()), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' } });
}, { auth: false });
