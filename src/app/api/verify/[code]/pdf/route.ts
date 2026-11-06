import { getCertByVerifyCode } from '@/lib/db/repo';
import { getOrRenderPdf } from '@/lib/public-cert';
import { notFound, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ code: string }>(async ({ db, params }) => {
  const cert = getCertByVerifyCode(db, params.code.trim().toUpperCase());
  if (!cert) throw notFound('Certificate not found.');
  const file = await getOrRenderPdf(db, cert);
  if (!file) throw notFound('This certificate file is not available any more.');
  return new Response(new Uint8Array(file.pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`, 'cache-control': 'public, max-age=300' },
  });
}, { auth: false });
