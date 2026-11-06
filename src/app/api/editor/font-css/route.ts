import { cssFamilyFor, catalogFontId } from '../_fonts';
import { auth, BadRequest, jsonError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    auth(req);
    const raw = new URL(req.url).searchParams.get('id') ?? '';
    let src: string;
    if (raw.startsWith('upload:')) {
      const up = raw.slice(7);
      if (!/^up_[A-Za-z0-9_-]+$/.test(up)) throw new BadRequest('Invalid font id.');
      src = `/api/editor/font-file/${up}`;
    } else {
      const id = catalogFontId(raw);
      if (!id) throw new BadRequest('Invalid font id.');
      src = `/api/editor/font-file/${id}`;
    }
    const css = `@font-face{font-family:"${cssFamilyFor(raw)}";src:url("${src}") format("truetype");font-display:swap;}\n`;
    return new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'private, max-age=3600' } });
  } catch (e) {
    return jsonError(e);
  }
}
