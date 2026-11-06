import crypto from 'node:crypto';
import type { DB } from '@/lib/db/db';
import { deleteSetting, getSetting, setSetting } from '@/lib/db/repo';
import { baseUrl } from '@/lib/paths';
import { hmac, safeEqual } from '@/lib/secrets/crypto';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
];

export const REQUIRED_SEND_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
];

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  return `${baseUrl()}/api/auth/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export function newOAuthState(now = Date.now()): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const exp = Math.floor(now / 1000) + 10 * 60;
  return { state: `${nonce}.${exp}.${hmac('oauth-state', `${nonce}.${exp}`)}`, nonce };
}

export function readOAuthState(state: string | null | undefined, cookieNonce: string | null | undefined, now = Date.now()): boolean {
  if (!state || !cookieNonce || state.length > 200) return false;
  const [nonce, exp, sig] = state.split('.');
  if (!nonce || !exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (!safeEqual(sig, hmac('oauth-state', `${nonce}.${exp}`))) return false;
  if (Number(exp) * 1000 <= now) return false;
  return safeEqual(nonce, cookieNonce);
}

export interface GoogleTokens { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string }

export class GoogleAuthError extends Error {
  constructor(message: string, public status = 502) { super(message); this.name = 'GoogleAuthError'; }
}

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<GoogleTokens> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new GoogleAuthError(`Google sign-in failed (${res.status}). Please try again.`);
  return (await res.json()) as GoogleTokens;
}

export function idTokenClaims(idToken: string, now = Date.now()): { sub: string; email: string; email_verified?: boolean } {
  let claims: { sub?: unknown; email?: unknown; email_verified?: unknown; aud?: unknown; iss?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    throw new GoogleAuthError('Google returned an unreadable sign-in token.');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (clientId && claims.aud !== clientId) throw new GoogleAuthError('That Google sign-in was issued for a different app.', 403);
  if (typeof claims.iss === 'string' && claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new GoogleAuthError('Google sign-in token has an unexpected issuer.', 403);
  if (typeof claims.exp === 'number' && claims.exp * 1000 < now) throw new GoogleAuthError('Google sign-in token has expired. Please try again.', 401);
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string') throw new GoogleAuthError('Google did not return an email address.');
  return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified === true || claims.email_verified === 'true' };
}

export function missingScopes(granted: string | undefined): string[] {
  const have = new Set((granted ?? '').split(/\s+/).filter(Boolean));
  return REQUIRED_SEND_SCOPES.filter((s) => !have.has(s));
}

const accessCache = new Map<string, { token: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

export async function googleAccessToken(db: DB, organizerId: string, force = false, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cached = accessCache.get(organizerId);
  if (!force && cached && cached.exp > Date.now() + 60_000) return cached.token;
  const pending = inflight.get(organizerId);
  if (pending) return pending;
  const p = (async () => {
    const refresh = getSetting<string>(db, organizerId, 'google.refresh_token');
    if (!refresh) throw new GoogleAuthError('Google is not connected. Sign in with Google in Settings.', 401);
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', refresh_token: refresh, grant_type: 'refresh_token' }),
    });
    if (!res.ok) {
      accessCache.delete(organizerId);
      throw new GoogleAuthError('Google access expired. Please reconnect Google in Settings.', 401);
    }
    const t = (await res.json()) as GoogleTokens;
    accessCache.set(organizerId, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  })().finally(() => inflight.delete(organizerId));
  inflight.set(organizerId, p);
  return p;
}

export function storeGoogleTokens(db: DB, organizerId: string, email: string, tokens: GoogleTokens) {
  const missing = missingScopes(tokens.scope ?? GOOGLE_SCOPES.join(' '));
  if (missing.length) {
    throw new GoogleAuthError('Facilify needs permission to send email and save files to Drive. Sign in again and keep every box ticked.', 400);
  }
  if (tokens.refresh_token) setSetting(db, organizerId, 'google.refresh_token', tokens.refresh_token, true);
  setSetting(db, organizerId, 'google.email', email);
  setSetting(db, organizerId, 'google.scopes', (tokens.scope ?? GOOGLE_SCOPES.join(' ')).split(/\s+/).filter((s) => GOOGLE_SCOPES.includes(s)).join(' '));
  accessCache.set(organizerId, { token: tokens.access_token, exp: Date.now() + tokens.expires_in * 1000 });
}

export function googleConnected(db: DB, organizerId: string): boolean {
  return !!getSetting(db, organizerId, 'google.refresh_token');
}

export async function disconnectGoogle(db: DB, organizerId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let refresh: string | undefined;
  try { refresh = getSetting<string>(db, organizerId, 'google.refresh_token'); } catch {  }
  for (const k of ['google.refresh_token', 'google.email', 'google.scopes']) deleteSetting(db, organizerId, k);
  accessCache.delete(organizerId);
  if (refresh) {
    try {
      await fetchImpl('https://oauth2.googleapis.com/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }),
      });
    } catch {  }
  }
}
