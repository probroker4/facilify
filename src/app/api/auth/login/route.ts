import { get } from '@/lib/db/db';
import type { OrganizerRow } from '@/lib/db/repo';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, isAllowed, isSecureRequest, passwordLoginEnabled } from '@/lib/auth/session';
import { HttpError } from '@/lib/auth/session';
import { badRequest, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db }) => {
  if (!passwordLoginEnabled()) throw new HttpError(403, 'Password sign-in is turned off. Please use Sign in with Google.');
  const body = await readJsonBody<{ email?: string; password?: string }>(req);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) throw badRequest('Please enter your email and password.');
  const org = get<OrganizerRow>(db, 'SELECT * FROM organizers WHERE email = ? COLLATE NOCASE', email);
  if (!org || !verifyPassword(password, org.password_hash)) throw new HttpError(401, 'That email and password do not match. Please try again.');
  if (!isAllowed(org)) throw new HttpError(403, 'This account is not allowed to use Facilify. Ask an organizer to add you.');
  const { headers } = createSession(org.id, isSecureRequest(req));
  const res = Response.json({ ok: true, organizer: { id: org.id, email: org.email, name: org.name } });
  for (const h of headers) res.headers.append('Set-Cookie', h);
  return res;
}, { auth: false });
