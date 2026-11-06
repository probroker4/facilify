import { saveUpload } from '@/lib/secrets/uploads';
import { auth, BadRequest, jsonError } from '../_shared';
import { PDFDocument } from 'pdf-lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { db, org } = auth(req);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new BadRequest('Please choose a PDF, PNG, or JPG file.');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new BadRequest('Please choose a PDF, PNG, or JPG file.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { id, mime } = saveUpload(db, org.id, 'template', file.name || 'template', bytes);

    let pageSize: [number, number] = [842, 595];
    if (mime === 'application/pdf') {
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const p = doc.getPages()[0];
        if (p) {
          const { width, height } = p.getSize();
          pageSize = [Math.round(width), Math.round(height)];
        }
      } catch {}
    }

    return Response.json({ uploadId: id, mime, pageSize, name: file.name });
  } catch (e) {
    return jsonError(e);
  }
}
