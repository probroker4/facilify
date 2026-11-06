import fontkit from '@pdf-lib/fontkit';
import { saveUpload } from '@/lib/secrets/uploads';
import { auth, BadRequest, jsonError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { db, org } = auth(req);
    let form: FormData;
    try { form = await req.formData(); } catch { throw new BadRequest('Please choose a .ttf or .otf font file.'); }
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new BadRequest('Please choose a .ttf or .otf font file.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let family = '';
    try {
      const font = fontkit.create(bytes as unknown as Buffer) as unknown as { familyName?: string; characterSet?: number[] };
      if (!font.characterSet?.length) throw new Error('no glyphs');
      family = font.familyName ?? '';
    } catch {
      throw new BadRequest('That file could not be read as a font. Please use a .ttf or .otf file.');
    }
    const { id, mime } = saveUpload(db, org.id, 'font', file.name || 'font.ttf', bytes);
    if (!family) family = (file.name || 'My font').replace(/\.(ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim() || 'My font';
    return Response.json({ fontId: `upload:${id}`, uploadId: id, family, mime });
  } catch (e) {
    return jsonError(e);
  }
}
