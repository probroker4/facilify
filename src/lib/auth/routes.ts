export const PUBLIC_API_PREFIXES = ['/api/auth', '/api/public', '/api/verify', '/api/health'] as const;
export const PUBLIC_PAGE_PREFIXES = ['/login', '/setup', '/verify', '/report', '/linkedin'] as const;
const PUBLIC_STATIC = ['/favicon.ico', '/icon.svg', '/robots.txt', '/_next'] as const;

export function normalizePath(pathname: string): string {
  let p = pathname.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isPublicApi(pathname: string): boolean {
  const p = normalizePath(pathname);
  return PUBLIC_API_PREFIXES.some((x) => underPrefix(p, x));
}

export function isPublicPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  if (p === '/api' || p.startsWith('/api/')) return isPublicApi(p);
  return PUBLIC_PAGE_PREFIXES.some((x) => underPrefix(p, x)) || PUBLIC_STATIC.some((x) => underPrefix(p, x));
}

export const RATE_LIMITED_POSTS: { prefix: string; max: number; windowMs: number }[] = [
  { prefix: '/api/auth/login', max: 15, windowMs: 10 * 60_000 },
  { prefix: '/api/auth/signin', max: 15, windowMs: 10 * 60_000 },
  { prefix: '/api/auth/setup', max: 10, windowMs: 10 * 60_000 },
  { prefix: '/api/public/tickets', max: 30, windowMs: 10 * 60_000 },
];
