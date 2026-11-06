import type { EmailTemplate, MailAttachment, OutboundMail } from '@/lib/contracts';
import { escapeHtml, fillPlaceholders } from '@/lib/text';
import { sha256 } from '@/lib/hash';

export interface MailCertificate {
  certId: string;
  fileName: string;
  pdf: Uint8Array;
  sha256: string;
  verifyCode: string;
  verifyUrl: string;
  categoryLabel: string;
  driveLink?: string;
  linkedInAddUrl?: string;
  linkedInShareUrl?: string;
  linkedInCustomizeUrl?: string;
  reportUrl: string;
}

export interface ComposeInput {
  template: EmailTemplate;
  values: Record<string, string>;
  to: string;
  personKey: string;
  from?: string;
  certs: MailCertificate[];
  organizationName: string;
  messageId: string;
  corrected?: { note: string };
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

const btn = (href: string | undefined, label: string, color = '#1f3a5f'): string => {
  const h = safeHref(href);
  if (!h) return '';
  return `<a href="${escapeHtml(h)}" style="display:inline-block;margin:4px 6px 4px 0;padding:9px 14px;border-radius:6px;background:${color};color:#ffffff;text-decoration:none;font:600 14px/1.2 Arial,Helvetica,sans-serif">${escapeHtml(label)}</a>`;
};

function certBlock(c: MailCertificate, includeDrive: boolean, includeLinkedIn: boolean, multi: boolean): string {
  const customize = includeLinkedIn ? safeHref(c.linkedInCustomizeUrl) : null;
  const parts = [
    multi ? `<p style="margin:14px 0 4px;font:600 15px Arial,Helvetica,sans-serif;color:#111827">${escapeHtml(c.categoryLabel)}</p>` : '',
    btn(c.verifyUrl, 'View & verify certificate'),
    includeDrive ? btn(c.driveLink, 'Open in Google Drive', '#0f766e') : '',
    includeLinkedIn ? btn(c.linkedInAddUrl, 'Add to LinkedIn profile', '#0a66c2') : '',
    includeLinkedIn ? btn(c.linkedInShareUrl, 'Share on LinkedIn', '#0a66c2') : '',
    customize
      ? `<div style="font:12px Arial,Helvetica,sans-serif;color:#4b5563;margin-top:2px">Want different wording on LinkedIn? <a href="${escapeHtml(customize)}">Customize your LinkedIn entry</a></div>`
      : '',
    `<div style="font:12px Arial,Helvetica,sans-serif;color:#6b7280;margin-top:4px">Verify code: ${escapeHtml(c.verifyCode)}</div>`,
  ];
  return `<div style="margin:0 0 14px">\n${parts.filter(Boolean).join('\n')}\n</div>`;
}

function reportBlock(certs: MailCertificate[]): string {
  const links = certs
    .map((c) => btn(c.reportUrl, certs.length > 1 ? `Report a problem: ${c.categoryLabel}` : 'Report a problem', '#b45309'))
    .filter(Boolean)
    .join('\n');
  return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 12px">
<p style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#374151;margin:0 0 6px"><strong>Something wrong?</strong> If your name is misspelled or a detail is incorrect, tell the organizers and they will send a corrected certificate.</p>
<div>${links}</div>`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const url = href.replace(/&amp;/g, '&');
        return text && text !== url ? `${text}: ${url}` : url;
      })
      .replace(/<(br|\/p|\/div|hr|\/h\d|\/li|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headerSafe(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function composeEmail(input: ComposeInput): OutboundMail {
  if (!input.certs.length) throw new Error('composeEmail needs at least one certificate.');
  const first = input.certs[0];
  const values: Record<string, string> = {
    ...input.values,
    ORGANIZATION: input.organizationName,
    VERIFY_URL: first.verifyUrl,
    VERIFY_CODE: first.verifyCode,
    DRIVE_LINK: input.template.includeDriveLink ? first.driveLink ?? '' : '',
    CERTIFICATE_COUNT: String(input.certs.length),
    AWARDS: input.certs.map((c) => c.categoryLabel).join(', '),
  };
  let subject = headerSafe(fillPlaceholders(input.template.subject, values));
  if (input.corrected && !/^corrected:/i.test(subject)) subject = `Corrected: ${subject}`;
  const bodyHtml = fillPlaceholders(input.template.html, values, escapeHtml);
  const multi = input.certs.length > 1;
  const banner = input.corrected
    ? `<p style="padding:10px 12px;border-radius:6px;background:#fef3c7;color:#78350f;font:14px Arial,Helvetica,sans-serif"><strong>This is a corrected certificate.</strong> ${escapeHtml(input.corrected.note)} Please use this one instead of the earlier copy.</p>`
    : '';
  const awardList = multi
    ? `<p style="margin:16px 0 4px">You are receiving ${input.certs.length} certificates (each is attached as a PDF):</p>\n<ul style="margin:0 0 8px;padding-left:20px">${input.certs.map((c) => `<li>${escapeHtml(c.categoryLabel)}</li>`).join('')}</ul>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:24px;background:#f9fafb">
<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#111827">
${banner}
${bodyHtml}
${awardList}
<div style="margin-top:18px">
${input.certs.map((c) => certBlock(c, input.template.includeDriveLink, input.template.includeLinkedIn, multi)).join('\n')}
</div>
${reportBlock(input.certs)}
<p style="font:12px Arial,Helvetica,sans-serif;color:#9ca3af;margin-top:18px">Sent by ${escapeHtml(input.organizationName)} with Facilify.</p>
</div></body></html>`;
  const attachments: MailAttachment[] = input.certs.map((c) => ({ certId: c.certId, fileName: c.fileName, content: c.pdf, sha256: c.sha256 }));
  return {
    personKey: input.personKey,
    to: input.to.trim(),
    from: input.from ? headerSafe(input.from) : undefined,
    subject,
    html,
    text: htmlToText(html),
    attachments,
    messageId: input.messageId,
  };
}

export function deterministicMessageId(certIds: string[], attempt: number, domain = 'certflow.local'): string {
  return `<cf.${sha256(`${[...certIds].sort().join(',')}#${attempt}`).slice(0, 32)}@${domain}>`;
}
