import type { DB } from '@/lib/db/db';
import { get } from '@/lib/db/db';
import { getCertByVerifyCode, getRecord, type BatchRow } from '@/lib/db/repo';
import type { BatchConfig } from '@/lib/pipeline/config';
import { orgSettings, verifyUrlFor } from '@/lib/pipeline/services';
import { certToken } from '@/lib/secrets/crypto';
import { signReceipt, type SignedReceipt } from '@/lib/attest';
import { buildShareLinks } from '@/lib/share';
import { baseUrl } from '@/lib/paths';

export interface VerifyData {
  valid: boolean;
  revoked: boolean;
  name: string;
  event: string;
  award: string;
  achievement: string;
  date: string;
  issuer: string;
  code: string;
  verifyUrl: string;
  imagePath: string;
  pdfPath: string;
  reportPath: string;
  linkedInPath: string;
  issuedAt: string;
  sha256: string;
  proof: SignedReceipt;
  linkedIn: { enabled: boolean; title: string; addToProfile: string } | null;
}

export function verifyData(db: DB, rawCode: string): VerifyData | null {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(code)) return null;
  const cert = getCertByVerifyCode(db, code);
  if (!cert) return null;
  const record = getRecord(db, cert.record_id);
  if (!record) return null;
  let values: Record<string, string> = {};
  try { values = JSON.parse(record.values_json) as Record<string, string>; } catch { values = {}; }
  const batch = get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', cert.batch_id);
  let cfg: Partial<BatchConfig> = {};
  try { cfg = batch ? (JSON.parse(batch.config_json) as Partial<BatchConfig>) : {}; } catch { cfg = {}; }
  const issuer = cfg.organizationName ?? '';
  const org = orgSettings(db, cert.organizer_id);
  const organization = issuer || org.name;
  const issuedAt = new Date(cfg.issuedAt || cert.created_at).toISOString();
  const award = cert.category_label || values.CERTIFICATE_TYPE || '';
  const cat = cfg.scheme?.categories.find((c) => c.id === cert.category_id);
  const linkedInTitle = cat?.linkedInTitle || `${award}${values.EVENT ? ` - ${values.EVENT}` : ''}`;
  const linkedInOn = cfg.linkedIn ?? org.linkedInEnabled;
  const links = buildShareLinks({
    title: linkedInTitle, organizationName: organization, organizationId: cfg.organizationId || org.linkedInOrgId, dateText: values.DATE ?? '',
    issuedAt: new Date(issuedAt), verifyUrl: verifyUrlFor(cert.verify_code), verifyCode: cert.verify_code, customizeUrl: `${baseUrl()}/linkedin/${certToken(cert.id)}`,
  });
  const token = certToken(cert.id);
  const c = encodeURIComponent(cert.verify_code);
  return {
    valid: !cert.revoked, revoked: !!cert.revoked,
    name: values.NAME ?? '', event: values.EVENT ?? '', award,
    achievement: values.ACHIEVEMENT ?? '', date: values.DATE ?? '',
    issuer: organization,
    issuedAt, sha256: cert.sha256 ?? '',
    proof: signReceipt({ code: cert.verify_code, issuedAt, sha256: cert.sha256 ?? '', name: values.NAME ?? '', award, event: values.EVENT ?? '', issuer: organization }),
    linkedIn: linkedInOn && !cert.revoked ? { enabled: true, title: linkedInTitle, addToProfile: links.addToProfile } : null,
    code: cert.verify_code, verifyUrl: verifyUrlFor(cert.verify_code),
    imagePath: `/api/verify/${c}/image`, pdfPath: `/api/verify/${c}/pdf`,
    reportPath: `/report/${token}`, linkedInPath: `/linkedin/${token}`,
  };
}
