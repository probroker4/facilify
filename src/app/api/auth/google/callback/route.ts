import crypto from 'node:crypto';
import { get, nowIso, run } from '@/lib/db/db';
import { getSetting, setSetting, type OrganizerRow } from '@/lib/db/repo';
import { exchangeCode, GOOGLE_SCOPES, googleConfigured, idTokenClaims, missingScopes, storeGoogleTokens } from '@/lib/auth/google';
import { cookieFrom, createSession, isAllowed, isSecureRequest, mayUseGoogleAccount, safeNextPath, sessionOrganizer } from '@/lib/auth/session';
import { safeEqual } from '@/lib/secrets/crypto';
import { baseUrl } from '@/lib/paths';
import { withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

function back(path: string, extra: string[] = []): Response {
  const res = new Response(null, { status: 302, headers: { Location: new URL(path, baseUrl()).toString() } });
  for (const h of extra) res.headers.append('Set-Cookie', h);
  return res;
}
const clearOauth = ['cf_oauth', 'cf_oauth_next'].map((n) => `${n}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`);

export const GET = withApi(async ({ req, db }) => {
  const url = new URL(req.url);
  if (!googleConfigured()) return back('/login?error=google-not-configured');
  if (url.searchParams.get('error')) return back('/login?error=google-cancelled', clearOauth);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const saved = cookieFrom(req, 'cf_oauth') ?? '';
  if (!code || !state || !saved || !safeEqual(state, saved)) return back('/login?error=google-state', clearOauth);
  const next = safeNextPath(cookieFrom(req, 'cf_oauth_next'), '/');

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch {
    return back('/login?error=google-failed', clearOauth);
  }
  if (!tokens.id_token) return back('/login?error=google-failed', clearOauth);
  if (missingScopes(tokens.scope ?? GOOGLE_SCOPES.join(' ')).length) return back('/login?error=google-scopes', clearOauth);
  const claims = idTokenClaims(tokens.id_token);
  const email = String(claims.email ?? '').toLowerCase();

  const current = sessionOrganizer(db, req);
  let org: OrganizerRow | undefined = current ?? undefined;
  if (!org) {
    if (!mayUseGoogleAccount(db, email, claims.email_verified === true)) return back('/login?error=google-not-allowed', clearOauth);
    org = get<OrganizerRow>(db, 'SELECT * FROM organizers WHERE google_sub = ? OR email = ? COLLATE NOCASE', claims.sub, email);
    if (!org) {
      const id = `org_${crypto.randomBytes(9).toString('base64url')}`;
      run(db, 'INSERT INTO organizers (id, email, name, password_hash, google_sub, active, created_at) VALUES (?, ?, ?, NULL, ?, 1, ?)',
        id, email, email.split('@')[0], claims.sub, nowIso());
      setSetting(db, id, 'org', { name: 'My event team', email, linkedInEnabled: true });
      setSetting(db, id, 'sender', { kind: 'capture' });
      setSetting(db, id, 'storage', 'local');
      org = get<OrganizerRow>(db, 'SELECT * FROM organizers WHERE id = ?', id)!;
    }
  }
  if (!org.google_sub) run(db, 'UPDATE organizers SET google_sub = ? WHERE id = ?', claims.sub, org.id);
  org = get<OrganizerRow>(db, 'SELECT * FROM organizers WHERE id = ?', org.id)!;
  if (!isAllowed(org)) return back('/login?error=google-not-allowed', clearOauth);
  storeGoogleTokens(db, org.id, email, tokens);
  if (getSetting(db, org.id, 'org') === undefined) setSetting(db, org.id, 'org', { name: 'My event team', email, linkedInEnabled: true });

  const { headers } = createSession(org.id, isSecureRequest(req));
  return back(current ? '/settings?google=connected' : next, [...headers, ...clearOauth]);
}, { auth: false });
