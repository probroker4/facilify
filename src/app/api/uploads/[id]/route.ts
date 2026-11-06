import { readUpload } from '@/lib/secrets/uploads';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const up = readUpload(db, org.id, params.id);
  return new Response(new Uint8Array(up.bytes), {
    headers: {
      'content-type': up.mime,
      'content-disposition': `inline; filename="${encodeURIComponent(up.name)}"`,
      'cache-control': 'private, no-store',
    },
  });
});
