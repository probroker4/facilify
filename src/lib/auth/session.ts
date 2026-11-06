import { get, type DB } from '@/lib/db/db';
import type { OrganizerRow } from '@/lib/db/repo';
import { hmac, safeEqual } from '@/lib/secrets/crypto';

export const SESSION_COOKIE = 'cf_session';
const MAX_AGE = 60 * 60 * 24 * 7;

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function signSession(organizerId: string, now = Date.now()): string {
  if (!ID_RE.test(organizerId)) throw new Error('Invalid organizer id for a session.');
  const exp = Math.floor(now / 1000) + MAX_AGE;
  return `${organizerId}.${exp}.${hmac('session', `${organizerId}.${exp}`)}`;
}

export function readSessionValue(value: string | undefined | null, now = Date.now()): string | null {
  if (!value || value.length > 300) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!ID_RE.test(id) || !/^\d{1,12}$/.test(exp)) return null;
  if (!safeEqual(sig, hmac('session', `${id}.${exp}`))) return null;
  const expMs = Number(exp) * 1000;
  if (expMs <= now || expMs > now + (MAX_AGE + 60) * 1000) return null;
  return id;
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto) return proto === 'https';
  try { return new URL(req.url).protocol === 'https:'; } catch { return false; }
}

export function cookieFrom(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try { return decodeURIComponent(raw); } catch { return null; }
    }
  }
  return null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function allowedEmails(): string[] {
  return (process.env.ORGANIZER_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function passwordLoginEnabled(): boolean {
  return process.env.CERTFLOW_PASSWORD_LOGIN === '1';
}

export function openSignin(): boolean {
  return process.env.CERTFLOW_OPEN_SIGNIN === '1';
}

export function isAllowed(org: Pick<OrganizerRow, 'active' | 'email' | 'google_sub'>): boolean {
  if (!org || Number(org.active) !== 1) return false;
  const list = allowedEmails();
  if (org.google_sub && list.length && !list.includes(String(org.email).toLowerCase())) return false;
  return true;
}

export function mayUseGoogleAccount(db: DB, email: string, emailVerified: boolean): boolean {
  if (!emailVerified || !email) return false;
  const e = email.trim().toLowerCase();
  const list = allowedEmails();
  if (list.length) return list.includes(e);
  if (openSignin()) return true;
  const existing = get<{ active: number }>(db, 'SELECT active FROM organizers WHERE email = ? COLLATE NOCASE', e);
  if (existing) return Number(existing.active) === 1;
  const count = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM organizers')?.n ?? 0;
  return count === 0;
}

export function createSession(organizerId: string, secure = false): { cookieValue: string; header: string; headers: string[] } {
  const value = signSession(organizerId);
  const header = sessionCookieHeader(value, secure);
  return { cookieValue: value, header, headers: [header] };
}

export function clearSession(): string[] {
  return [clearSessionCookieHeader()];
}

export type SessionCheck =
  | { ok: true; org: OrganizerRow }
  | { ok: false; status: 401 | 403; message: string };

export function checkSessionValue(db: DB, cookieValue: string | null | undefined): SessionCheck {
  const id = readSessionValue(cookieValue);
  if (!id) return { ok: false, status: 401, message: 'Please sign in.' };
  const org = get<OrganizerRow>(db, 'SELECT * FROM organizers WHERE id = ?', id);
  if (!org) return { ok: false, status: 401, message: 'Please sign in again.' };
  if (!isAllowed(org)) return { ok: false, status: 403, message: 'This account is not allowed to use Facilify. Ask an organizer to add you.' };
  return { ok: true, org };
}

export function sessionOrganizer(db: DB, req: Request): OrganizerRow | null {
  const r = checkSessionValue(db, cookieFrom(req, SESSION_COOKIE));
  return r.ok ? r.org : null;
}

export function requireOrganizer(db: DB, req: Request): OrganizerRow {
  const r = checkSessionValue(db, cookieFrom(req, SESSION_COOKIE));
  if (!r.ok) throw new HttpError(r.status, r.message);
  return r.org;
}

export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string' || next.length > 2000) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\u0000-\u001f\\]/.test(next)) return fallback;
  try {
    const u = new URL(next, 'http://certflow.invalid');
    if (u.origin !== 'http://certflow.invalid') return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
