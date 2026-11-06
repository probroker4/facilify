import { NextResponse, type NextRequest } from 'next/server';
import { openDb } from '@/lib/db/db';
import { checkSessionValue, SESSION_COOKIE } from '@/lib/auth/session';
import { checkRateLimit, clientKey } from '@/lib/auth/ratelimit';
import { isPublicPath, normalizePath, RATE_LIMITED_POSTS } from '@/lib/auth/routes';
import { baseUrl } from '@/lib/paths';

const isDev = process.env.NODE_ENV !== 'production';

function csp(): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: blob: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function applySecurityHeaders(res: NextResponse, req: NextRequest): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.headers.set('Content-Security-Policy', csp());
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? req.nextUrl.protocol.replace(':', '');
  if (proto === 'https') res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return res;
}

function jsonError(req: NextRequest, status: number, error: string, extra?: Record<string, string>): NextResponse {
  const res = NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
  return applySecurityHeaders(res, req);
}

function sameSiteOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return origin !== 'null';
  let host: string;
  try { host = new URL(origin).host; } catch { return false; }
  const allowed = new Set<string>();
  const own = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host');
  if (own) allowed.add(own.toLowerCase());
  try { allowed.add(new URL(baseUrl()).host.toLowerCase()); } catch {  }
  return allowed.has(host.toLowerCase());
}

export function middleware(req: NextRequest) {
  const pathname = normalizePath(req.nextUrl.pathname);
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  const method = req.method.toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  if (isApi && unsafe && !sameSiteOrigin(req)) {
    return jsonError(req, 403, 'This request came from another website and was blocked.');
  }

  if (method === 'POST') {
    const rule = RATE_LIMITED_POSTS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
    if (rule) {
      const r = checkRateLimit(`${rule.prefix}|${clientKey(req.headers)}`, rule.max, rule.windowMs);
      if (!r.allowed) {
        return jsonError(req, 429, 'Too many attempts. Please wait a few minutes and try again.', { 'Retry-After': String(r.retryAfterSeconds) });
      }
    }
  }

  if (isPublicPath(pathname)) return applySecurityHeaders(NextResponse.next(), req);

  let check;
  try {
    check = checkSessionValue(openDb(), req.cookies.get(SESSION_COOKIE)?.value);
  } catch (e) {
    console.error('[middleware] session check failed', e instanceof Error ? e.message : e);
    return isApi ? jsonError(req, 503, 'The service is starting up. Please try again in a moment.') : new NextResponse('Service unavailable', { status: 503 });
  }

  if (check.ok) {
    const res = NextResponse.next();
    if (isApi) res.headers.set('Cache-Control', 'no-store');
    return applySecurityHeaders(res, req);
  }

  if (isApi) return jsonError(req, check.status, check.message);

  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  if (pathname !== '/') login.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
  if (check.status === 403) login.searchParams.set('reason', 'not-allowed');
  const res = NextResponse.redirect(login);
  if (req.cookies.get(SESSION_COOKIE)) res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  return applySecurityHeaders(res, req);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
