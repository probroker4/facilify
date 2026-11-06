import path from 'node:path';
import type { CertStorage, CertTemplate, MailTransport } from '@/lib/contracts';
import { all, get, type DB } from '@/lib/db/db';
import { getSetting, type BatchRow, type CertRow, type RecordRow } from '@/lib/db/repo';
import { ServerFontProvider } from '@/lib/fonts/server';
import { CaptureTransport, GmailTransport, SmtpTransport, composeEmail, type MailCertificate } from '@/lib/mail';
import { baseUrl, subDir } from '@/lib/paths';
import { builtinBackground, certFileName, renderCertificate, uniformSizeCaps } from '@/lib/render';
import { categoryById } from '@/lib/routing/assign';
import { certToken } from '@/lib/secrets/crypto';
import { readUpload } from '@/lib/secrets/uploads';
import { buildShareLinks } from '@/lib/share';
import { DriveStorage, LocalStorage, folderPathFor } from '@/lib/storage';
import { googleAccessToken, googleConfigured } from '@/lib/auth/google';
import type { BatchConfig } from './config';
import { DEFAULT_EMAIL_TEMPLATE } from './config';
import { diskPdfStore, type RunnerDeps, type SendItem } from './runner';

let fontProvider: ServerFontProvider | null = null;
export function fonts(): ServerFontProvider {
  return (fontProvider ??= new ServerFontProvider());
}

export type SenderKind = 'capture' | 'smtp' | 'gmail';
export interface SenderSettings { kind: SenderKind; smtp?: { host: string; port: number; secure: boolean; user?: string; from: string; dailyLimit?: number } }
export interface OrgSettings { name: string; email?: string; linkedInOrgId?: string; linkedInEnabled: boolean }

export function orgSettings(db: DB, organizerId: string): OrgSettings {
  const s = getSetting<OrgSettings>(db, organizerId, 'org');
  const email = get<{ email: string }>(db, 'SELECT email FROM organizers WHERE id = ?', organizerId)?.email;
  return { name: s?.name || 'Event Organizers', email: s?.email || email, linkedInOrgId: s?.linkedInOrgId, linkedInEnabled: s?.linkedInEnabled ?? true };
}

export function senderSettings(db: DB, organizerId: string): SenderSettings {
  return getSetting<SenderSettings>(db, organizerId, 'sender') ?? { kind: 'capture' };
}

export function outboxDir(organizerId: string): string {
  return subDir('outbox', organizerId);
}

export function buildTransport(db: DB, organizerId: string): MailTransport {
  const s = senderSettings(db, organizerId);
  if (s.kind === 'smtp' && s.smtp) {
    return new SmtpTransport({ ...s.smtp, pass: getSetting<string>(db, organizerId, 'smtp.pass') });
  }
  if (s.kind === 'gmail' && googleConfigured()) {
    const from = getSetting<string>(db, organizerId, 'google.email') ?? '';
    return new GmailTransport({ from, getAccessToken: (force) => googleAccessToken(db, organizerId, force) });
  }
  return new CaptureTransport(outboxDir(organizerId));
}

export function senderAddress(db: DB, organizerId: string, transport: MailTransport): string {
  const org = orgSettings(db, organizerId);
  if (transport.name === 'gmail') return getSetting<string>(db, organizerId, 'google.email') ?? org.email ?? '';
  if (transport.name === 'smtp') return senderSettings(db, organizerId).smtp?.from ?? org.email ?? '';
  return `${org.name} <${org.email ?? 'certificates@certflow.local'}>`;
}

export function localCertificatesDir(organizerId: string): string {
  return subDir('certificates', organizerId);
}

export function buildStorage(db: DB, organizerId: string): CertStorage | null {
  const kind = getSetting<string>(db, organizerId, 'storage') ?? 'local';
  if (kind === 'none') return null;
  if (kind === 'drive' && googleConfigured() && getSetting(db, organizerId, 'google.refresh_token')) {
    return new DriveStorage({ getAccessToken: (force) => googleAccessToken(db, organizerId, force) });
  }
  return new LocalStorage(localCertificatesDir(organizerId));
}

export async function templateBackground(db: DB, organizerId: string, t: CertTemplate): Promise<{ bytes: Uint8Array | null; type?: 'pdf' | 'png' | 'jpg' }> {
  if (t.kind === 'builtin') return { bytes: await builtinBackground(t.backgroundRef ?? 'classic'), type: 'pdf' };
  if (!t.backgroundRef) return { bytes: null };
  const up = readUpload(db, organizerId, t.backgroundRef);
  return { bytes: up.bytes, type: up.mime === 'application/pdf' ? 'pdf' : up.mime === 'image/png' ? 'png' : 'jpg' };
}

export function certValues(cert: CertRow, record: RecordRow): Record<string, string> {
  const values = JSON.parse(record.values_json) as Record<string, string>;
  return { ...values, CERTIFICATE_TYPE: cert.category_label || values.CERTIFICATE_TYPE || '', CATEGORY: cert.category_label, VERIFY_CODE: cert.verify_code };
}

export function verifyUrlFor(code: string): string {
  return `${baseUrl()}/verify/${encodeURIComponent(code)}`;
}

export function buildRunnerDeps(db: DB, organizerId: string, batch: BatchRow, overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  const config = JSON.parse(batch.config_json) as BatchConfig;
  const transport = overrides.transport ?? buildTransport(db, organizerId);
  const storage = overrides.storage !== undefined ? overrides.storage : buildStorage(db, organizerId);
  const org = orgSettings(db, organizerId);
  const capsCache = new Map<string, Promise<Record<string, number>>>();
  const bgCache = new Map<string, Promise<{ bytes: Uint8Array | null; type?: 'pdf' | 'png' | 'jpg' }>>();

  const capsFor = (templateId: string, template: CertTemplate) => {
    if (!capsCache.has(templateId)) {
      const rows = db.prepare(`SELECT c.category_label, c.verify_code, c.record_id, r.values_json FROM certificates c JOIN records r ON r.id = c.record_id
        WHERE c.batch_id = ? AND c.template_id = ?`).all(batch.id, templateId) as { category_label: string; verify_code: string; values_json: string }[];
      const allValues = rows.map((r) => ({ ...JSON.parse(r.values_json), CERTIFICATE_TYPE: r.category_label, CATEGORY: r.category_label, VERIFY_CODE: r.verify_code }));
      capsCache.set(templateId, uniformSizeCaps(template, allValues, fonts()));
    }
    return capsCache.get(templateId)!;
  };

  const deps: RunnerDeps = {
    db, organizerId, transport, storage,
    delivery: config.scheme.delivery,
    concurrency: config.concurrency || 4,
    pdfs: diskPdfStore(subDir('pdfs')),
    async renderCert(cert, record) {
      const template = config.templates[cert.template_id];
      if (!template) throw new Error(`Template ${cert.template_id} is missing from this batch.`);
      if (!bgCache.has(template.id)) bgCache.set(template.id, templateBackground(db, organizerId, template));
      const bg = await bgCache.get(template.id)!;
      const values = certValues(cert, record);
      const wanted = certFileName({ event: values.EVENT, id: values.ID, name: values.NAME, category: cert.category_label });
      const stem = wanted.replace(/\.pdf$/, '');
      let fileName = cert.file_name && (cert.file_name === wanted || (cert.file_name.startsWith(`${stem}-`) && /^-\d+\.pdf$/.test(cert.file_name.slice(stem.length)))) ? cert.file_name : wanted;
      if (fileName !== cert.file_name) {
        const taken = new Set(all<{ file_name: string }>(db, 'SELECT file_name FROM certificates WHERE batch_id = ? AND id <> ? AND file_name IS NOT NULL', batch.id, cert.id).map((r) => r.file_name.toLowerCase()));
        for (let n = 2; taken.has(fileName.toLowerCase()); n++) fileName = `${stem}-${n}.pdf`;
      }
      return renderCertificate({
        template, background: bg.bytes, backgroundType: bg.type, values,
        certId: cert.id, recordId: record.id, personKey: record.person_key, verifyCode: cert.verify_code,
        verifyUrl: verifyUrlFor(cert.verify_code), fileName, issuedAt: new Date(config.issuedAt), sizeCaps: await capsFor(template.id, template),
      }, fonts());
    },
    folderFor(cert, record) {
      const cat = categoryById(config.scheme, cert.category_id);
      return folderPathFor(config.folderPattern, certValues(cert, record), cat?.driveSubfolder || cert.category_label);
    },
    compose(items: SendItem[], messageId: string, corrected?: { note: string }) {
      const firstCat = categoryById(config.scheme, items[0].cert.category_id);
      const tplId = firstCat?.emailTemplateId ?? config.defaultEmailTemplateId;
      const template = config.emailTemplates[tplId] ?? config.emailTemplates[config.defaultEmailTemplateId] ?? DEFAULT_EMAIL_TEMPLATE;
      const values = certValues(items[0].cert, items[0].record);
      const certs: MailCertificate[] = items.map(({ cert, record, pdf }) => {
        const v = certValues(cert, record);
        const cat = categoryById(config.scheme, cert.category_id);
        const verifyUrl = verifyUrlFor(cert.verify_code);
        const token = certToken(cert.id);
        const links = config.linkedIn && org.linkedInEnabled ? buildShareLinks({
          title: cat?.linkedInTitle || `${cert.category_label}${v.EVENT ? ` - ${v.EVENT}` : ''}`,
          organizationName: config.organizationName || org.name, organizationId: config.organizationId || org.linkedInOrgId,
          dateText: v.DATE, issuedAt: new Date(config.issuedAt), verifyUrl, verifyCode: cert.verify_code,
          customizeUrl: `${baseUrl()}/linkedin/${token}`,
        }) : null;
        return {
          certId: cert.id, fileName: cert.file_name!, pdf, sha256: cert.sha256!, verifyCode: cert.verify_code, verifyUrl,
          categoryLabel: cert.category_label, driveLink: cert.web_link && /^https?:/.test(cert.web_link) ? cert.web_link : cert.web_link ? `${baseUrl()}${cert.web_link}` : undefined,
          linkedInAddUrl: links?.addToProfile, linkedInShareUrl: links?.share, linkedInCustomizeUrl: links?.customize,
          reportUrl: `${baseUrl()}/report/${token}`,
        };
      });
      return composeEmail({
        template, values, to: items[0].record.email, personKey: items[0].record.person_key, from: senderAddress(db, organizerId, transport),
        certs, organizationName: config.organizationName || org.name, messageId, corrected,
      });
    },
    ...overrides,
  };
  return deps;
}

export function pdfPathFor(batchId: string, certId: string): string {
  return path.join(subDir('pdfs'), batchId, `${certId}.pdf`);
}
