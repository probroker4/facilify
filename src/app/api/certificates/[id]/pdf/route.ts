import { getBatch, getCert, getRecord } from '@/lib/db/repo';
import { getOrRenderPdf } from '@/lib/public-cert';
import { notFound, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const cert = getCert(db, params.id);
  if (!cert || cert.organizer_id !== org.id || !getBatch(db, org.id, cert.batch_id) || !getRecord(db, cert.record_id)) throw notFound('That certificate was not found. Its batch may have been deleted.');
  const file = await getOrRenderPdf(db, cert);
  if (!file) throw notFound('That certificate file is not available.');
  return new Response(new Uint8Array(file.pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`, 'cache-control': 'private, no-store' },
  });
});
