import { saveUpload, type UploadKind } from '@/lib/secrets/uploads';
import { badRequest, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

const KINDS: UploadKind[] = ['sheet', 'template', 'font'];

export const POST = withApi(async ({ req, db, org }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('Please choose a file to upload.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Please choose a file to upload.');
  const kindRaw = String(form.get('kind') ?? 'sheet');
  if (!KINDS.includes(kindRaw as UploadKind)) throw badRequest('Unknown upload type.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = (file.name || 'upload').slice(-160);
  const { id, mime } = saveUpload(db, org.id, kindRaw as UploadKind, name, bytes);
  return { ok: true, id, uploadId: id, mime, name, kind: kindRaw, size: bytes.length };
});
