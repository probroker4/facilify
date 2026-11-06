import { rasterizePdf } from '@/lib/render/raster';
import { auth, backgroundByRef, builtinId, clampScale, jsonError, pngResponse } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, props: { params: Promise<{ ref: string }> }) {
  try {
    const params = await props.params;
    const ref = decodeURIComponent(params.ref).replace(/^custom:/, '');
    const cache = builtinId(ref) ? 'public, max-age=3600, immutable' : 'private, max-age=600';
    let db = null as ReturnType<typeof auth>['db'] | null;
    let orgId = '';
    if (!builtinId(ref)) ({ db, org: { id: orgId } } = auth(req));
    const { bytes, type } = await backgroundByRef(db as never, orgId, ref);
    if (type === 'pdf') {
      const url = new URL(req.url);
      const scale = clampScale(url.searchParams.get('scale'), 1.5);
      const raster = await rasterizePdf(bytes, scale);
      return pngResponse(raster.png(), { 'cache-control': cache });
    }

    if (type === 'png') {
      return pngResponse(bytes, { 'cache-control': cache });
    }

    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': cache,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
