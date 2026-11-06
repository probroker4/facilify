import crypto from 'node:crypto';
import fs from 'node:fs';
import http1 from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import {
  ROOT, Failure, cleanDist, exportedMethods, http, must, ok, rmrf, routeUrl, sessionCookie, startServer, tempDir, walk,
  type Reply, type RunningServer,
} from '../../fixtures/security/harness';

const SECRET = 'security-oracle-secret-0123456789abcdef0123456789';
const PORT = 3103;
const DIST = '.next-security';
const FAKE_GOOGLE = path.join(ROOT, 'fixtures', 'security', 'fake-google.mjs');

const PUBLIC_API = ['/api/auth', '/api/public', '/api/verify', '/api/health'];
const PUBLIC_PAGES = ['/login', '/setup', '/verify', '/report', '/linkedin'];
const underPrefix = (p: string, prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(`${x}/`));

type Lib = {
  db: typeof import('../../src/lib/db/db');
  session: typeof import('../../src/lib/auth/session');
  password: typeof import('../../src/lib/auth/password');
  crypto: typeof import('../../src/lib/secrets/crypto');
  google: typeof import('../../src/lib/auth/google');
  uploads: typeof import('../../src/lib/secrets/uploads');
  purge: typeof import('../../src/lib/secrets/purge');
  settings: typeof import('../../src/lib/secrets/settings');
  repo: typeof import('../../src/lib/db/repo');
};

async function loadLib(dataDir: string): Promise<Lib> {
  process.env.CERTFLOW_DATA_DIR = dataDir;
  process.env.CERTFLOW_SECRET = SECRET;
  process.env.CERTFLOW_PASSWORD_LOGIN = '1';
  return {
    db: await import('../../src/lib/db/db'),
    session: await import('../../src/lib/auth/session'),
    password: await import('../../src/lib/auth/password'),
    crypto: await import('../../src/lib/secrets/crypto'),
    google: await import('../../src/lib/auth/google'),
    uploads: await import('../../src/lib/secrets/uploads'),
    purge: await import('../../src/lib/secrets/purge'),
    settings: await import('../../src/lib/secrets/settings'),
    repo: await import('../../src/lib/db/repo'),
  };
}

interface OrgSeed { id: string; email: string; active?: number; google_sub?: string | null; password?: string }
function addOrganizer(L: Lib, o: OrgSeed) {
  const db = L.db.openDb();
  L.db.run(db, 'INSERT INTO organizers (id, email, name, password_hash, google_sub, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    o.id, o.email, o.id, o.password ? L.password.hashPassword(o.password) : null, o.google_sub ?? null, o.active ?? 1, L.db.nowIso());
}

function rawGet(port: number, rawPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = http1.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function multipart(fields: { name: string; value?: string; filename?: string; bytes?: Uint8Array; type?: string }[]): { body: Buffer; contentType: string } {
  const boundary = `----cfsec${crypto.randomBytes(8).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const f of fields) {
    const disp = f.filename !== undefined ? `form-data; name="${f.name}"; filename="${f.filename}"` : `form-data; name="${f.name}"`;
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disp}\r\n${f.filename !== undefined ? `Content-Type: ${f.type ?? 'application/octet-stream'}\r\n` : ''}\r\n`, 'latin1'));
    parts.push(f.bytes ? Buffer.from(f.bytes) : Buffer.from(f.value ?? '', 'utf8'));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function allFiles(dir: string): string[] { return walk(dir); }

function filesContain(dir: string, needle: string): string | null {
  const variants = [Buffer.from(needle, 'utf8'), Buffer.from(needle, 'utf16le'), Buffer.from(Buffer.from(needle).toString('base64'), 'utf8')];
  for (const f of allFiles(dir)) {
    let b: Buffer;
    try { b = fs.readFileSync(f); } catch { continue; }
    if (variants.some((v) => b.includes(v))) return f;
  }
  return null;
}

interface RouteInfo { file: string; url: string; methods: string[] }

function enumerateRoutes(): RouteInfo[] {
  const apiDir = path.join(ROOT, 'src', 'app', 'api');
  return walk(apiDir).filter((f) => /[\\/]route\.(ts|tsx|js)$/.test(f)).map((file) => ({
    file, url: routeUrl(file, 'route'), methods: exportedMethods(file),
  })).sort((a, b) => a.url.localeCompare(b.url));
}

function routeSource(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return '';
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  let all = src;
  for (const m of src.matchAll(/export\s*(?:\{[^}]*\}|\*)\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const t = ['.ts', '/route.ts'].map((e) => path.resolve(path.dirname(file), m[1] + e)).find((p) => fs.existsSync(p));
    if (t) all += '\n' + routeSource(t, seen);
  }
  return all;
}

function sessionSet(r: Reply): string[] {
  return r.setCookies.filter((c) => /^(cf_session|cf_sess)=[^;]+/.test(c));
}

async function caseAuthz() {
  console.log('--- authz: every /api route needs a session ---');
  const routes = enumerateRoutes();
  must(routes.length >= 5, `found only ${routes.length} API routes under src/app/api`);
  const isPublicRoute = (r: RouteInfo) => underPrefix(r.url, PUBLIC_API);
  const protectedRoutes = routes.filter((r) => !isPublicRoute(r));
  const publicRoutes = routes.filter(isPublicRoute);
  ok(`enumerated ${routes.length} routes (${protectedRoutes.length} protected, ${publicRoutes.length} public)`);

  const unguarded: string[] = [];
  for (const r of protectedRoutes) {
    const src = routeSource(r.file);
    const guarded = /requireOrganizer\s*\(|\bauth\s*\(\s*req|withApi\s*[(<]|sessionOrganizer\s*\(/.test(src);
    const bypass = /optionalAuth\s*\(|getOrCreateDemoOrganizer\s*\(/.test(src);
    const staticOnly = !guarded && !/openDb|\bfs\b|node:fs|readUpload|formData\s*\(|\.json\s*\(|\.text\s*\(|sqlite|getSetting|process\.env/.test(src);
    if (staticOnly) { console.log(`  note ${r.url} serves fixed content; guarded by the middleware only`); continue; }
    if (!guarded || bypass) unguarded.push(`${r.url} (${path.relative(ROOT, r.file)}): ${bypass ? 'uses optionalAuth/demo-organizer fallback instead of requireOrganizer' : 'no requireOrganizer call'}`);
  }
  must(unguarded.length === 0, `protected routes whose handler does not enforce a session:\n    ${unguarded.join('\n    ')}`);
  ok('every protected route handler calls requireOrganizer (no optionalAuth / demo fallback)');

  const dataDir = tempDir('cf-sec-authz-');
  const L = await loadLib(dataDir);
  const A = 'org_alice', B = 'org_stranger', C = 'org_inactive', D = 'org_gdrive', E = 'org_alice_clone';
  addOrganizer(L, { id: A, email: 'alice@certflow.test', password: 'correct horse battery' });
  addOrganizer(L, { id: B, email: 'stranger@gmail.test', google_sub: 'g-stranger' });
  addOrganizer(L, { id: C, email: 'inactive@certflow.test', active: 0, password: 'correct horse battery' });
  addOrganizer(L, { id: D, email: 'allowed@certflow.test', google_sub: 'g-allowed' });
  const cookieOf = (id: string) => sessionCookie(L.session.signSession(id));
  const cA = cookieOf(A), cB = cookieOf(B), cC = cookieOf(C), cD = cookieOf(D);
  const goodSig = L.session.signSession(A);
  const [, expPart, sigPart] = goodSig.split('.');
  const forged: Record<string, string> = {
    'garbage': 'cf_session=not-a-session',
    'empty': 'cf_session=',
    'wrong signature': `cf_session=${A}.${expPart}.${sigPart.split('').reverse().join('')}`,
    'swapped organizer id (A signature on C)': `cf_session=${C}.${expPart}.${sigPart}`,
    'expired': `cf_session=${L.session.signSession(A, Date.now() - 9 * 24 * 3600 * 1000)}`,
    'valid signature, organizer does not exist': cookieOf('org_ghost'),
    'legacy cf_sess cookie': `cf_sess=${L.session.signSession(A)}`,
  };

  const server = await startServer({
    port: PORT, distDir: DIST, dataDir,
    env: { CERTFLOW_SECRET: SECRET, ORGANIZER_EMAILS: 'allowed@certflow.test', GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined },
  });
  try {
    const body = (m: string) => (m === 'POST' || m === 'PUT' || m === 'PATCH' ? { json: {} } : {});
    let probes = 0;
    const deferred: string[] = [];

    for (const r of protectedRoutes) {
      const methods = r.methods.length ? r.methods : ['GET'];
      for (const m of methods) {
        const label = `${m} ${r.url}`;
        const none = await http(server.base, r.url, { method: m, ...body(m) });
        probes++;
        must(none.status === 401, `${label} without a session returned ${none.status}, expected 401`);
        if (m !== 'HEAD') must(typeof none.json?.error === 'string' && none.json.error.length > 0, `${label} 401 body is not {"error": "..."}: ${none.text.slice(0, 120)}`);
        for (const [what, cookie] of Object.entries(forged)) {
          const rep = await http(server.base, r.url, { method: m, cookie, ...body(m) });
          probes++;
          must(rep.status === 401, `${label} with a ${what} cookie returned ${rep.status}, expected 401`);
        }
        for (const [what, cookie] of [['a Google account that is not on the allow-list', cB], ['an inactive organizer', cC]] as const) {
          const rep = await http(server.base, r.url, { method: m, cookie, ...body(m) });
          probes++;
          must(rep.status === 403, `${label} for ${what} returned ${rep.status}, expected 403`);
          if (m !== 'HEAD') must(typeof rep.json?.error === 'string', `${label} 403 body is not {"error": "..."}`);
        }
      }
    }
    ok(`${probes} requests: 401 with no/forged/expired/legacy cookies, 403 for inactive and not-allow-listed accounts on every protected route and method`);

    const meA = await http(server.base, '/api/me', { cookie: cA });
    must(meA.status === 200, `positive control GET /api/me as a valid organizer returned ${meA.status}: ${meA.text.slice(0, 200)}`);
    must(JSON.stringify(meA.json).includes('alice@certflow.test'), 'GET /api/me does not return the signed-in organizer');
    must(!/scrypt\$|password_hash/.test(meA.text), 'GET /api/me leaks the password hash');
    const meD = await http(server.base, '/api/me', { cookie: cD });
    must(meD.status === 200, `an allow-listed Google organizer got ${meD.status} from GET /api/me, expected 200`);
    must((await http(server.base, '/api/me', { cookie: cB })).status === 403, 'not-allow-listed Google account is not refused on /api/me');
    ok('positive control: GET /api/me is 200 for valid and allow-listed organizers');

    const lookalikes = ['/api/authentic', '/api/auth-x', '/api/publicity', '/api/public-x/y', '/api/verifyx', '/api/verify-x/y', '/api/healthz', '/api/health-check', '/api/__probe'];
    for (const p of lookalikes) {
      const rep = await http(server.base, p);
      must(rep.status === 401, `GET ${p} returned ${rep.status}; only the exact public prefixes may skip the session check`);
    }
    for (const p of ['/api/auth/__probe', '/api/public/__probe', '/api/verify/__probe/x', '/api/health']) {
      const rep = await http(server.base, p);
      must(rep.status !== 401 && rep.status !== 403, `GET ${p} should reach the router without a session but returned ${rep.status}`);
    }
    ok('public prefixes are exactly /api/auth, /api/public, /api/verify and /api/health (segment-exact)');

    const tricks = ['/api/public/../batches', '/api/public/%2e%2e/batches', '/api/public%2f..%2fbatches', '/api//batches', '/api/./batches', '/api/batches/', '/API/batches', '/api/batches;x=1', '/api/batches%00', '/api/health/../me', '/api/verify/..%2f..%2fme'];
    for (const p of tricks) {
      const rep = await rawGet(PORT, p);
      must([401, 403, 404, 400, 308, 307].includes(rep.status), `raw GET ${p} returned ${rep.status}; expected a refusal`);
      must(!/"batches"|"organizer"/.test(rep.body), `raw GET ${p} leaked data: ${rep.body.slice(0, 120)}`);
    }
    ok(`${tricks.length} path-trick requests never reach protected data`);

    const sessionLeaks: string[] = [];
    const crashes: string[] = [];
    for (const r of publicRoutes) {
      for (const m of r.methods.length ? r.methods : ['GET']) {
        const variants: { json?: unknown; label: string }[] = m === 'POST' || m === 'PUT' ? [{ json: {}, label: 'empty body' }, { json: { email: 'alice@certflow.test', password: 'wrong password 123' }, label: 'wrong password' }, { json: { email: 'new@certflow.test', password: 'a-new-password-1', name: 'New', organizationName: 'X' }, label: 'self-registration' }] : [{ label: 'no credentials' }];
        for (const v of variants) {
          const rep = await http(server.base, r.url, { method: m, json: v.json, headers: { 'x-forwarded-for': `198.51.100.${(probes++ % 200) + 1}` } });
          if (sessionSet(rep).length && !/=;|Max-Age=0/.test(sessionSet(rep).join(';'))) sessionLeaks.push(`${m} ${r.url} (${v.label}) -> ${rep.status} Set-Cookie`);
          if (rep.status >= 500) crashes.push(`${m} ${r.url} (${v.label}) -> ${rep.status}: ${rep.text.slice(0, 100)}`);
        }
      }
    }
    must(sessionLeaks.length === 0, `public routes issued a session without valid credentials:\n    ${sessionLeaks.join('\n    ')}`);
    must(crashes.length === 0, `public routes crashed (5xx) on anonymous junk input:\n    ${crashes.join('\n    ')}`);
    const orgCount = L.db.get<{ n: number }>(L.db.openDb(), 'SELECT COUNT(*) n FROM organizers')!.n;
    must(orgCount === 4, `an anonymous call created an organizer (organizers: ${orgCount}, expected 4)`);
    ok('no anonymous request to a public route creates an organizer or a session; none crash');

    const loginRoute = publicRoutes.find((r) => r.url === '/api/auth/login' && r.methods.includes('POST'));
    must(loginRoute, 'POST /api/auth/login (API.md) is missing');
    const ip = { 'x-forwarded-for': '203.0.113.50' };
    const bad = await http(server.base, '/api/auth/login', { method: 'POST', json: { email: 'alice@certflow.test', password: 'wrong password!!' }, headers: ip });
    must(bad.status === 401 && !sessionSet(bad).length, `wrong password returned ${bad.status}`);
    const unknown = await http(server.base, '/api/auth/login', { method: 'POST', json: { email: 'nobody@certflow.test', password: 'wrong password!!' }, headers: ip });
    must(unknown.status === 401 && unknown.json?.error === bad.json?.error, 'login must not reveal whether an email exists (different error text)');
    const inactive = await http(server.base, '/api/auth/login', { method: 'POST', json: { email: 'inactive@certflow.test', password: 'correct horse battery' }, headers: ip });
    must(inactive.status === 403 && !sessionSet(inactive).length, `inactive organizer login returned ${inactive.status}, expected 403 with no cookie`);
    const good = await http(server.base, '/api/auth/login', { method: 'POST', json: { email: 'alice@certflow.test', password: 'correct horse battery' }, headers: ip });
    must(good.status === 200 && sessionSet(good).length >= 1, `valid login returned ${good.status} / ${good.setCookies.length} cookies`);
    const sc = good.setCookies.find((c) => c.startsWith('cf_session='))!;
    must(sc && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\//.test(sc), `session cookie must be HttpOnly; SameSite=Lax; Path=/ (got: ${sc})`);
    must(!good.setCookies.some((c) => c.startsWith('cf_sess=')), 'login still sets the legacy cf_sess cookie');
    const jar = `cf_session=${/^cf_session=([^;]+)/.exec(sc)![1]}`;
    must((await http(server.base, '/api/me', { cookie: jar })).status === 200, 'cookie from /api/auth/login does not open /api/me');
    const secure = await http(server.base, '/api/auth/login', { method: 'POST', json: { email: 'alice@certflow.test', password: 'correct horse battery' }, headers: { ...ip, 'x-forwarded-proto': 'https' } });
    must(secure.setCookies.some((c) => /^cf_session=/.test(c) && /;\s*Secure/i.test(c)), 'behind https the session cookie must be Secure');
    ok('login: wrong password 401, unknown email indistinguishable, inactive 403, valid 200 with HttpOnly SameSite=Lax cookie');

    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const rep = await http(server.base, '/api/auth/login', { method: 'POST', json: { email: 'alice@certflow.test', password: `guess-${i}-xxxxxxxx` }, headers: { 'x-forwarded-for': '203.0.113.99' } });
      if (rep.status === 429) { limited++; must(!!rep.headers.get('retry-after'), '429 without Retry-After'); break; }
    }
    must(limited === 1, 'repeated wrong passwords from one address were never rate limited (no 429 within 40 tries)');
    const evil = await http(server.base, '/api/batches', { method: 'POST', cookie: cA, json: { name: 'x' }, headers: { origin: 'https://evil.example' } });
    must(evil.status === 403, `cross-site POST with a valid cookie returned ${evil.status}, expected 403`);
    const nullOrigin = await http(server.base, '/api/batches', { method: 'POST', cookie: cA, json: { name: 'x' }, headers: { origin: 'null' } });
    must(nullOrigin.status === 403, `POST with Origin: null returned ${nullOrigin.status}, expected 403`);
    const same = await http(server.base, '/api/batches', { method: 'POST', cookie: cA, json: { name: 'x' }, headers: { origin: server.base } });
    must(same.status !== 403 || !/another website/.test(same.text), 'same-origin POST was blocked by the origin guard');
    ok('login brute force gets 429 + Retry-After; cross-site state-changing requests are refused');

    const pageFiles = walk(path.join(ROOT, 'src', 'app')).filter((f) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f) && !f.includes(`${path.sep}api${path.sep}`));
    const pages = [...new Set(pageFiles.map((f) => routeUrl(f, 'page')))].sort();
    if (!pages.includes('/login')) deferred.push('there is no /login page, so protected pages have nowhere to redirect to (API.md)');
    for (const p of pages) {
      const isPub = underPrefix(p, PUBLIC_PAGES);
      const anon = await http(server.base, p);
      if (isPub) {
        must(!(anon.status >= 300 && anon.status < 400 && /\/login/.test(anon.location ?? '')), `public page ${p} redirects anonymous visitors to /login`);
      } else {
        must(anon.status >= 300 && anon.status < 400 && /\/login/.test(anon.location ?? ''), `protected page ${p} returned ${anon.status} (${anon.location ?? 'no redirect'}) for an anonymous visitor, expected a redirect to /login`);
        const inact = await http(server.base, p, { cookie: cC });
        must(inact.status >= 300 && inact.status < 400 && /\/login/.test(inact.location ?? ''), `protected page ${p} is open to an inactive organizer (${inact.status})`);
        const withSession = await http(server.base, p, { cookie: cA });
        must(!(withSession.status >= 300 && withSession.status < 400 && /\/login/.test(withSession.location ?? '')) && withSession.status !== 401 && withSession.status !== 403, `protected page ${p} refused a valid session (${withSession.status})`);
      }
    }
    ok(`${pages.length} pages: protected ones redirect to /login for anonymous and inactive users and open with a session`);

    const checkHeaders = (rep: Reply, what: string) => {
      const h = rep.headers;
      must(h.get('x-content-type-options') === 'nosniff', `${what}: missing X-Content-Type-Options: nosniff`);
      must(/deny|sameorigin/i.test(h.get('x-frame-options') ?? ''), `${what}: missing X-Frame-Options`);
      must(/frame-ancestors\s+'none'/.test(h.get('content-security-policy') ?? '') && /default-src\s+'self'/.test(h.get('content-security-policy') ?? '') && /object-src\s+'none'/.test(h.get('content-security-policy') ?? ''), `${what}: weak or missing Content-Security-Policy`);
      must(!!h.get('referrer-policy'), `${what}: missing Referrer-Policy`);
      must(!!h.get('permissions-policy'), `${what}: missing Permissions-Policy`);
      must(!h.get('x-powered-by'), `${what}: X-Powered-By leaks the framework`);
    };
    checkHeaders(await http(server.base, '/api/me'), 'API 401');
    checkHeaders(meA, 'API 200');
    must(/no-store/.test(meA.headers.get('cache-control') ?? ''), 'authenticated API responses must be Cache-Control: no-store');
    checkHeaders(await http(server.base, pages.find((p) => !underPrefix(p, PUBLIC_PAGES)) ?? '/upload'), 'page redirect');
    const pubPage = pages.find((p) => underPrefix(p, PUBLIC_PAGES));
    if (pubPage) checkHeaders(await http(server.base, pubPage), `public page ${pubPage}`);
    const https = await http(server.base, '/api/me', { headers: { 'x-forwarded-proto': 'https' } });
    must(/max-age=\d+/.test(https.headers.get('strict-transport-security') ?? ''), 'HSTS is not sent for https requests');
    ok('security headers: nosniff, frame denial, CSP, referrer/permissions policy, no-store on APIs, HSTS over https');

    const logs = server.logs();
    for (const secret of [SECRET, cA.split('=')[1], cD.split('=')[1], 'correct horse battery', 'wrong password']) {
      must(!logs.includes(secret), 'the server log contains a secret (session cookie, password or master secret)');
    }
    ok('server log holds no session cookies, passwords or master secret');
    must(deferred.length === 0, deferred.join('; '));
  } finally {
    await server.stop();
    cleanDist(DIST);
    L.db.closeDb();
    rmrf(dataDir);
  }
  console.log('SECURITY AUTHZ OK');
}

const REFRESH_SENTINEL = '1//0gREFRESH-TOKEN-SENTINEL-7f3a91c2';
const ACCESS_SENTINEL = 'ya29.ACCESS-TOKEN-SENTINEL-55d0e1';
const SMTP_SENTINEL = 'SMTP-PASSWORD-SENTINEL-p4ssw0rd!';
const CLIENT_SECRET_SENTINEL = 'GOCSPX-CLIENT-SECRET-SENTINEL-88ab';
const EXPECTED_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/drive.file'];

function subKeyFor(secret: string): Buffer {
  const master = crypto.createHash('sha256').update(secret).digest();
  return crypto.createHmac('sha256', master).update('certflow:enc').digest();
}

async function caseTokens() {
  console.log('--- tokens: scopes, encryption at rest, no leaks ---');

  const found = new Set<string>();
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => /\.(ts|tsx)$/.test(x))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+/g)) found.add(m[0]);
  }
  const extra = [...found].filter((s) => !EXPECTED_SCOPES.includes(s));
  must(extra.length === 0, `code references Google scopes beyond the allowed four: ${extra.join(', ')}`);
  ok('no Google scope in src/ other than gmail.send and drive.file');

  const dataDir = tempDir('cf-sec-tokens-');
  const L = await loadLib(dataDir);
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET_SENTINEL;
  process.env.CERTFLOW_BASE_URL = 'http://localhost:3000';
  try {
    must(JSON.stringify(L.google.GOOGLE_SCOPES) === JSON.stringify(EXPECTED_SCOPES), `GOOGLE_SCOPES is ${JSON.stringify(L.google.GOOGLE_SCOPES)}`);
    const url = new URL(L.google.googleAuthUrl('state123'));
    must(url.origin === 'https://accounts.google.com', `OAuth URL points at ${url.origin}`);
    must(url.searchParams.get('scope') === EXPECTED_SCOPES.join(' '), `OAuth request scope is "${url.searchParams.get('scope')}"`);
    must(url.searchParams.get('access_type') === 'offline' && url.searchParams.get('response_type') === 'code' && url.searchParams.get('state') === 'state123', 'OAuth request must be code flow, offline access, with state');
    must(url.searchParams.get('redirect_uri') === 'http://localhost:3000/api/auth/google/callback', `redirect_uri is ${url.searchParams.get('redirect_uri')}`);
    must(!url.search.includes(CLIENT_SECRET_SENTINEL), 'client secret is in the OAuth URL');
    ok('OAuth request asks for exactly openid, email, gmail.send, drive.file (code flow, offline, state)');

    const st = L.google.newOAuthState();
    must(L.google.readOAuthState(st.state, st.nonce), 'valid OAuth state was refused');
    must(!L.google.readOAuthState(st.state, 'other-nonce') && !L.google.readOAuthState(st.state + 'x', st.nonce) && !L.google.readOAuthState('a.b.c', st.nonce) && !L.google.readOAuthState(null, st.nonce), 'forged OAuth state accepted');
    must(!L.google.readOAuthState(st.state, st.nonce, Date.now() + 11 * 60_000), 'expired OAuth state accepted');

    const plain = 'refresh-token-roundtrip-ünïcode-✓';
    const enc = L.crypto.encryptSecret(plain);
    const parts = enc.split(':');
    must(parts.length === 4 && parts[0] === 'v1', `ciphertext format is ${enc.slice(0, 20)}...`);
    must(!enc.includes(plain), 'ciphertext contains the plaintext');
    must(L.crypto.decryptSecret(enc) === plain, 'decrypt(encrypt(x)) != x');
    must(L.crypto.encryptSecret(plain) !== enc, 'the IV is reused: two encryptions are identical');
    const iv = Buffer.from(parts[1], 'base64url'), tag = Buffer.from(parts[2], 'base64url'), ct = Buffer.from(parts[3], 'base64url');
    must(iv.length === 12 && tag.length === 16, `IV/tag sizes ${iv.length}/${tag.length}, expected 12/16 (AES-GCM)`);
    const d = crypto.createDecipheriv('aes-256-gcm', subKeyFor(SECRET), iv);
    d.setAuthTag(tag);
    must(Buffer.concat([d.update(ct), d.final()]).toString('utf8') === plain, 'an independent AES-256-GCM decryption with the derived key disagrees');
    for (const [what, bad] of [['ciphertext', `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from(ct.map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64url')}`], ['tag', `${parts[0]}:${parts[1]}:${Buffer.from(tag.map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64url')}:${parts[3]}`], ['version', `v9:${parts.slice(1).join(':')}`], ['garbage', 'hello']] as const) {
      let threw: Error | null = null;
      try { L.crypto.decryptSecret(bad); } catch (e) { threw = e as Error; }
      must(threw, `tampered ${what} was accepted`);
      must(!threw.message.includes(parts[3]) && !threw.message.includes(SECRET), `decrypt error for tampered ${what} leaks material`);
    }
    ok('AES-256-GCM verified independently (12-byte IV, 16-byte tag, tamper detection, no key material in errors)');

    const db = L.db.openDb();
    addOrganizer(L, { id: 'org_t', email: 'tokens@certflow.test', password: 'pw-for-tokens-1' });
    L.google.storeGoogleTokens(db, 'org_t', 'tokens@gmail.test', { access_token: ACCESS_SENTINEL, expires_in: 3600, refresh_token: REFRESH_SENTINEL, scope: EXPECTED_SCOPES.join(' ') });
    L.settings.saveSender(db, 'org_t', { kind: 'smtp', smtp: { host: 'smtp.example.test', port: 587, secure: false, user: 'mailer', from: 'Org <org@example.test>', pass: SMTP_SENTINEL } });
    const rows = L.db.all<{ key: string; value: string; encrypted: number }>(db, "SELECT key, value, encrypted FROM settings WHERE organizer_id = 'org_t'");
    for (const key of ['google.refresh_token', 'smtp.pass']) {
      const row = rows.find((r) => r.key === key);
      must(row, `setting ${key} was not stored`);
      must(row.encrypted === 1 && row.value.startsWith('v1:'), `setting ${key} is not stored encrypted (encrypted=${row.encrypted}, value=${row.value.slice(0, 12)})`);
    }
    must(L.repo.getSetting<string>(db, 'org_t', 'google.refresh_token') === REFRESH_SENTINEL, 'refresh token does not decrypt back');
    must(L.repo.getSetting<string>(db, 'org_t', 'smtp.pass') === SMTP_SENTINEL, 'SMTP password does not decrypt back');
    must(!JSON.stringify(rows.filter((r) => r.key === 'sender')).includes(SMTP_SENTINEL), 'the visible sender setting contains the SMTP password');
    const pub = JSON.stringify(L.settings.publicSender(db, 'org_t'));
    must(!pub.includes(SMTP_SENTINEL) && /"hasPassword":true/.test(pub), `publicSender leaks or hides wrongly: ${pub}`);
    must(!JSON.stringify(L.settings.stripSecrets({ a: { password: 'x', refresh_token: 'y', ok: 1, smtp: { hasPassword: true, pass: 'z' } } })).match(/"x"|"y"|"z"/), 'stripSecrets left a secret behind');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    for (const s of [REFRESH_SENTINEL, SMTP_SENTINEL, ACCESS_SENTINEL, CLIENT_SECRET_SENTINEL]) {
      const hit = filesContain(dataDir, s);
      must(!hit, `plaintext secret "${s.slice(0, 12)}..." found in ${hit && path.relative(dataDir, hit)}`);
    }
    ok('refresh token and SMTP password: encrypted rows (v1: AES-GCM), plaintext absent from every file in the data dir');

    let missingThrew = false;
    try { L.google.storeGoogleTokens(db, 'org_t', 'x@gmail.test', { access_token: 'a', expires_in: 10, refresh_token: 'r', scope: 'openid email' }); } catch { missingThrew = true; }
    must(missingThrew, 'tokens granted without gmail.send/drive.file were stored');
    must(L.google.missingScopes('openid email https://www.googleapis.com/auth/gmail.send').length === 1, 'missingScopes does not notice a missing drive.file');

    const calls: { url: string; body: string }[] = [];
    const fakeFetch = (async (u: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(u), body: String(init?.body ?? '') });
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ access_token: ACCESS_SENTINEL, expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    const [t1, t2] = await Promise.all([L.google.googleAccessToken(db, 'org_t', true, fakeFetch), L.google.googleAccessToken(db, 'org_t', true, fakeFetch)]);
    must(t1 === ACCESS_SENTINEL && t2 === ACCESS_SENTINEL, 'googleAccessToken did not return the access token');
    must(calls.length === 1 && calls[0].url === 'https://oauth2.googleapis.com/token' && new URLSearchParams(calls[0].body).get('refresh_token') === REFRESH_SENTINEL, `access token refresh went to ${calls.map((c) => c.url)} (calls: ${calls.length})`);
    const rejectFetch = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: REFRESH_SENTINEL }), { status: 400 })) as typeof fetch;
    let msg = '';
    try { await L.google.googleAccessToken(db, 'org_t', true, rejectFetch); } catch (e) { msg = (e as Error).message; }
    must(msg && !msg.includes(REFRESH_SENTINEL) && !msg.includes(CLIENT_SECRET_SENTINEL), `refresh failure message is "${msg}"`);
    ok('access tokens come only from the stored refresh token; concurrent refreshes share one call; failures leak nothing');
  } finally {
    L.db.closeDb();
    rmrf(dataDir);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.CERTFLOW_BASE_URL;
  }

  const dir2 = tempDir('cf-sec-tokens-srv-');
  const logFile = path.join(dir2, 'fake-google.log');
  const L2 = await loadLib(dir2);
  const server = await startServer({
    port: PORT, distDir: DIST, dataDir: dir2,
    env: {
      CERTFLOW_SECRET: SECRET, ORGANIZER_EMAILS: undefined, GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: CLIENT_SECRET_SENTINEL,
      CERTFLOW_FAKE_GOOGLE_LOG: logFile, CERTFLOW_FAKE_REFRESH_TOKEN: REFRESH_SENTINEL, NODE_OPTIONS: `--import ${pathToFileURL(FAKE_GOOGLE).href}`,
    },
  });
  const seen: string[] = [];
  const note = (r: Reply) => { seen.push(r.text, JSON.stringify([...r.headers])); return r; };
  try {
    const jar = new Map<string, string>();
    const take = (r: Reply) => { for (const c of r.setCookies) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } return r; };
    const cookieHeader = () => [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');

    const startRoute = fs.existsSync(path.join(ROOT, 'src/app/api/auth/google/route.ts'));
    const cbRoute = fs.existsSync(path.join(ROOT, 'src/app/api/auth/google/callback/route.ts'));
    must(startRoute && cbRoute, 'GET /api/auth/google and GET /api/auth/google/callback (API.md) are not implemented in src/app/api/auth/google/');

    const start = note(take(await http(server.base, '/api/auth/google')));
    must(start.status >= 300 && start.status < 400 && !!start.location, `GET /api/auth/google returned ${start.status}, expected a redirect to Google`);
    const gu = new URL(start.location!);
    must(gu.origin === 'https://accounts.google.com', `Google sign-in redirects to ${gu.origin}`);
    must(gu.searchParams.get('scope') === EXPECTED_SCOPES.join(' '), `live OAuth redirect scope is "${gu.searchParams.get('scope')}"`);
    must(!start.location!.includes(CLIENT_SECRET_SENTINEL), 'client secret appears in the redirect URL');
    const state = gu.searchParams.get('state');
    must(state && state.length >= 16, 'OAuth redirect has no unguessable state');

    const code = (email: string, scope?: string) => `email=${encodeURIComponent(email)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`;
    const forgedCb = note(await http(server.base, `/api/auth/google/callback?code=${encodeURIComponent(code('attacker@gmail.test'))}&state=${encodeURIComponent(state!)}`));
    must(!sessionSet(forgedCb).length, 'callback signed someone in without the matching state cookie (login CSRF)');
    const garbageState = note(await http(server.base, `/api/auth/google/callback?code=${encodeURIComponent(code('attacker@gmail.test'))}&state=forged`, { cookie: cookieHeader() }));
    must(!sessionSet(garbageState).length, 'callback accepted a forged state');
    const partial = note(take(await http(server.base, `/api/auth/google/callback?code=${encodeURIComponent(code('first@gmail.test', 'openid email'))}&state=${encodeURIComponent(state!)}`, { cookie: cookieHeader() })));
    const partialStored = L2.db.get<{ n: number }>(L2.db.openDb(), "SELECT COUNT(*) n FROM settings WHERE key = 'google.refresh_token'")!.n;
    must(partialStored === 0, 'tokens without gmail.send/drive.file were stored');
    void partial;

    const start2 = take(await http(server.base, '/api/auth/google', { cookie: cookieHeader() }));
    const state2 = new URL(start2.location!).searchParams.get('state')!;
    const cb = note(take(await http(server.base, `/api/auth/google/callback?code=${encodeURIComponent(code('first@gmail.test'))}&state=${encodeURIComponent(state2)}`, { cookie: cookieHeader() })));
    must(cb.status >= 300 && cb.status < 400, `OAuth callback returned ${cb.status}: ${cb.text.slice(0, 200)}`);
    must(sessionSet(cb).length > 0, 'OAuth callback did not create a session for the first organizer');
    must(!/token|secret/i.test(cb.location ?? ''), `OAuth callback redirects with credentials in the URL: ${cb.location}`);
    const me = note(await http(server.base, '/api/me', { cookie: cookieHeader() }));
    must(me.status === 200 && JSON.stringify(me.json).includes('first@gmail.test'), `after Google sign-in /api/me returned ${me.status}: ${me.text.slice(0, 200)}`);
    const storedNow = L2.db.get<{ value: string; encrypted: number }>(L2.db.openDb(), "SELECT value, encrypted FROM settings WHERE key = 'google.refresh_token'");
    must(storedNow && storedNow.encrypted === 1 && storedNow.value.startsWith('v1:'), 'refresh token from the live OAuth callback is not stored encrypted');

    const startS = await http(server.base, '/api/auth/google');
    const stateS = new URL(startS.location!).searchParams.get('state')!;
    const strangerJar = startS.setCookies.map((c) => c.split(';')[0]).join('; ');
    const stranger = note(await http(server.base, `/api/auth/google/callback?code=${encodeURIComponent(code('stranger@gmail.test'))}&state=${encodeURIComponent(stateS)}`, { cookie: strangerJar }));
    must(!sessionSet(stranger).length, 'a Google account that is not an organizer got a session');
    const count = L2.db.get<{ n: number }>(L2.db.openDb(), 'SELECT COUNT(*) n FROM organizers')!.n;
    must(count === 1, `a stranger's Google sign-in created an organizer (${count} organizers)`);
    ok('live OAuth round trip (faked Google): state checked, scopes enforced, first organizer bootstrapped, strangers refused, token stored encrypted');

    const authed = cookieHeader();
    const settings = note(await http(server.base, '/api/settings', { cookie: authed }));
    must(settings.status === 200, `GET /api/settings returned ${settings.status}`);
    const put = await http(server.base, '/api/settings', { method: 'PUT', cookie: authed, json: { sender: { kind: 'smtp' }, smtp: { host: 'smtp.example.test', port: 587, secure: false, user: 'mailer', from: 'org@example.test', pass: SMTP_SENTINEL } } });
    note(put);
    must(put.status === 200, `PUT /api/settings with an SMTP password returned ${put.status}: ${put.text.slice(0, 200)}`);
    note(put);
    const after = note(await http(server.base, '/api/settings', { cookie: authed }));
    must(after.json?.smtp?.hasPassword === true, `GET /api/settings after saving an SMTP password does not report smtp.hasPassword=true (API.md): ${after.text.slice(0, 300)}`);
    const getRoutes = enumerateRoutes().filter((r) => r.methods.includes('GET') && !/\[|x$/.test(r.url) && !['/api/auth/google', '/api/auth/logout', '/api/auth/start', '/api/auth/demo'].includes(r.url));
    for (const r of getRoutes) note(await http(server.base, r.url, { cookie: authed }));
    for (const body of seen) {
      for (const s of [REFRESH_SENTINEL, ACCESS_SENTINEL, SMTP_SENTINEL, CLIENT_SECRET_SENTINEL]) must(!body.includes(s), `a secret ("${s.slice(0, 10)}...") appears in an API response`);
      must(!/scrypt\$[A-Za-z0-9_-]+\$/.test(body) && !/"password_hash"/.test(body), 'an API response contains a password hash');
      must(!/"v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:/.test(body), 'an API response contains an encrypted secret blob');
    }
    const smtpRow = L2.db.get<{ value: string; encrypted: number }>(L2.db.openDb(), "SELECT value, encrypted FROM settings WHERE key = 'smtp.pass'");
    must(smtpRow && smtpRow.encrypted === 1 && !smtpRow.value.includes(SMTP_SENTINEL), 'SMTP password saved through the API is not stored encrypted');
    ok(`${seen.length / 2 | 0} API responses scanned: no refresh/access tokens, SMTP password, client secret, password hash or ciphertext`);

    L2.db.openDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    for (const s of [REFRESH_SENTINEL, ACCESS_SENTINEL, SMTP_SENTINEL]) {
      const hit = filesContain(dir2, s);
      must(!hit || hit === logFile, `plaintext secret "${s.slice(0, 10)}..." found on disk in ${hit && path.relative(dir2, hit)}`);
    }
    const logs = server.logs();
    for (const s of [REFRESH_SENTINEL, ACCESS_SENTINEL, SMTP_SENTINEL, CLIENT_SECRET_SENTINEL, SECRET]) must(!logs.includes(s), `the server log contains a secret ("${s.slice(0, 10)}...")`);
    ok('database/data folder and server log are free of plaintext secrets');
  } finally {
    await server.stop();
    cleanDist(DIST);
    L2.db.closeDb();
    rmrf(dir2);
  }
  console.log('SECURITY TOKENS OK');
}

function minimalXlsx(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([['Name', 'Email'], ['Ada', 'ada@example.test']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const TTF = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(64, 3)]);
const OTF = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(64, 4)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)]);
const CSV = Buffer.from('Name,Email,Award\r\nAda,ada@example.test,1st Prize\r\n');
const DOCX_LIKE = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);

async function caseUploads() {
  console.log('--- uploads: private, magic-byte checked, random ids ---');
  const dataDir = tempDir('cf-sec-uploads-');
  const L = await loadLib(dataDir);
  const db = L.db.openDb();
  addOrganizer(L, { id: 'org_u1', email: 'u1@certflow.test', password: 'pw-for-uploads-1' });
  addOrganizer(L, { id: 'org_u2', email: 'u2@certflow.test', password: 'pw-for-uploads-2' });
  const U = L.uploads;
  const uploadsDir = path.join(dataDir, 'uploads');
  const files = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
  const rowsCount = () => L.db.get<{ n: number }>(db, 'SELECT COUNT(*) n FROM uploads')!.n;
  const refuse = (kind: 'sheet' | 'template' | 'font', name: string, bytes: Uint8Array, what: string) => {
    const f0 = files().length, r0 = rowsCount();
    let err: Error | null = null;
    try { U.saveUpload(db, 'org_u1', kind, name, bytes); } catch (e) { err = e as Error; }
    must(err, `${what} was accepted`);
    must(err instanceof U.UploadError && err.status >= 400 && err.status < 500, `${what}: wrong error type/status (${err.name} ${(err as { status?: number }).status})`);
    must(files().length === f0 && rowsCount() === r0, `${what}: left a file or row behind`);
  };

  try {
    const accepted: [string, 'sheet' | 'template' | 'font', string, Buffer, string][] = [
      ['xlsx', 'sheet', 'students.xlsx', minimalXlsx(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['csv', 'sheet', 'students.csv', CSV, 'text/csv'],
      ['utf-16 csv with BOM', 'sheet', 'u16.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name,Email\r\nAda,a@b.test\r\n', 'utf16le')]), 'text/csv'],
      ['utf-16 csv without BOM', 'sheet', 'u16b.csv', Buffer.from('Name;Email\r\nAda;a@b.test\r\n', 'utf16le'), 'text/csv'],
      ['pdf', 'template', 'design.pdf', PDF, 'application/pdf'],
      ['png', 'template', 'design.png', PNG, 'image/png'],
      ['jpeg', 'template', 'design.jpg', JPG, 'image/jpeg'],
      ['ttf', 'font', 'f.ttf', TTF, 'font/ttf'],
      ['otf', 'font', 'f.otf', OTF, 'font/otf'],
    ];
    const ids: string[] = [];
    for (const [what, kind, name, bytes, mime] of accepted) {
      const r = U.saveUpload(db, 'org_u1', kind, name, bytes);
      must(r.mime === mime, `${what}: detected as ${r.mime}, expected ${mime}`);
      ids.push(r.id);
    }
    ok(`accepted ${accepted.length} real file types (detected from their bytes)`);

    refuse('sheet', 'payroll.xlsx', EXE, 'a Windows executable named .xlsx');
    refuse('sheet', 'photo.csv', PNG, 'a PNG uploaded as a sheet');
    refuse('sheet', 'doc.csv', PDF, 'a PDF uploaded as a sheet');
    refuse('sheet', 'report.xlsx', DOCX_LIKE, 'a Word/zip file named .xlsx');
    refuse('sheet', 'a.csv', Buffer.concat([Buffer.from('a,b\n'), Buffer.alloc(300, 0), Buffer.from('x')]), 'binary data with NUL bytes as csv');
    refuse('template', 'design.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'an SVG with a script as a template');
    refuse('template', 'design.pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'HTML named .pdf');
    refuse('template', 'design.jpg', CSV, 'a CSV as a template');
    refuse('font', 'f.ttf', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'a shell script named .ttf');
    refuse('font', 'f.otf', PNG, 'a PNG as a font');
    refuse('sheet', 'empty.csv', Buffer.alloc(0), 'an empty file');
    refuse('sheet', 'huge.csv', Buffer.alloc(U.UPLOAD_LIMITS.sheet + 1, 0x61), 'a sheet over the size limit');
    refuse('template', 'huge.png', Buffer.concat([PNG, Buffer.alloc(U.UPLOAD_LIMITS.template, 1)]), 'a template over the size limit');
    refuse('font', 'huge.ttf', Buffer.concat([TTF, Buffer.alloc(U.UPLOAD_LIMITS.font, 1)]), 'a font over the size limit');
    refuse('bogus' as 'sheet', 'a.csv', CSV, 'an unknown upload kind');
    ok('wrong types (renamed exe/png/pdf/zip/svg/html/script), empty and oversize files are refused without leftovers');

    const hostile = ['../../etc/passwd', '..\\..\\Windows\\win.ini', '/etc/passwd', 'C:\\Windows\\x.csv', 'a/b.csv', 'a\\b.csv', '..', '../x.csv', 'x\0.csv', 'evil\r\nSet-Cookie: a=b.csv', 'a\nb.csv', '%2e%2e%2fx.csv', '..%5cx.csv', 'x/../../y.csv', '', '   ', 'n'.repeat(201) + '.csv'];
    for (const name of hostile) refuse('sheet', name, CSV, `file name ${JSON.stringify(name).slice(0, 50)}`);
    ok(`${hostile.length} traversal/control-character/empty/over-long names are rejected`);
    for (const name of ['Résumé final (2).csv', 'Hackathon 2026 – winners.csv', '成绩.csv', 'a.b.c.csv']) {
      const r = U.saveUpload(db, 'org_u1', 'sheet', name, CSV);
      ids.push(r.id);
    }

    const more = Array.from({ length: 60 }, () => U.saveUpload(db, 'org_u1', 'sheet', 'same-name.csv', CSV).id);
    const all = new Set([...ids, ...more]);
    must(all.size === ids.length + more.length, 'upload ids collide');
    for (const id of all) must(/^up_[A-Za-z0-9_-]{22}$/.test(id), `upload id "${id}" is not up_ + 128 random bits`);
    must(!more.some((id) => id.includes('same-name') || id.includes('csv')), 'upload ids are derived from the file name');
    const onDisk = new Set(files());
    for (const id of all) must(onDisk.has(id), `stored file name differs from the id (${id})`);
    must(onDisk.size === all.size, `unexpected files in uploads folder: ${[...onDisk].filter((x) => !all.has(x)).join(', ')}`);
    if (process.platform !== 'win32') {
      for (const f of files()) {
        const mode = fs.statSync(path.join(uploadsDir, f)).mode & 0o777;
        must(mode === 0o600, `${f} has mode ${mode.toString(8)}, expected 600`);
      }
      const dmode = fs.statSync(uploadsDir).mode & 0o777;
      must((dmode & 0o077) === 0, `uploads folder mode is ${dmode.toString(8)}, expected no group/other access`);
    }
    const resolved = fs.realpathSync(uploadsDir);
    must(!resolved.startsWith(path.join(ROOT, 'public') + path.sep) && !fs.existsSync(path.join(ROOT, 'public', 'uploads')), 'uploads are inside the public web folder');
    must(resolved.startsWith(fs.realpathSync(dataDir)), 'uploads are outside the data folder');
    ok(`${all.size} ids are unique 128-bit random values, files are mode 0600 in a private folder outside public/`);

    const mine = ids[0];
    must(U.readUpload(db, 'org_u1', mine).bytes.length > 0, 'owner cannot read own upload');
    for (const id of [mine, 'up_doesnotexist', '../' + mine, mine + '/../..']) {
      let threw = false;
      try { U.readUpload(db, 'org_u2', id); } catch { threw = true; }
      must(threw, `another organizer (or a crafted id "${id}") could read an upload`);
    }
    for (const id of ['../x', 'up_/../x', 'up_a b', 'up_' + 'a'.repeat(80), '']) {
      let threw = false;
      try { U.uploadPath(id); } catch { threw = true; }
      must(threw, `uploadPath accepted a crafted id "${id}"`);
    }
    ok('uploads are readable only by their owner; crafted ids never reach the file system');
  } finally {
    L.db.closeDb();
  }

  const server = await startServer({ port: PORT, distDir: DIST, dataDir, env: { CERTFLOW_SECRET: SECRET, ORGANIZER_EMAILS: undefined, GOOGLE_CLIENT_ID: undefined } });
  const L2 = await loadLib(dataDir);
  try {
    const c1 = sessionCookie(L2.session.signSession('org_u1'));
    const c2 = sessionCookie(L2.session.signSession('org_u2'));
    const post = async (cookie: string | null, fields: Parameters<typeof multipart>[0], contentTypeOverride?: string) => {
      const m = multipart(fields);
      return http(server.base, '/api/uploads', { method: 'POST', cookie, body: new Uint8Array(m.body), headers: { 'content-type': contentTypeOverride ?? m.contentType } });
    };
    const noSession = await post(null, [{ name: 'file', filename: 'a.csv', bytes: CSV, type: 'text/csv' }, { name: 'kind', value: 'sheet' }]);
    must(noSession.status === 401, `POST /api/uploads without a session returned ${noSession.status}`);
    const good = await post(c1, [{ name: 'file', filename: 'students.csv', bytes: CSV, type: 'text/csv' }, { name: 'kind', value: 'sheet' }]);
    must(good.status === 200 && typeof good.json?.id === 'string', `valid upload returned ${good.status}: ${good.text.slice(0, 200)}`);
    must(/^up_[A-Za-z0-9_-]{22}$/.test(good.json.id), `API upload id is "${good.json.id}"`);
    must(!good.text.includes(dataDir) && !/\/uploads\//.test(good.text), 'upload response reveals server file paths');
    const lie = await post(c1, [{ name: 'file', filename: 'photo.csv', bytes: PNG, type: 'text/csv' }, { name: 'kind', value: 'sheet' }]);
    must(lie.status >= 400 && lie.status < 500, `PNG claiming to be CSV was accepted over HTTP (${lie.status})`);
    const exe = await post(c1, [{ name: 'file', filename: 'x.xlsx', bytes: EXE, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { name: 'kind', value: 'sheet' }]);
    must(exe.status >= 400 && exe.status < 500, `executable named .xlsx accepted over HTTP (${exe.status})`);
    const before = fs.readdirSync(path.join(dataDir, 'uploads')).length;
    for (const name of ['../../../etc/passwd', '..\\..\\x.csv', 'a/../../b.csv']) {
      const r = await post(c1, [{ name: 'file', filename: name, bytes: CSV, type: 'text/csv' }, { name: 'kind', value: 'sheet' }]);
      must(r.status >= 400 && r.status < 500, `traversal file name ${name} accepted over HTTP (${r.status})`);
    }
    must(fs.readdirSync(path.join(dataDir, 'uploads')).length === before, 'a traversal upload left a file behind');
    const noFile = await post(c1, [{ name: 'kind', value: 'sheet' }]);
    must(noFile.status === 400, `upload without a file returned ${noFile.status}, expected 400`);
    const badKind = await post(c1, [{ name: 'file', filename: 'a.csv', bytes: CSV, type: 'text/csv' }, { name: 'kind', value: '../../etc' }]);
    must(badKind.status >= 400 && badKind.status < 500, `unknown upload kind accepted (${badKind.status})`);
    const notMultipart = await http(server.base, '/api/uploads', { method: 'POST', cookie: c1, json: { file: 'x' } });
    must(notMultipart.status >= 400 && notMultipart.status < 500, `non-multipart upload returned ${notMultipart.status}`);
    const big = await post(c1, [{ name: 'file', filename: 'big.csv', bytes: Buffer.alloc(U_LIMIT_SHEET + 1024, 0x61), type: 'text/csv' }, { name: 'kind', value: 'sheet' }]);
    must(big.status >= 400 && big.status < 500, `oversize sheet accepted over HTTP (${big.status})`);
    ok('HTTP: no session 401; disguised/traversal/oversize/malformed uploads are 4xx and leave nothing on disk');

    const id = good.json.id as string;
    for (const p of [`/uploads/${id}`, `/data/uploads/${id}`, `/${id}`, `/public/uploads/${id}`, `/api/uploads/../../data/uploads/${id}`]) {
      const r = await http(server.base, p, { cookie: c1 });
      must(r.status !== 200 || !r.text.includes('Ada,ada@example.test') && !r.text.includes('1st Prize'), `uploaded file is served at ${p}`);
    }
    const own = await http(server.base, `/api/uploads/${id}`, { cookie: c1 });
    if (own.status === 404 && !fs.existsSync(path.join(ROOT, 'src/app/api/uploads/[id]/route.ts'))) {
      console.log('  warn GET /api/uploads/[id] (API.md) is not implemented, owner/other-organizer download not exercised');
    } else {
      must(own.status === 200 && own.text.includes('1st Prize'), `owner cannot download own upload (${own.status})`);
      const other = await http(server.base, `/api/uploads/${id}`, { cookie: c2 });
      must(other.status === 404 || other.status === 403, `another organizer got ${other.status} for someone's upload`);
      must((await http(server.base, `/api/uploads/${id}`)).status === 401, 'anonymous upload download is not 401');
      ok('GET /api/uploads/[id] works for the owner only');
    }
  } finally {
    await server.stop();
    cleanDist(DIST);
    L2.db.closeDb();
    rmrf(dataDir);
  }
  console.log('SECURITY UPLOADS OK');
}
const U_LIMIT_SHEET = 15 * 1024 * 1024;

async function caseUploadsPurgeInProcess() {
  console.log('--- purge: a batch goes, the organizer certificate folder and other batches stay ---');
  const dataDir = tempDir('cf-sec-purge-');
  const L = await loadLib(dataDir);
  const db = L.db.openDb();
  const { run, get, all, nowIso } = L.db;
  const X = 'org_x', Y = 'org_y';
  addOrganizer(L, { id: X, email: 'x@certflow.test', password: 'pw-purge-x-1' });
  addOrganizer(L, { id: Y, email: 'y@certflow.test', password: 'pw-purge-y-1' });
  const now = nowIso();
  const csv = (s: string) => Buffer.from(`Name,Email,Award\r\n${s},${s.toLowerCase()}@example.test,1st Prize\r\n`);
  const sheet1 = L.uploads.saveUpload(db, X, 'sheet', 'b1.csv', csv('Ada')).id;
  const sheet2 = L.uploads.saveUpload(db, X, 'sheet', 'b2.csv', csv('Bob')).id;
  const sheetY = L.uploads.saveUpload(db, Y, 'sheet', 'y.csv', csv('Yan')).id;
  const tplOnly1 = L.uploads.saveUpload(db, X, 'template', 'only-b1.png', PNG).id;
  const tplShared = L.uploads.saveUpload(db, X, 'template', 'shared.png', PNG).id;
  const tplSaved = L.uploads.saveUpload(db, X, 'template', 'saved.png', PNG).id;

  const cfg = (tpl: string[]) => JSON.stringify({ templates: Object.fromEntries(tpl.map((t) => [`custom:${t}`, { id: `custom:${t}`, kind: 'image', backgroundRef: t, layers: [] }])) });
  const batch = (id: string, org: string, sheet: string | null, config: string, status = 'DONE') =>
    run(db, 'INSERT INTO batches (id, organizer_id, name, status, sheet_upload_id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, org, id, status, sheet, config, now, now);
  batch('b1', X, sheet1, cfg([tplOnly1, tplShared, tplSaved]));
  batch('b2', X, sheet2, cfg([tplShared]));
  batch('b3', Y, sheetY, cfg([]));
  run(db, "INSERT INTO templates (id, organizer_id, name, json, updated_at) VALUES ('t1', ?, 'saved', ?, ?)", X, JSON.stringify({ id: 't1', backgroundRef: tplSaved }), now);

  const fill = (batchId: string, org: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const rec = `${batchId}_r${i}`, cert = `${batchId}_c${i}`;
      run(db, 'INSERT INTO records (id, batch_id, row_number, person_key, email, email_source, values_json) VALUES (?, ?, ?, ?, ?, ?, ?)', rec, batchId, i + 2, `p${i}`, `p${i}@example.test`, 'primary', JSON.stringify({ NAME: `Person ${i}` }));
      run(db, `INSERT INTO certificates (id, batch_id, organizer_id, record_id, person_key, category_id, category_label, template_id, dup_key, verify_code, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'c', '1st Prize', 'builtin:classic', ?, ?, 'SENT', ?, ?)`, cert, batchId, org, rec, `p${i}`, `${batchId}#${i}`, `V${batchId}${i}`.toUpperCase(), now, now);
      run(db, 'INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, ?, NULL, ?, ?, ?)', cert, batchId, 'PENDING', 'Created', now);
      run(db, 'INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, ?, ?, ?, ?, ?)', cert, batchId, 'PENDING', 'SENT', null, now);
      if (i === 0) run(db, "INSERT INTO tickets (id, cert_id, batch_id, organizer_id, category, status, created_at) VALUES (?, ?, ?, ?, 'name', 'OPEN', ?)", `tk_${batchId}`, cert, batchId, org, now);
    }
  };
  fill('b1', X, 5); fill('b2', X, 3); fill('b3', Y, 2);

  for (const b of ['b1', 'b2', 'b3']) {
    fs.mkdirSync(path.join(dataDir, 'pdfs', b), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'pdfs', b, `${b}_c0.pdf`), `%PDF-1.4 ${b}`);
  }
  const certFolder = path.join(dataDir, 'certificates', X, 'Event', '1st Prize');
  fs.mkdirSync(certFolder, { recursive: true });
  const certFile = path.join(certFolder, 'Ada.pdf');
  fs.writeFileSync(certFile, '%PDF-1.4 final certificate');
  fs.writeFileSync(path.join(dataDir, 'certificates', X, '.certflow-index.json'), JSON.stringify({ b1_c0: 'Event/1st Prize/Ada.pdf' }));
  const countsOf = (batchId: string) => ({
    records: get<{ n: number }>(db, 'SELECT COUNT(*) n FROM records WHERE batch_id = ?', batchId)!.n,
    certs: get<{ n: number }>(db, 'SELECT COUNT(*) n FROM certificates WHERE batch_id = ?', batchId)!.n,
    events: get<{ n: number }>(db, 'SELECT COUNT(*) n FROM events WHERE batch_id = ?', batchId)!.n,
    tickets: get<{ n: number }>(db, 'SELECT COUNT(*) n FROM tickets WHERE batch_id = ?', batchId)!.n,
    batch: get<{ n: number }>(db, 'SELECT COUNT(*) n FROM batches WHERE id = ?', batchId)!.n,
  });
  const b2Before = countsOf('b2'), b3Before = countsOf('b3');
  const upExists = (id: string) => fs.existsSync(path.join(dataDir, 'uploads', id)) && !!get(db, 'SELECT id FROM uploads WHERE id = ?', id);

  for (const [org, id] of [[X, 'b3'], [Y, 'b1'], [X, 'nope']] as const) {
    let err: { status?: number } | null = null;
    try { L.purge.purgeBatch(db, org, id); } catch (e) { err = e as { status?: number }; }
    must(err && err.status === 404, `purgeBatch(${org}, ${id}) should be a 404, got ${err?.status}`);
  }
  must(countsOf('b1').records === 5 && countsOf('b3').records === 2, 'a refused purge changed data');

  run(db, "UPDATE batches SET status = 'RUNNING', updated_at = ? WHERE id = 'b2'", nowIso());
  let busy: { status?: number } | null = null;
  try { L.purge.purgeBatch(db, X, 'b2'); } catch (e) { busy = e as { status?: number }; }
  must(busy && busy.status === 409, `purging a running batch should be 409, got ${busy?.status}`);
  run(db, "UPDATE batches SET status = 'DONE' WHERE id = 'b2'");
  must(JSON.stringify(countsOf('b2')) === JSON.stringify(b2Before), 'refused purge of a running batch changed data');

  const res = L.purge.purgeBatch(db, X, 'b1');
  must(res.records === 5 && res.certificates === 5 && res.events === 10 && res.tickets === 1, `purge counts wrong: ${JSON.stringify(res)}`);
  must(res.failures.length === 0, `purge failures: ${res.failures.join('; ')}`);
  const gone = countsOf('b1');
  must(gone.records === 0 && gone.certs === 0 && gone.events === 0 && gone.tickets === 0 && gone.batch === 0, `batch b1 still has rows: ${JSON.stringify(gone)}`);
  must(get<{ n: number }>(db, "SELECT COUNT(*) n FROM events WHERE cert_id LIKE 'b1\\_%' ESCAPE '\\'")!.n === 0, 'b1 events remain');
  must(!upExists(sheet1), 'the uploaded sheet of the purged batch is still stored');
  must(!upExists(tplOnly1), 'a template used only by the purged batch is still stored');
  must(upExists(tplShared), 'a template still used by another batch was deleted');
  must(upExists(tplSaved), 'a saved (reusable) template was deleted');
  must(res.uploads === 2 && res.keptUploads === 2, `purge upload counts wrong: ${JSON.stringify(res)}`);
  must(!fs.existsSync(path.join(dataDir, 'pdfs', 'b1')), 'the PDF cache of the purged batch is still there');
  must(fs.existsSync(path.join(dataDir, 'pdfs', 'b2')) && fs.existsSync(path.join(dataDir, 'pdfs', 'b3')), 'other batches lost their PDF cache');
  must(fs.readFileSync(certFile, 'utf8') === '%PDF-1.4 final certificate', "the organizer's certificate file was touched");
  must(fs.existsSync(path.join(dataDir, 'certificates', X, '.certflow-index.json')), "the organizer's certificate index was removed");
  must(JSON.stringify(countsOf('b2')) === JSON.stringify(b2Before) && JSON.stringify(countsOf('b3')) === JSON.stringify(b3Before), 'another batch was changed');
  must(upExists(sheet2) && upExists(sheetY), "another batch's sheet was deleted");
  must(!filesContain(dataDir, 'ada@example.test'), "the purged batch's sheet content is still on disk");
  ok('purge removed records, certificates, events, tickets, sheet, batch-only template and PDF cache; kept the certificate folder, shared/saved templates and other batches');

  let again: { status?: number } | null = null;
  try { L.purge.purgeBatch(db, X, 'b1'); } catch (e) { again = e as { status?: number }; }
  must(again && again.status === 404, 'purging twice should be a clean 404');

  const evilDir = path.join(dataDir, 'evil');
  fs.mkdirSync(evilDir);
  fs.writeFileSync(path.join(evilDir, 'keep.txt'), 'must survive');
  batch('../evil', X, null, '{}');
  const evil = L.purge.purgeBatch(db, X, '../evil');
  must(fs.existsSync(path.join(evilDir, 'keep.txt')), 'purge followed a ../ batch id out of the PDF cache');
  must(evil.failures.length > 0, 'a hostile batch id should be reported, not silently ignored');
  ok('a ../ batch id cannot make purge delete outside the PDF cache');

  L.db.closeDb();
  rmrf(dataDir);
}

async function casePurgeHttp() {
  const routeFile = path.join(ROOT, 'src/app/api/batches/[id]/purge/route.ts');
  if (!fs.existsSync(routeFile)) {
    console.log('  warn POST /api/batches/[id]/purge (API.md) is not implemented yet, HTTP purge not exercised');
    return;
  }
  const dataDir = tempDir('cf-sec-purge-http-');
  const L = await loadLib(dataDir);
  const db = L.db.openDb();
  addOrganizer(L, { id: 'org_p1', email: 'p1@certflow.test', password: 'pw-purge-http-1' });
  addOrganizer(L, { id: 'org_p2', email: 'p2@certflow.test', password: 'pw-purge-http-2' });
  const now = L.db.nowIso();
  const sheet = L.uploads.saveUpload(db, 'org_p1', 'sheet', 's.csv', CSV).id;
  L.db.run(db, "INSERT INTO batches (id, organizer_id, name, status, sheet_upload_id, config_json, created_at, updated_at) VALUES ('bp1', 'org_p1', 'bp1', 'DONE', ?, '{}', ?, ?)", sheet, now, now);
  L.db.run(db, "INSERT INTO batches (id, organizer_id, name, status, sheet_upload_id, config_json, created_at, updated_at) VALUES ('bp2', 'org_p1', 'bp2', 'DONE', NULL, '{}', ?, ?)", now, now);
  for (const [b, c] of [['bp1', 'cert_bp1'], ['bp2', 'cert_bp2']]) {
    L.db.run(db, 'INSERT INTO records (id, batch_id, row_number, person_key, email, email_source, values_json) VALUES (?, ?, 2, ?, ?, ?, ?)', `rec_${b}`, b, 'p', 'p@example.test', 'primary', '{"NAME":"Pat"}');
    L.db.run(db, `INSERT INTO certificates (id, batch_id, organizer_id, record_id, person_key, category_id, category_label, template_id, dup_key, verify_code, status, created_at, updated_at)
      VALUES (?, ?, 'org_p1', ?, 'p', 'c', '1st Prize', 'builtin:classic', ?, ?, 'SENT', ?, ?)`, c, b, `rec_${b}`, `dup_${b}`, `V${b}`.toUpperCase(), now, now);
    L.db.run(db, 'INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, ?, NULL, ?, ?, ?)', c, b, 'PENDING', 'Created', now);
    fs.mkdirSync(path.join(dataDir, 'pdfs', b), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'pdfs', b, `${c}.pdf`), '%PDF-1.4 cache');
  }
  L.db.run(db, "INSERT INTO tickets (id, cert_id, batch_id, organizer_id, category, suggested, note, status, created_at) VALUES ('tk1', 'cert_bp1', 'bp1', 'org_p1', 'name', 'Patricia', 'typo in my name', 'OPEN', ?)", now);
  const folder = path.join(dataDir, 'certificates', 'org_p1', 'Event', '1st Prize');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'Pat.pdf'), '%PDF-1.4 final certificate');
  fs.writeFileSync(path.join(dataDir, 'certificates', 'org_p1', '.certflow-index.json'), JSON.stringify({ cert_bp1: 'Event/1st Prize/Pat.pdf' }));
  const server = await startServer({ port: PORT, distDir: DIST, dataDir, env: { CERTFLOW_SECRET: SECRET, ORGANIZER_EMAILS: undefined, GOOGLE_CLIENT_ID: undefined } });
  try {
    const c1 = sessionCookie(L.session.signSession('org_p1')), c2 = sessionCookie(L.session.signSession('org_p2'));
    const n = (sql: string) => L.db.get<{ n: number }>(L.db.openDb(), sql)!.n;
    must((await http(server.base, '/api/batches/bp1/purge', { method: 'POST', json: { confirm: true } })).status === 401, 'purge without a session is not 401');
    const other = await http(server.base, '/api/batches/bp1/purge', { method: 'POST', cookie: c2, json: { confirm: true } });
    must(other.status === 404, `another organizer purging someone's batch got ${other.status}, expected 404`);
    must(n("SELECT COUNT(*) n FROM records WHERE batch_id = 'bp1'") === 1, "another organizer's purge attempt deleted data");
    const unconfirmed = await http(server.base, '/api/batches/bp1/purge', { method: 'POST', cookie: c1, json: {} });
    must(unconfirmed.status >= 400 && unconfirmed.status < 500 && n("SELECT COUNT(*) n FROM records WHERE batch_id = 'bp1'") === 1, `purge without confirmation was not refused (${unconfirmed.status})`);
    const done = await http(server.base, '/api/batches/bp1/purge', { method: 'POST', cookie: c1, json: { confirm: true } });
    must(done.status === 200, `owner purge returned ${done.status}: ${done.text.slice(0, 200)}`);
    for (const t of ['records', 'certificates', 'events']) must(n(`SELECT COUNT(*) n FROM ${t} WHERE batch_id = 'bp1'`) === 0, `HTTP purge left ${t} rows behind`);
    must(!L.db.get(L.db.openDb(), 'SELECT id FROM uploads WHERE id = ?', sheet) && !fs.existsSync(path.join(dataDir, 'uploads', sheet)), 'HTTP purge left the uploaded sheet behind');
    must(!fs.existsSync(path.join(dataDir, 'pdfs', 'bp1')), 'HTTP purge left the PDF cache behind');
    const tk = L.db.get<{ suggested: string | null; note: string | null }>(L.db.openDb(), "SELECT suggested, note FROM tickets WHERE id = 'tk1'");
    must(!tk || (!tk.suggested && !tk.note), 'HTTP purge left a student correction request (suggested name / note) behind');
    must(n("SELECT COUNT(*) n FROM records WHERE batch_id = 'bp2'") === 1 && n("SELECT COUNT(*) n FROM certificates WHERE batch_id = 'bp2'") === 1 && fs.existsSync(path.join(dataDir, 'pdfs', 'bp2')), 'HTTP purge touched another batch');
    must(fs.existsSync(path.join(folder, 'Pat.pdf')), "HTTP purge deleted a file from the organizer's certificate folder (it must stay, like Drive files)");
    ok('POST /api/batches/[id]/purge: 401 anonymous, 404 for other organizers, needs confirmation, removes the batch data; certificate folder and other batches stay');
  } finally {
    await server.stop();
    cleanDist(DIST);
    L.db.closeDb();
    rmrf(dataDir);
  }
}

async function casePurge() {
  await caseUploadsPurgeInProcess();
  await casePurgeHttp();
  console.log('SECURITY PURGE OK');
}

async function main() {
  const i = process.argv.indexOf('--case');
  const which = i >= 0 ? process.argv[i + 1] : 'all';
  const cases: Record<string, () => Promise<void>> = { authz: caseAuthz, tokens: caseTokens, uploads: caseUploads, purge: casePurge };
  if (which === 'all') { for (const f of Object.values(cases)) await f(); console.log('SECURITY ALL OK'); return; }
  if (!cases[which]) throw new Failure(`Unknown --case ${which} (use authz|tokens|uploads|purge|all)`);
  await cases[which]();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`FAIL: ${e instanceof Failure ? e.message : (e as Error).stack ?? String(e)}`);
  process.exit(1);
});

export type { RunningServer };
