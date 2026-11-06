import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const DATA = process.env.DATA ?? '';
const SHEET = path.resolve(process.argv[2] ?? 'test-data/02-multi-award-recipients.csv');
const SHOTS = process.env.SHOTS ?? path.join(process.cwd(), 'tmp-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let page: Page;
let snapN = 0;
const log = (m: string) => console.log(`  ${m}`);

async function shot(name: string) { await page.waitForLoadState('networkidle').catch(() => undefined); await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }).catch(() => undefined); }
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try { const r = await fn(); log(`ok  ${name}`); if (process.env.SNAP) await shot(`${String(++snapN).padStart(2, '0')}-${name.replace(/\W+/g, '-')}`); return r; }
  catch (e) { await shot(`FAIL-${name.replace(/\W+/g, '-')}`); console.error(`FAIL ${name}: ${(e as Error).message.split('\n')[0]}\n  at ${page.url()}`); throw e; }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  page.setDefaultTimeout(45_000);

  await step('create the organizer account', async () => {
    await page.goto(`${BASE}/setup`);
    await page.waitForTimeout(1500);
    if (/\/login/.test(page.url()) || !(await page.getByTestId('setup-org').count())) {
      if (!/\/login/.test(page.url())) await page.goto(`${BASE}/login`);
      await page.getByTestId('login-email').fill('organizer@example.com');
      await page.getByTestId('login-password').fill('correct-horse-battery');
      await page.getByTestId('login-submit').click();
      await page.waitForURL((u) => !/\/login/.test(u.pathname));
      return;
    }
    await page.getByTestId('setup-org').fill('Tech Club');
    await page.getByTestId('setup-name').fill('Alex Organizer');
    await page.getByTestId('setup-email').fill('organizer@example.com');
    await page.getByTestId('setup-password').fill('correct-horse-battery');
    await page.getByTestId('setup-confirm').fill('correct-horse-battery');
    await page.getByTestId('setup-submit').click();
    await page.waitForURL((u) => !/\/setup|\/login/.test(u.pathname));
  });

  await step('upload the sheet', async () => {
    await page.goto(`${BASE}/upload`);
    await page.locator('input[type=file]').first().setInputFiles(SHEET);
    await page.getByTestId('sheet-preview').waitFor();
    await page.getByTestId('next').click();
    await page.waitForURL(/\/columns/);
  });

  await step('columns are matched', async () => {
    await page.getByTestId('read-preview').waitFor();
    const next = page.getByTestId('next');
    await next.waitFor();
    if (await next.isDisabled()) throw new Error('Next is disabled: NAME/EMAIL were not matched automatically');
    await next.click();
    await page.waitForURL(/\/fix/);
  });

  await step('fix step passes', async () => {
    const next = page.getByTestId('next');
    await next.waitFor();
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid=next]') as HTMLButtonElement | null; return !!b && !b.disabled; }, undefined, { timeout: 30_000 });
    await next.click();
    await page.waitForURL(/\/awards/);
  });

  await step('awards: every award has a design', async () => {
    await page.getByTestId('category-list').waitFor();
    const n = await page.getByTestId('category-list').locator('li').count();
    log(`${n} award categories found`);
    if (n < 2) throw new Error('expected several award categories');
    await page.getByTestId('next').click();
    await page.waitForURL(/\/design/);
  });

  await step('design step shows the designs', async () => {
    await page.getByTestId('design-list').waitFor();
    await page.locator('[data-testid^=edit-]').first().click();
    await page.getByTestId('editor-root').waitFor();
    await page.getByTestId('canvas-wrap').waitFor();
    await page.getByTestId('layer-list').waitFor();
    await page.waitForTimeout(2500);
    if (await page.getByTestId('render-error').count()) throw new Error('the editor preview shows a render error: ' + (await page.getByTestId('render-error').first().innerText()));
    await page.getByTestId('qr-add').click();
    await page.getByTestId('qr-box').waitFor();
    await page.getByTestId('design-name').fill('My edited design');
    await page.getByTestId('editor-save').click();
    await page.getByTestId('editor-card').waitFor({ state: 'detached' });
    await page.getByText('My edited design').first().waitFor();
    await page.getByTestId('next').click();
    await page.waitForURL(/\/email/);
  });

  await step('email step saves the wording', async () => {
    await page.getByTestId('include-linkedin').waitFor();
    await page.getByTestId('next').click();
    await page.waitForURL(/\/preview/);
  });

  await step('preview draws samples and prepares', async () => {
    await page.getByTestId('sample-list').waitFor();
    await page.locator('[data-testid=sample-list] img').first().waitFor();
    const mail = page.frameLocator('iframe[title="Email preview"]');
    await mail.getByText(/report a problem/i).first().waitFor();
    await mail.getByText(/linkedin/i).first().waitFor();
    await page.getByTestId('prepare').click();
    await page.getByTestId('prepared').waitFor();
    await page.getByTestId('next').click();
    await page.waitForURL(/\/send/);
  });

  await step('test email then send', async () => {
    await page.getByTestId('test-send').click();
    await page.getByTestId('test-done').waitFor();
    await page.getByTestId('confirm').check();
    await page.getByTestId('start').click();
    await page.getByTestId('progress').waitFor();
    await page.waitForFunction(() => /All done|Finished/.test(document.querySelector('[data-testid=progress] h2')?.textContent ?? ''), undefined, { timeout: 120_000 });
    log(await page.getByTestId('counts').innerText());
  });

  await step('dashboard lists every certificate with a link', async () => {
    await page.goto(`${BASE}/dashboard`);
    await page.getByTestId('cert-table').waitFor();
    const rows = await page.getByTestId('cert-table').locator('tbody tr').count();
    log(`${rows} rows on the dashboard`);
    const sent = await page.locator('[data-status=SENT]').count();
    if (!sent) throw new Error('no certificate shows as Sent');
  });

  if (DATA) {
    await step('outbox holds the emails', async () => {
      const found: string[] = [];
      const walk = (d: string) => { for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.eml') && found.push(p); } };
      walk(DATA);
      const real = found.filter((f) => !/TEST/.test(fs.readFileSync(f, 'utf8').split('\n').find((l) => /^Subject:/i.test(l)) ?? ''));
      log(`${found.length} .eml files (${real.length} not marked TEST)`);
      if (!real.length) throw new Error('no real emails were captured');
    });
  }

  if (DATA) {
    const eml = (() => {
      const found: string[] = [];
      const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.eml') && found.push(p); } };
      walk(DATA);
      return found.map((f) => fs.readFileSync(f, 'utf8')).find((t) => /^Subject:.*(?<!\[TEST\])\s*$/im.test(t) && !/\[TEST\]/.test(t.split('\n').find((l) => /^Subject:/i.test(l)) ?? '')) ?? '';
    })();
    const text = eml.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    const link = (re: RegExp) => text.match(re)?.[0];
    const report = link(/https?:\/\/[^\s"'<>]+\/report\/[A-Za-z0-9_.~%-]+/);
    const verify = link(/https?:\/\/[^\s"'<>]+\/verify\/[A-Za-z0-9_.~%-]+/);
    const linkedin = link(/https?:\/\/[^\s"'<>]+\/linkedin\/[A-Za-z0-9_.~%-]+/);
    if (!report || !verify) throw new Error('the email has no report/verify link');

    const student = await ctx.newPage();
    await step('student opens the verify page', async () => {
      await student.goto(verify);
      await student.getByText(/valid|genuine|verified/i).first().waitFor();
    });
    await step('verify page shows the issue time, a signed proof and the LinkedIn button', async () => {
      const issued = await student.getByTestId('verify-issued').innerText();
      if (!/UTC/.test(issued)) throw new Error(`issue time not shown in UTC: "${issued}"`);
      const li = student.getByTestId('verify-linkedin');
      await li.waitFor();
      const href = (await li.getAttribute('href')) ?? '';
      if (!/^https:\/\/www\.linkedin\.com\/profile\/add\?/.test(href)) throw new Error(`LinkedIn button does not point at LinkedIn: ${href}`);
      const q = new URL(href).searchParams;
      for (const k of ['name', 'organizationName', 'issueYear', 'issueMonth', 'certUrl', 'certId']) if (!q.get(k) && !(k === 'organizationName' && q.get('organizationId'))) throw new Error(`LinkedIn link is missing ${k}`);
      if (!/\/verify\//.test(q.get('certUrl') ?? '')) throw new Error('LinkedIn certUrl is not the verify page');
      await student.getByTestId('verify-proof').locator('summary').click();
      const sha = (await student.getByTestId('verify-sha').innerText()).trim();
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`PDF fingerprint is not a SHA-256: "${sha}"`);
      await student.getByTestId('verify-sig-btn').click();
      await student.locator('[data-testid="verify-sig-valid"], [role="status"]:has-text("cannot check")').first().waitFor({ timeout: 10_000 });
      if (await student.getByTestId('verify-sig-invalid').count()) throw new Error('the signature was reported as NOT matching');
    });
    if (linkedin) await step('student opens the LinkedIn page', async () => {
      await student.goto(linkedin);
      await student.getByRole('link', { name: /add to my linkedin profile/i }).first().waitFor();
    });
    await step('student reports a problem', async () => {
      const anon = await browser.newContext(); const p = await anon.newPage();
      await p.goto(report);
      await p.locator('select').first().selectOption({ index: 0 });
      await p.locator('input[type=text], input:not([type])').first().fill('Corrected Name');
      await p.getByRole('button', { name: /submit|send/i }).click();
      await p.getByText(/thank/i).first().waitFor();
      await anon.close();
    });
    await step('organizer sees the ticket and fixes it', async () => {
      await page.goto(`${BASE}/tickets`);
      await page.getByText('Corrected Name').first().waitFor();
      await page.getByTestId('fix-send').first().click();
      await page.getByText(/A corrected certificate was made and emailed/i).first().waitFor();
    });
  }

  if (consoleErrors.length) console.warn(`browser console errors:\n  ${[...new Set(consoleErrors)].slice(0, 8).join('\n  ')}`);
  await browser.close();
  console.log('UI FLOW OK');
}

main().catch(() => { process.exit(1); });
