import { getCert } from '@/lib/db/repo';
import { getStoredPdf } from '@/lib/public-cert';
import { notFound, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const cert = getCert(db, params.id);
  if (!cert || cert.organizer_id !== org.id) throw notFound('That certificate was not found.');
  const stored = getStoredPdf(cert);
  if (!stored) throw notFound('That certificate file is no longer stored on this computer.');
  return new Response(new Uint8Array(stored.pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${encodeURIComponent(stored.fileName)}"`, 'cache-control': 'private, no-store' },
  });
});
