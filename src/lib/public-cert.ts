import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db';
import type { CertRow, BatchRow } from '@/lib/db/repo';
import { getRecord } from '@/lib/db/repo';
import { get } from '@/lib/db';
import { subDir } from '@/lib/paths';
import { LocalStorage } from '@/lib/storage/local';
import { localCertificatesDir, fonts, templateBackground, certValues, verifyUrlFor } from '@/lib/pipeline/services';
import { renderCertificate, builtinTemplate } from '@/lib/render';
import type { BatchConfig } from '@/lib/pipeline/config';

export function getStoredPdf(cert: CertRow): { pdf: Uint8Array; fileName: string } | null {
  const pdfPath = path.join(subDir('pdfs'), cert.batch_id, `${cert.id}.pdf`);
  if (fs.existsSync(pdfPath)) {
    try {
      return { pdf: new Uint8Array(fs.readFileSync(pdfPath)), fileName: cert.file_name || 'certificate.pdf' };
    } catch {}
  }

  const localStore = new LocalStorage(localCertificatesDir(cert.organizer_id));
  const localPath = localStore.pathOf(cert.id);
  if (localPath && fs.existsSync(localPath)) {
    try {
      return { pdf: new Uint8Array(fs.readFileSync(localPath)), fileName: cert.file_name || path.basename(localPath) };
    } catch {}
  }

  return null;
}

export async function getOrRenderPdf(db: DB, cert: CertRow): Promise<{ pdf: Uint8Array; fileName: string } | null> {
  const stored = getStoredPdf(cert);
  if (stored) return stored;

  const record = getRecord(db, cert.record_id);
  if (!record) return null;
  const batch = get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', cert.batch_id);
  let config: BatchConfig | null = null;
  try {
    if (batch?.config_json) config = JSON.parse(batch.config_json);
  } catch {}

  const template = (config?.templates && config.templates[cert.template_id])
    || (cert.template_id.startsWith('builtin:') ? builtinTemplate(cert.template_id.replace('builtin:', '')) : builtinTemplate('classic'));

  const bg = await templateBackground(db, cert.organizer_id, template);
  const values = certValues(cert, record);
  const r = await renderCertificate({
    template,
    background: bg.bytes,
    backgroundType: bg.type,
    values,
    certId: cert.id,
    recordId: record.id,
    personKey: record.person_key,
    verifyCode: cert.verify_code,
    verifyUrl: verifyUrlFor(cert.verify_code),
    fileName: cert.file_name || 'certificate.pdf',
    issuedAt: config?.issuedAt ? new Date(config.issuedAt) : new Date(),
  }, fonts());

  return { pdf: r.pdf, fileName: r.fileName };
}
