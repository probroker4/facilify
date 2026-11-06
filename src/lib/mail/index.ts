export { composeEmail, htmlToText, deterministicMessageId } from './compose';
export type { ComposeInput, MailCertificate } from './compose';
export { guardMail } from './guard';
export type { ExpectedDelivery } from './guard';
export { buildMime } from './mime';
export { CaptureTransport, SmtpTransport, GmailTransport, classifySmtpError, classifyGmailError } from './transports';
export type { SmtpSettings, GmailOptions } from './transports';
