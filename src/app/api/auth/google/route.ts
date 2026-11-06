import crypto from 'node:crypto';
import { googleAuthUrl, googleConfigured } from '@/lib/auth/google';
import { isSecureRequest, safeNextPath } from '@/lib/auth/session';
import { baseUrl } from '@/lib/paths';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ req }) => {
  const url = new URL(req.url);
  if (!googleConfigured()) {
    return Response.redirect(new URL('/login?error=google-not-configured', baseUrl()), 302);
  }
  const state = crypto.randomBytes(18).toString('base64url');
  const next = safeNextPath(url.searchParams.get('next'), '/');
  const res = new Response(null, { status: 302, headers: { Location: googleAuthUrl(state) } });
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.headers.append('Set-Cookie', `cf_oauth=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  res.headers.append('Set-Cookie', `cf_oauth_next=${encodeURIComponent(next)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  return res;
}, { auth: false });
