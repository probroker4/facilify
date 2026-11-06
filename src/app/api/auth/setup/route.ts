import crypto from 'node:crypto';
import { get, nowIso, run } from '@/lib/db/db';
import { setSetting } from '@/lib/db/repo';
import { hashPassword, passwordProblem } from '@/lib/auth/password';
import { createSession, isSecureRequest, passwordLoginEnabled } from '@/lib/auth/session';
import { isValidEmail } from '@/lib/ingest/validate';
import { HttpError } from '@/lib/auth/session';
import { badRequest, conflict, plainText, readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db }) => {
  if (!passwordLoginEnabled()) throw new HttpError(403, 'Accounts are created by signing in with Google.');
  const body = await readJsonBody<{ email?: string; password?: string; name?: string; organizationName?: string }>(req);
  const count = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM organizers')?.n ?? 0;
  if (count > 0) throw conflict('Facilify is already set up. Please sign in instead.');
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) throw badRequest('Please enter a valid email address.');
  const problem = passwordProblem(String(body.password ?? ''));
  if (problem) throw badRequest(problem);
  const name = plainText(body.name, 80) || 'Organizer';
  const orgName = plainText(body.organizationName, 120) || 'My event team';

  const id = `org_${crypto.randomBytes(9).toString('base64url')}`;
  run(db, 'INSERT INTO organizers (id, email, name, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    id, email, name, hashPassword(String(body.password)), nowIso());
  setSetting(db, id, 'org', { name: orgName, email, linkedInEnabled: true });
  setSetting(db, id, 'sender', { kind: 'capture' });
  setSetting(db, id, 'storage', 'local');

  const { headers } = createSession(id, isSecureRequest(req));
  const res = Response.json({ ok: true, organizer: { id, email, name } });
  for (const h of headers) res.headers.append('Set-Cookie', h);
  return res;
}, { auth: false });
