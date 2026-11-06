import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';
import type { OutboundMail } from '@/lib/contracts';

export function mailOptions(m: OutboundMail, from?: string): Mail.Options {
  return {
    from: from ?? m.from,
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    messageId: m.messageId,
    headers: { 'X-Facilify-Certificates': m.attachments.map((a) => a.certId).join(',') },
    attachments: m.attachments.map((a) => ({
      filename: a.fileName,
      content: Buffer.from(a.content.buffer, a.content.byteOffset, a.content.byteLength),
      contentType: 'application/pdf',
      contentDisposition: 'attachment' as const,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export async function buildMime(m: OutboundMail): Promise<Buffer> {
  const composer = new MailComposer(mailOptions(m));
  return new Promise((resolve, reject) => composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg))));
}
