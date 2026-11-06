import { deleteSetting, getSetting, setSetting } from '@/lib/db/repo';
import { googleConfigured } from '@/lib/auth/google';
import { isValidEmail } from '@/lib/ingest/validate';
import { orgSettings, senderSettings, type SenderKind } from '@/lib/pipeline/services';
import { DEFAULT_FOLDER_PATTERN } from '@/lib/storage';
import { badRequest, plainText, readJsonBody, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

interface SmtpIn { host?: string; port?: number | string; secure?: boolean; user?: string; from?: string; dailyLimit?: number | string; pass?: string; clearPassword?: boolean }
interface Body {
  org?: { name?: string; email?: string; linkedInOrgId?: string; linkedInEnabled?: boolean };
  sender?: { kind?: SenderKind };
  smtp?: SmtpIn;
  storage?: string;
  folderPattern?: string;
}

export const GET = withApi(async ({ db, org }) => {
  const sender = senderSettings(db, org.id);
  const smtp = sender.smtp;
  return {
    org: orgSettings(db, org.id),
    sender: { kind: sender.kind },
    smtp: smtp
      ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user ?? '', from: smtp.from, dailyLimit: smtp.dailyLimit ?? null, hasPassword: !!getSetting(db, org.id, 'smtp.pass') }
      : { host: '', port: 587, secure: false, user: '', from: org.email, dailyLimit: null, hasPassword: false },
    storage: getSetting<string>(db, org.id, 'storage') ?? 'local',
    folderPattern: getSetting<string>(db, org.id, 'folderPattern') ?? DEFAULT_FOLDER_PATTERN,
    google: {
      configured: googleConfigured(),
      connected: !!getSetting(db, org.id, 'google.refresh_token'),
      email: getSetting<string>(db, org.id, 'google.email') ?? null,
    },
    accountEmail: org.email,
  };
});

export const PUT = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<Body>(req);
  const connected = !!getSetting(db, org.id, 'google.refresh_token') && googleConfigured();

  if (body.org) {
    const name = plainText(body.org.name, 120);
    if (!name) throw badRequest('Please enter your organization name. It appears on certificates and emails.');
    const email = plainText(body.org.email, 200);
    if (email && !isValidEmail(email)) throw badRequest('The reply-to email address does not look right.');
    const li = plainText(body.org.linkedInOrgId, 20);
    if (li && !/^\d{1,15}$/.test(li)) throw badRequest('The LinkedIn company ID is a number (find it in the address of your LinkedIn page admin view). Leave it empty if unsure.');
    setSetting(db, org.id, 'org', { name, email: email || org.email, linkedInOrgId: li || undefined, linkedInEnabled: body.org.linkedInEnabled !== false });
  }

  if (body.smtp) {
    const s = body.smtp;
    const host = plainText(s.host, 200);
    const port = Number(s.port);
    const from = plainText(s.from, 200);
    if (host || body.sender?.kind === 'smtp') {
      if (!host) throw badRequest('Enter the mail server name, for example smtp.gmail.com.');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest('The port must be a number such as 587 or 465.');
      if (!from || !/@/.test(from)) throw badRequest('Enter the address the emails are sent from.');
      const limit = s.dailyLimit === '' || s.dailyLimit == null ? undefined : Number(s.dailyLimit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw badRequest('The daily limit must be a whole number, or empty for no limit.');
      const current = senderSettings(db, org.id);
      setSetting(db, org.id, 'sender', {
        kind: body.sender?.kind ?? current.kind,
        smtp: { host, port, secure: s.secure ?? port === 465, user: plainText(s.user, 200) || undefined, from, dailyLimit: limit },
      });
      if (typeof s.pass === 'string' && s.pass) setSetting(db, org.id, 'smtp.pass', s.pass, true);
      if (s.clearPassword) deleteSetting(db, org.id, 'smtp.pass');
    }
  }

  if (body.sender?.kind) {
    const kind = body.sender.kind;
    if (!['capture', 'smtp', 'gmail'].includes(kind)) throw badRequest('Unknown way of sending email.');
    const current = senderSettings(db, org.id);
    if (kind === 'smtp' && !current.smtp) throw badRequest('Fill in the mail server details first, then choose "Email server (SMTP)".');
    if (kind === 'gmail' && !connected) throw badRequest('Connect your Google account first, then choose Gmail.');
    setSetting(db, org.id, 'sender', { ...current, kind });
  }

  if (body.storage !== undefined) {
    if (!['local', 'drive', 'none'].includes(body.storage)) throw badRequest('Unknown place to save certificates.');
    if (body.storage === 'drive' && !connected) throw badRequest('Connect your Google account first, then choose Google Drive.');
    setSetting(db, org.id, 'storage', body.storage);
  }

  if (body.folderPattern !== undefined) {
    const p = plainText(body.folderPattern, 200);
    if (!p) throw badRequest('The folder layout cannot be empty. The default is ' + DEFAULT_FOLDER_PATTERN);
    setSetting(db, org.id, 'folderPattern', p);
  }
  return { ok: true };
});
