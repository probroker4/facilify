import { readUpload } from '@/lib/secrets/uploads';
import { catalogFontId } from '../../_fonts';
import { auth, BadRequest, fonts, jsonError } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const { db, org } = auth(req);
    const { id } = await props.params;
    if (/^up_/.test(id)) {
      if (!/^up_[A-Za-z0-9_-]+$/.test(id)) throw new BadRequest('Invalid font id.');
      const up = readUpload(db, org.id, id);
      if (up.kind !== 'font') throw new BadRequest('File is not a font.');
      return new Response(new Uint8Array(up.bytes), {
        headers: { 'content-type': up.mime || 'font/ttf', 'cache-control': 'private, max-age=86400, immutable' },
      });
    }
    const fontId = catalogFontId(id);
    if (!fontId) throw new BadRequest('Invalid font id.');
    const url = new URL(req.url);
    const faces = await fonts().getFaces(fontId, url.searchParams.get('bold') === '1', url.searchParams.get('italic') === '1');
    if (!faces.length) return Response.json({ error: 'That font is not available.' }, { status: 404 });
    return new Response(new Uint8Array(faces[0].bytes), {
      headers: { 'content-type': 'font/ttf', 'cache-control': 'private, max-age=86400' },
    });
  } catch (e) {
    return jsonError(e);
  }
}
