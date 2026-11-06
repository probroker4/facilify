import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const DEMO_EMAIL = 'demo@certflow.local';

class Pending extends Error {}
const must = (cond: unknown, msg: string): void => { if (!cond) throw new Error(msg); };
const log = (m: string) => console.log(`  ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `certflow-${label}-`));
const rm = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {  } };

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CERTFLOW_') || k === 'NEXT_DIST_DIR' || k === 'PORT') delete env[k];
  env.NEXT_TELEMETRY_DISABLED = '1';
  return { ...env, CERTFLOW_PASSWORD_LOGIN: '1', ...extra };
}

function runNode(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 600000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => { killTree(child); out += '\n[timed out]'; }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, out: String(e) }); });
  });
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch {  }
}

interface Server { child: ChildProcess; url: string; logs: () => string; stop: () => Promise<void>; exited: () => boolean }
function startServer(cwd: string, mode: 'dev' | 'start', port: number, env: NodeJS.ProcessEnv): Server {
  const child = spawn(process.execPath, [NEXT_BIN, mode, '-p', String(port)], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  let buf = '';
  child.stdout?.on('data', (d) => (buf += d));
  child.stderr?.on('data', (d) => (buf += d));
  return {
    child, url: `http://127.0.0.1:${port}`, logs: () => buf.slice(-3000), exited: () => child.exitCode !== null,
    stop: async () => { killTree(child); await sleep(800); },
  };
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, what: string, server?: Server) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (server?.exited()) throw new Error(`Server stopped while waiting for ${what}.\n${server.logs()}`);
    try { if (await fn()) return; } catch {  }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}.${server ? `\n${server.logs()}` : ''}`);
}

class Client {
  private cookies = new Map<string, string>();
  constructor(private base: string) {}
  async req(method: string, p: string, body?: unknown, form?: FormData): Promise<{ status: number; json: any; text: string; headers: Headers }> {
    const headers: Record<string, string> = { Origin: this.base };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: BodyInit | undefined;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + p, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) { const v = pair.slice(eq + 1); if (v) this.cookies.set(pair.slice(0, eq), v); else this.cookies.delete(pair.slice(0, eq)); }
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {  }
    return { status: res.status, json, text, headers: res.headers };
  }
}

const routeExists = (root: string, ...segs: string[]) =>
  ['route.ts', 'route.tsx', 'route.js'].some((f) => fs.existsSync(path.join(root, 'src', 'app', 'api', ...segs, f)));

async function runSetup(cwd: string, dataDir: string, password?: string) {
  const env = cleanEnv({ CERTFLOW_DATA_DIR: dataDir, ...(password ? { CERTFLOW_DEMO_PASSWORD: password } : {}) });
  const r = await runNode([path.join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join('scripts', 'demo', 'setup.ts')], cwd, env, 120000);
  must(r.code === 0, `setup failed:\n${r.out}`);
  return r.out;
}

async function caseCrossPlatform() {
  const data = tmp('xplat');
  const password = 'demo-pass-12345';
  let server: Server | undefined;
  try {
    const first = await runSetup(ROOT, data, password);
    must(first.includes(DEMO_EMAIL) && first.includes(password), 'first setup run must print the sign-in details');
    must(first.includes('http://localhost:3000'), 'setup must tell the user where to open the app');
    must(fs.existsSync(path.join(data, 'certflow.db')), 'database file was not created');
    must(fs.existsSync(path.join(data, 'secret.key')), 'secret key was not created');
    must(fs.existsSync(path.join(data, 'samples', 'sample-students.csv')), 'sample sheet was not copied to data/samples');
    log('setup run 1 ok (account, secret, settings, sample sheet)');
    const second = await runSetup(ROOT, data);
    must(second.includes(DEMO_EMAIL) && !second.includes(password), 'second setup must keep the account and not print a password again');
    log('setup run 2 ok (idempotent)');

    if (!routeExists(ROOT, 'health')) throw new Pending('src/app/api/health/route.ts is not written yet (UI leaf 1.3.1)');

    server = startServer(ROOT, 'dev', 3104, cleanEnv({ CERTFLOW_DATA_DIR: data, NEXT_DIST_DIR: '.next-demo', CERTFLOW_BASE_URL: 'http://127.0.0.1:3104' }));
    const c = new Client(server.url);
    await waitFor(async () => (await c.req('GET', '/api/health')).status === 200, 180000, 'GET /api/health', server);
    const health = await c.req('GET', '/api/health');
    must(health.json?.ok === true, `/api/health should return { ok: true }, got ${health.text}`);
    log('GET /api/health ok');

    if (!routeExists(ROOT, 'auth', 'login')) throw new Pending('src/app/api/auth/login/route.ts is not written yet (UI leaf 1.3.1)');
    const bad = await c.req('POST', '/api/auth/login', { email: DEMO_EMAIL, password: 'wrong-password' });
    must(bad.status >= 400 && bad.status < 500, `a wrong password must be refused, got ${bad.status}`);
    const login = await c.req('POST', '/api/auth/login', { email: DEMO_EMAIL, password });
    must(login.status === 200 && login.json?.ok, `demo sign-in failed (${login.status}): ${login.text}`);
    if (routeExists(ROOT, 'me')) {
      const me = await c.req('GET', '/api/me');
      must(me.status === 200 && me.json?.organizer?.email === DEMO_EMAIL, `/api/me should show the demo organizer, got ${me.text}`);
    }
    log('demo sign-in ok');
  } finally {
    if (server) await server.stop();
    rm(data);
  }
}

async function caseHelp() {
  const helpMod = await import('../../src/content/help');
  const { HELP, SAMPLE_SHEET_CSV, DIRTY_SAMPLE_CSV, WIZARD_STEP_KEYS } = helpMod;
  const required = ['upload', 'fix', 'columns', 'awards', 'design', 'email', 'preview', 'send', 'dashboard', 'tickets', 'settings',
    'googleSignIn', 'gmailLimit', 'smtp', 'drive', 'linkedin', 'reportProblem'];
  for (const k of required) {
    const h = (HELP as Record<string, { title?: string; body?: string; tips?: string[] } | undefined>)[k];
    must(h, `missing help key "${k}"`);
    must(h!.title && h!.title.trim().length > 3, `help "${k}" needs a title`);
    must(h!.body && h!.body.trim().length > 40, `help "${k}" needs a real body`);
    if (h!.tips) must(h!.tips.every((t) => t.trim().length > 0), `help "${k}" has an empty tip`);
  }
  must(Object.keys(HELP).length === required.length, `HELP has unexpected keys: ${Object.keys(HELP).filter((k) => !required.includes(k)).join(', ')}`);
  log(`all ${required.length} help entries present`);

  const { parseSheet, validateSheet, suggestMappings } = await import('../../src/lib/ingest');
  const mapAndValidate = (csv: string) => {
    const sheet = parseSheet(new TextEncoder().encode(csv), 'sample.csv');
    const sug = suggestMappings(sheet.headers);
    const col = (ph: string) => sug.find((s) => s.placeholder === ph)?.column ?? undefined;
    must(sug.every((s) => !s.ambiguous || !['NAME', 'EMAIL', 'EVENT', 'CERTIFICATE_TYPE'].includes(s.placeholder)), 'sample headings must map without ambiguity');
    const mapping = sug.filter((s) => s.column).map((s) => ({ placeholder: s.placeholder, column: s.column! }));
    must(col('NAME') && col('EMAIL') && col('CERTIFICATE_TYPE') && col('EVENT'), 'sample headings must auto-map NAME, EMAIL, EVENT and CERTIFICATE_TYPE');
    const res = validateSheet(sheet, { batchId: 'demo-check', mapping, email: { primary: col('EMAIL')!, fallback: col('PERSONAL_EMAIL') }, awardColumns: [col('CERTIFICATE_TYPE')!] });
    return { sheet, res };
  };
  const clean = mapAndValidate(SAMPLE_SHEET_CSV);
  must(clean.sheet.rows.length === 25, `sample sheet should have 25 rows, has ${clean.sheet.rows.length}`);
  must(clean.res.valid.length === 25 && clean.res.invalid.length === 0, `sample sheet should give 25 valid rows, got ${clean.res.valid.length} valid / ${clean.res.invalid.length} invalid`);
  const awards = new Set(clean.sheet.rows.map((r) => r['Certificate Type']));
  for (const a of ['1st Prize', '2nd Prize', '3rd Prize', 'Honourable Mention', 'Best UI', 'Participation']) must(awards.has(a), `sample sheet is missing the "${a}" award`);
  log('SAMPLE_SHEET_CSV parses into 25 valid rows');
  const dirty = mapAndValidate(DIRTY_SAMPLE_CSV);
  const errs = dirty.res.issues.filter((i) => i.severity === 'error');
  must(errs.length >= 3, `dirty sample should produce at least 3 errors, got ${errs.length}`);
  must(dirty.res.valid.length < 25, 'dirty sample must lose some rows');
  log(`DIRTY_SAMPLE_CSV produces ${errs.length} errors, ${dirty.res.valid.length} rows still valid`);

  const files: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src', 'app'));
  walk(path.join(ROOT, 'src', 'components'));
  const corpus = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const importsHelp = /content\/help/.test(corpus);
  const loops = /WIZARD_STEP_KEYS|ALL_HELP_KEYS|Object\.keys\(\s*HELP\s*\)/.test(corpus);
  const unlinked = [...WIZARD_STEP_KEYS, 'googleSignIn', 'gmailLimit'].filter((k) => !new RegExp(`["'\`]${k}["'\`]|HELP\\.${k}\\b`).test(corpus));
  const sampleLinked = /SAMPLE_SHEET_CSV|sample-students|sample-sheet/.test(corpus);
  if (!importsHelp || (!loops && unlinked.length) || !sampleLinked) {
    throw new Pending(`UI does not link the help yet: imports src/content/help=${importsHelp}; unlinked keys=[${loops ? 'n/a (loops over all keys)' : unlinked.join(', ')}]; sample-sheet download linked=${sampleLinked}. Searched ${files.length} files under src/app and src/components.`);
  }
  log('every wizard step help key and the sample sheet are linked from the UI');
}

async function caseReadme() {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const heading = (re: RegExp, what: string) => must(re.test(readme), `README is missing: ${what}`);
  heading(/^#{2,3}\s.*macOS/im, 'a quick start section for macOS');
  heading(/^#{2,3}\s.*Windows/im, 'a quick start section for Windows');
  heading(/^#{2,3}\s.*Linux/im, 'a quick start section for Linux');
  heading(/npm install/, '`npm install`');
  heading(/npm run demo/, '`npm run demo`');
  heading(/localhost:3000/, 'the localhost:3000 address');
  heading(/nodejs\.org/i, 'the Node.js download link');
  heading(/^#{2,3}\s.*(Sending options|How emails are sent)/im, 'a sending options section');
  heading(/Test outbox/, 'the Test outbox option');
  heading(/\bSMTP\b/, 'SMTP');
  heading(/Gmail API/, 'Gmail API');
  heading(/STARTTLS/, 'STARTTLS / port 587');
  heading(/App Password/i, 'Gmail App Password');
  heading(/^#{2,3}\s.*Google Cloud setup/im, 'a "Google Cloud setup" section');
  heading(/\/api\/auth\/google\/callback/, 'the OAuth redirect URI');
  heading(/GOOGLE_CLIENT_ID/, 'GOOGLE_CLIENT_ID');
  heading(/GOOGLE_CLIENT_SECRET/, 'GOOGLE_CLIENT_SECRET');
  heading(/ORGANIZER_EMAILS/, 'ORGANIZER_EMAILS');
  heading(/^#{2,3}\s.*Google Drive/im, 'a Google Drive section');
  heading(/GOOGLE_FONTS_API_KEY/, 'GOOGLE_FONTS_API_KEY');
  heading(/^#{2,3}\s.*Troubleshooting/im, 'a Troubleshooting section');
  heading(/hosted/i, 'how to use the hosted link');
  for (let n = 1; n <= 15; n++) must(new RegExp(`^\\|\\s*\\**Rule ${n}\\**\\s*\\|`, 'm').test(readme), `README rules table is missing the "Rule ${n}" row`);
  heading(/critical/i, 'the critical judging rule row');
  log('all required README sections and 15 rule rows present');

  const pitch = fs.readFileSync(path.join(ROOT, 'docs', 'pitch.md'), 'utf8');
  for (const crit of ['Problem', 'Functionality', 'Accuracy', 'UX', 'Innovation', 'Technical', 'Scalability', 'Presentation']) must(pitch.includes(crit), `pitch.md does not mention ${crit}`);
  must(fs.existsSync(path.join(ROOT, 'docs', 'architecture.md')), 'docs/architecture.md is missing');
  log('docs/pitch.md and docs/architecture.md present');
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) must(ci.includes(os), `ci.yml does not run on ${os}`);
}

async function caseCleanClone() {
  const clone = tmp('clone');
  const data = tmp('clonedata');
  let server: Server | undefined;
  try {
    const skip = new Set(['node_modules', 'data', '.unlazy', '.git', 'test-results', 'playwright-report', '.agents', '.claude']);
    fs.cpSync(ROOT, clone, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(ROOT, src);
        if (!rel) return true;
        const top = rel.split(path.sep)[0];
        return !(skip.has(top) || top.startsWith('.next') || top.endsWith('.tsbuildinfo') || top === 'next-env.d.ts' || /^\.env(\..*)?$/.test(top) && top !== '.env.example');
      },
    });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(clone, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    log(`copied repo to ${clone}`);

    const password = 'clone-pass-12345';
    await runSetup(clone, data, password);
    log('setup ok in the clean copy');

    const needed: string[][] = [['health'], ['auth', 'login'], ['uploads'], ['sheets', 'parse'], ['awards', 'discover'], ['batches'], ['batches', '[id]', 'prepare'], ['batches', '[id]', 'start'], ['batches', '[id]']];
    const missing = needed.filter((r) => !routeExists(clone, ...r)).map((r) => '/api/' + r.join('/'));
    if (!fs.existsSync(path.join(clone, 'src', 'app')) || missing.length) throw new Pending(`routes not written yet: ${missing.join(', ') || 'src/app'}`);

    const env = cleanEnv({ CERTFLOW_DATA_DIR: data, NEXT_DIST_DIR: '.next-clean', CERTFLOW_BASE_URL: 'http://127.0.0.1:3105' });
    const build = await runNode([NEXT_BIN, 'build'], clone, env, 900000);
    must(build.code === 0, `next build failed in the clean copy:\n${build.out.slice(-3000)}`);
    log('next build ok');

    server = startServer(clone, 'start', 3105, env);
    const c = new Client(server.url);
    await waitFor(async () => (await c.req('GET', '/api/health')).status === 200, 90000, 'GET /api/health', server);
    const login = await c.req('POST', '/api/auth/login', { email: DEMO_EMAIL, password });
    must(login.status === 200, `sign-in failed (${login.status}): ${login.text}`);

    const csv = fs.readFileSync(path.join(data, 'samples', 'sample-students.csv'));
    const form = new FormData();
    form.set('kind', 'sheet');
    form.set('file', new Blob([csv], { type: 'text/csv' }), 'sample-students.csv');
    const up = await c.req('POST', '/api/uploads', undefined, form);
    must(up.status === 200 && up.json?.id, `upload failed (${up.status}): ${up.text}`);
    const parsed = await c.req('POST', '/api/sheets/parse', { uploadId: up.json.id });
    must(parsed.status === 200 && parsed.json?.rowCount === 25, `sheet parse should find 25 rows: ${parsed.text.slice(0, 300)}`);
    const sug = parsed.json.suggestions as { placeholder: string; column: string | null }[];
    const col = (ph: string) => sug.find((s) => s.placeholder === ph)?.column ?? undefined;
    const mapping = sug.filter((s) => s.column).map((s) => ({ placeholder: s.placeholder, column: s.column! }));
    must(col('NAME') && col('EMAIL') && col('CERTIFICATE_TYPE'), 'server did not auto-map the sample headings');

    const awardCol = col('CERTIFICATE_TYPE')!;
    const disc = await c.req('POST', '/api/awards/discover', { uploadId: up.json.id, awardColumns: [awardCol] });
    must(disc.status === 200 && disc.json?.categories?.length >= 6, `award discovery should find at least 6 award types: ${disc.text.slice(0, 300)}`);

    const { schemeFromDiscovery } = await import('../../src/lib/routing');
    const { listBuiltinTemplates } = await import('../../src/lib/render/builtin');
    const templateId = listBuiltinTemplates()[0].id;
    const scheme = schemeFromDiscovery('clone-scheme', 'Clone check', [awardCol], disc.json.categories, () => templateId, { defaultTemplateId: templateId });

    const emailTpls = await c.req('GET', '/api/email-templates');
    const emailId: string = emailTpls.json?.templates?.[0]?.id ?? emailTpls.json?.[0]?.id ?? 'default-email';
    const created = await c.req('POST', '/api/batches', { name: 'Clean clone check' });
    must(created.status === 200 && created.json?.id, `batch create failed (${created.status}): ${created.text}`);
    const batchId: string = created.json.id;

    const draft = {
      mapping, email: { primary: col('EMAIL')!, fallback: col('PERSONAL_EMAIL') }, required: ['NAME'], scheme,
      templateIds: [templateId], emailTemplateIds: [emailId], defaultEmailTemplateId: emailId,
      folderPattern: 'Facilify/{{EVENT}}/{{CERTIFICATE_TYPE}}', organizationName: 'Demo College Tech Club', linkedIn: true, concurrency: 4,
      issuedAt: new Date().toISOString(),
    };
    const prep = await c.req('POST', `/api/batches/${batchId}/prepare`, { uploadId: up.json.id, draft });
    must(prep.status === 200, `prepare failed (${prep.status}): ${prep.text.slice(0, 500)}`);
    const test = await c.req('POST', `/api/batches/${batchId}/test-send`, {});
    must(test.status === 200 && test.json?.ok, `test send failed (${test.status}): ${test.text}`);
    const start = await c.req('POST', `/api/batches/${batchId}/start`, { confirm: true });
    must(start.status === 200 && start.json?.ok, `start failed (${start.status}): ${start.text}`);
    log('batch started with the Test outbox');

    let last = '';
    await waitFor(async () => {
      const b = await c.req('GET', `/api/batches/${batchId}`);
      const counts = b.json?.counts as Record<string, number> | undefined;
      last = JSON.stringify(counts);
      if (!counts) return false;
      const total = Object.values(counts).reduce((a, n) => a + n, 0);
      must(!counts.FAILED, `some certificates failed: ${last}`);
      return total === 25 && counts.SENT === 25;
    }, 240000, 'every certificate to show Sent', server).catch((e) => { throw new Error(`${e.message}\nlast counts: ${last}`); });
    log('dashboard API reports all 25 certificates Sent');

    const expected = new Map<string, number>();
    for (const line of csv.toString('utf8').trim().split(/\r?\n/).slice(1)) {
      const cells = line.split(',');
      expected.set(cells[2].toLowerCase(), (expected.get(cells[2].toLowerCase()) ?? 0) + 1);
    }
    const emls: string[] = [];
    const walk = (d: string) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.eml')) emls.push(p); } };
    walk(path.join(data, 'outbox'));
    const real = emls.map((f) => fs.readFileSync(f, 'latin1')).filter((t) => !/^Subject:.*\[TEST\]/mi.test(t));
    must(real.length === expected.size, `expected ${expected.size} emails (one per student), found ${real.length}`);
    for (const text of real) {
      const to = /^To:.*?<?([^\s<>,]+@[^\s<>,]+)>?\s*$/mi.exec(text)?.[1]?.toLowerCase();
      must(to && expected.has(to), `unexpected recipient ${to}`);
      const pdfs = (text.match(/^Content-Type:\s*application\/pdf/gmi) ?? []).length;
      must(pdfs === expected.get(to!), `${to} should get ${expected.get(to!)} certificate(s), got ${pdfs}`);
    }
    log('outbox: one email per student, each with exactly that student\'s certificates');
  } finally {
    if (server) await server.stop();
    rm(clone);
    rm(data);
  }
}

const CASES: Record<string, { run: () => Promise<void>; token: string }> = {
  'cross-platform': { run: caseCrossPlatform, token: 'DEMO CROSS PLATFORM OK' },
  help: { run: caseHelp, token: 'DEMO HELP OK' },
  readme: { run: caseReadme, token: 'DEMO README OK' },
  'clean-clone': { run: caseCleanClone, token: 'DEMO CLEAN CLONE OK' },
};

async function main() {
  const i = process.argv.indexOf('--case');
  const which = i >= 0 ? process.argv[i + 1] : 'all';
  const names = which === 'all' ? Object.keys(CASES) : [which];
  for (const n of names) if (!CASES[n]) { console.error(`Unknown case "${n}". Choose: ${Object.keys(CASES).join(', ')}, all`); process.exit(1); }
  let failed = false;
  let pending = false;
  const tokens: string[] = [];
  for (const n of names) {
    console.log(`case ${n}`);
    try { await CASES[n].run(); tokens.push(CASES[n].token); console.log(`  PASS ${n}`); }
    catch (e) {
      if (e instanceof Pending) { pending = true; console.log(`  PENDING-INTEGRATION ${n}: ${e.message}`); }
      else { failed = true; console.log(`  FAIL ${n}: ${(e as Error).message}`); }
    }
  }
  if (failed) process.exit(1);
  if (pending) { console.log('PENDING-INTEGRATION'); process.exit(2); }
  for (const t of tokens) console.log(t);
}
main().catch((e) => { console.error(e); process.exit(1); });
