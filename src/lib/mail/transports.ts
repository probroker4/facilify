import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser';
import type { MailTransport, OutboundMail } from '@/lib/contracts';
import { MailError } from '@/lib/contracts';
import { buildMime, mailOptions } from './mime';

const safeFile = (messageId: string) => messageId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);

export class CaptureTransport implements MailTransport {
  name = 'capture' as const;
  constructor(public dir: string, public dailyLimit?: number) { fs.mkdirSync(dir, { recursive: true }); }
  fileFor(messageId: string): string { return path.join(this.dir, `${safeFile(messageId)}.eml`); }
  async send(m: OutboundMail) {
    let raw: Buffer;
    try { raw = await buildMime(m); } catch (e) { throw new MailError(`Could not build the email: ${(e as Error).message}`, false); }
    const final = this.fileFor(m.messageId);
    const tmp = `${final}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, raw);
      fs.renameSync(tmp, final);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {  }
      throw new MailError(`Could not write to the test outbox: ${(e as Error).message}`, true);
    }
    return { messageId: m.messageId };
  }
  async wasSent(messageId: string) { return fs.existsSync(this.fileFor(messageId)); }
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  dailyLimit?: number;
}

const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTOCOL']);
const QUOTA_TEXT = /quota|daily (user )?sending|sending limit|limit exceeded|rate limit|too many (messages|emails|mails)/i;

export function classifySmtpError(err: unknown): MailError {
  if (err instanceof MailError) return err;
  const e = (err ?? {}) as { responseCode?: number; code?: string; message?: string; response?: string };
  const detail = (e.response || e.message || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (e.code === 'EAUTH') return new MailError('The mail server rejected the username or password. Check Settings > Sending.', false);
  const code = e.responseCode;
  if (typeof code === 'number') {
    const quota = QUOTA_TEXT.test(detail);
    if (code >= 400 && code < 500) return new MailError(`Mail server asked to try later (${code}): ${detail}`, true, quota);
    if (code >= 500 && quota) return new MailError(`Mail server sending limit reached (${code}): ${detail}`, true, true);
    if (code >= 500) return new MailError(`Mail server rejected the message (${code}): ${detail}`, false);
  }
  if (e.code && TRANSIENT_CODES.has(e.code)) return new MailError(`Could not reach the mail server (${e.code}).`, true);
  if (e.code === 'ETLS') return new MailError('Secure connection to the mail server failed. Check the port and the "secure" setting (465 = TLS, 587 = STARTTLS).', false);
  return new MailError(detail || 'Unknown mail error', false);
}

export class SmtpTransport implements MailTransport {
  name = 'smtp' as const;
  dailyLimit?: number;
  private tx: nodemailer.Transporter;
  constructor(private s: SmtpSettings) {
    this.dailyLimit = s.dailyLimit;
    this.tx = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined,
      requireTLS: !s.secure && s.port === 587,
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  async send(m: OutboundMail) {
    try {
      await this.tx.sendMail(mailOptions(m, m.from ?? this.s.from));
      return { messageId: m.messageId };
    } catch (err) {
      throw classifySmtpError(err);
    }
  }
  async wasSent(): Promise<'unknown'> { return 'unknown'; }
  async verify() {
    try { await this.tx.verify(); } catch (err) { throw classifySmtpError(err); }
  }
  close() { this.tx.close(); }
}

export interface GmailOptions {
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  from: string;
  fetchImpl?: typeof fetch;
  dailyLimit?: number;
}

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function gmailFrom(requested: string | undefined, organizer: string): string {
  if (!requested) return organizer;
  const parsed = addressparser(requested, { flatten: true }) as { name: string; address: string }[];
  const p = parsed[0];
  if (p?.address && p.address.toLowerCase() === organizer.trim().toLowerCase()) return requested;
  return p?.name ? `"${p.name.replace(/["\\]/g, '')}" <${organizer}>` : organizer;
}

export class GmailTransport implements MailTransport {
  name = 'gmail' as const;
  dailyLimit?: number;
  constructor(private o: GmailOptions) {
    this.dailyLimit = o.dailyLimit ?? (/@(gmail|googlemail)\.com$/i.test(o.from) ? 500 : 2000);
  }

  private async token(force: boolean): Promise<string> {
    try {
      return await this.o.getAccessToken(force);
    } catch (e) {
      if (e instanceof MailError) throw e;
      const msg = (e as Error)?.message ?? String(e);
      if (/invalid_grant|revoked|expired|unauthori[sz]ed|not connected/i.test(msg)) {
        throw new MailError('Gmail sign-in expired. Please reconnect Google in Settings.', false);
      }
      throw new MailError(`Could not refresh the Gmail sign-in: ${msg}`, true);
    }
  }

  async send(m: OutboundMail) {
    let raw: string;
    try {
      raw = (await buildMime({ ...m, from: gmailFrom(m.from, this.o.from) })).toString('base64url');
    } catch (e) {
      throw new MailError(`Could not build the email: ${(e as Error).message}`, false);
    }
    const f = this.o.fetchImpl ?? fetch;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0);
      let res: Response;
      try {
        res = await f(GMAIL_SEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });
      } catch (e) {
        throw new MailError(`Could not reach Gmail: ${(e as Error).message}`, true);
      }
      if (res.ok) {
        try { await res.json(); } catch {  }
        return { messageId: m.messageId };
      }
      if (res.status === 401 && attempt === 0) continue;
      throw await classifyGmailError(res);
    }
    throw new MailError('Gmail sign-in expired. Please reconnect Google in Settings.', false);
  }
  async wasSent(): Promise<'unknown'> { return 'unknown'; }
}

const GMAIL_QUOTA_REASONS = new Set(['ratelimitexceeded', 'userratelimitexceeded', 'dailylimitexceeded', 'quotaexceeded', 'rate_limit_exceeded', 'resource_exhausted']);

export async function classifyGmailError(res: Response): Promise<MailError> {
  const reasons: string[] = [];
  let message = '';
  try {
    const j = (await res.json()) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
    };
    for (const e of j.error?.errors ?? []) if (e.reason) reasons.push(e.reason);
    for (const d of j.error?.details ?? []) if (d.reason) reasons.push(d.reason);
    if (j.error?.status) reasons.push(j.error.status);
    message = j.error?.message ?? '';
  } catch {  }
  const quotaReason = reasons.find((r) => GMAIL_QUOTA_REASONS.has(r.toLowerCase()));
  if (res.status === 429 || (res.status === 403 && quotaReason)) {
    return new MailError(`Gmail sending limit reached (${quotaReason || res.status}). The rest will continue later.`, true, true);
  }
  if (res.status >= 500 || res.status === 408) return new MailError(`Gmail is temporarily unavailable (${res.status}).`, true);
  if (res.status === 401 || res.status === 403) return new MailError('Facilify is not allowed to send from this Gmail. Reconnect Google in Settings.', false);
  return new MailError(`Gmail rejected the message (${res.status})${message ? `: ${message}` : '.'}`, false);
}
