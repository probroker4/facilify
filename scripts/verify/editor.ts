import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from '@playwright/test';

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 3102;
const BASE = `http://localhost:${PORT}`;
const FIXTURES = path.join(ROOT, 'fixtures', 'editor');

let checks = 0;
function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  checks++;
  console.log(`  ok ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${msg} (got ${JSON.stringify(actual)}${JSON.stringify(actual) === JSON.stringify(expected) ? '' : `, wanted ${JSON.stringify(expected)}`})`);
}
function near(actual: number, expected: number, tol: number, msg: string): void {
  ok(Math.abs(actual - expected) <= tol, `${msg} (got ${Math.round(actual * 100) / 100}, wanted ${expected} +/- ${tol})`);
}

export const KNOWN = {
  paper: '#f5eec8',
  blocks: [
    { hex: '#c0392b', x: 60, y: 60 }, { hex: '#3a7bd5', x: 662, y: 60 }, { hex: '#27ae60', x: 60, y: 415 }, { hex: '#8e44ad', x: 662, y: 415 },
  ],
  size: 120,
  page: [842, 595] as [number, number],
};

async function ensureFixtures(): Promise<{ pdf: string; png: string }> {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const pdfPath = path.join(FIXTURES, 'known-template.pdf');
  const pngPath = path.join(FIXTURES, 'known-template.png');
  if (fs.existsSync(pdfPath) && fs.existsSync(pngPath)) return { pdf: pdfPath, png: pngPath };
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const { createCanvas } = await import('@napi-rs/canvas');
  const col = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const [W, H] = KNOWN.page;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const playfair = await doc.embedFont(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'playfair-display', 'latin-700-normal.ttf')), { subset: true });
  const lato = await doc.embedFont(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'lato', 'latin-400-normal.ttf')), { subset: true });
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: col(KNOWN.paper) });
  for (const b of KNOWN.blocks) page.drawRectangle({ x: b.x, y: H - b.y - KNOWN.size, width: KNOWN.size, height: KNOWN.size, color: col(b.hex) });
  page.drawText('Certificate of Merit', { x: 250, y: H - 120, size: 36, font: playfair, color: col('#222222') });
  page.drawText('Awarded for outstanding work', { x: 290, y: H - 160, size: 16, font: lato, color: col('#444444') });
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  fs.writeFileSync(pdfPath, await doc.save());

  const k = 2;
  const canvas = createCanvas(W * k, H * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = KNOWN.paper;
  ctx.fillRect(0, 0, W * k, H * k);
  for (const b of KNOWN.blocks) { ctx.fillStyle = b.hex; ctx.fillRect(b.x * k, b.y * k, KNOWN.size * k, KNOWN.size * k); }
  fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
  return { pdf: pdfPath, png: pngPath };
}

let data = '';
let server: ChildProcess | null = null;
let serverLog = '';
let cookieValue = '';

async function portBusy(): Promise<boolean> {
  try { await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}

async function startServer(): Promise<void> {
  if (await portBusy()) throw new Error(`Port ${PORT} is already in use. Stop whatever is listening there and run the check again.`);
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'certflow-editor-'));
  const cache = path.join(ROOT, 'data', 'fonts');
  if (fs.existsSync(cache)) fs.cpSync(cache, path.join(data, 'fonts'), { recursive: true });
  const secret = crypto.randomBytes(24).toString('hex');
  process.env.CERTFLOW_DATA_DIR = data;
  process.env.CERTFLOW_SECRET = secret;

  const { openDb, run, nowIso } = await import('../../src/lib/db/db');
  const { signSession } = await import('../../src/lib/auth/session');
  const db = openDb();
  run(db, 'INSERT INTO organizers (id, email, name, password_hash, active, created_at) VALUES (?,?,?,?,1,?)', 'org_editor_check', 'editor-check@example.test', 'Editor Check', 'unused', nowIso());
  cookieValue = signSession('org_editor_check');

  const next = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  server = spawn(process.execPath, [next, 'dev', '-p', String(PORT)], {
    cwd: ROOT, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_DIST_DIR: '.next-editor', CERTFLOW_DATA_DIR: data, CERTFLOW_SECRET: secret, CERTFLOW_BASE_URL: BASE, NEXT_TELEMETRY_DISABLED: '1' },
  });
  server.stdout?.on('data', (d) => { serverLog = (serverLog + String(d)).slice(-6000); });
  server.stderr?.on('data', (d) => { serverLog = (serverLog + String(d)).slice(-6000); });
  const t0 = Date.now();
  for (;;) {
    if (server.exitCode !== null) throw new Error(`The dev server stopped early:\n${serverLog}`);
    if (await portBusy()) break;
    if (Date.now() - t0 > 120_000) throw new Error(`The dev server did not start in 2 minutes:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`  dev server ready on ${BASE} (data in ${data})`);
}

function stopServer(): void {
  if (server && server.pid && server.exitCode === null) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-server.pid, 'SIGTERM');
    } catch {  }
  }
  server = null;
  if (data) { try { fs.rmSync(data, { recursive: true, force: true }); } catch {  } }
}

const TYPES: Record<string, BrowserType> = { chromium, firefox, webkit };

async function withPage<T>(name: 'chromium' | 'firefox' | 'webkit', fn: (page: Page, ctx: BrowserContext) => Promise<T>, init?: string): Promise<T> {
  let browser: Browser;
  try {
    browser = await TYPES[name].launch();
  } catch (e) {
    throw new Error(`Could not start ${name}. Install the browsers with: npx playwright install ${name}\n${e instanceof Error ? e.message : e}`);
  }
  try {
    const ctx = await browser.newContext({ viewport: { width: 1720, height: 1150 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'cf_session', value: cookieValue, url: BASE }]);
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60_000);
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    const out = await fn(page, ctx);
    ok(problems.length === 0, `${name}: no uncaught errors in the page${problems.length ? ` (${problems[0]})` : ''}`);
    return out;
  } finally {
    await browser.close();
  }
}

const tid = (id: string) => `[data-testid="${id}"]`;

async function openEditor(page: Page, query = ''): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('facilify.editor.mode', 'advanced'); localStorage.setItem('facilify.editor.hint', 'off'); } catch {  } });
  await page.goto(`${BASE}/dev/editor${query}`, { waitUntil: 'load', timeout: 120_000 });
  await fresh(page);
}

async function fresh(page: Page): Promise<void> {
  await page.waitForSelector(`${tid('editor-root')}[data-render-fresh="1"]`, { timeout: 90_000 });
}

async function templateJson(page: Page): Promise<any> {
  return JSON.parse(await page.evaluate(() => document.querySelector('[data-testid="template-json"]')!.textContent || '{}'));
}
async function layerById(page: Page, id: string): Promise<any> {
  return (await templateJson(page)).layers.find((l: any) => l.id === id);
}
async function selectedLayerId(page: Page): Promise<string> {
  return (await page.getAttribute(tid('style-panel'), 'data-layer-id')) as string;
}
async function settle<T>(page: Page, pick: (t: any) => T, want: T, what: string): Promise<void> {
  const t0 = Date.now();
  let last: T | undefined;
  while (Date.now() - t0 < 8000) {
    last = pick(await templateJson(page));
    if (JSON.stringify(last) === JSON.stringify(want)) { ok(true, `${what} -> ${JSON.stringify(want)}`); return; }
    await page.waitForTimeout(100);
  }
  ok(false, `${what}: wanted ${JSON.stringify(want)}, template JSON has ${JSON.stringify(last)}`);
}

async function scaleOf(page: Page): Promise<number> {
  return Number(await page.getAttribute(tid('canvas'), 'data-scale'));
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number, hold?: () => Promise<void>): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  if (hold) await hold();
  await page.mouse.up();
}

async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} is not visible`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

interface Pixels { w: number; h: number; data: Uint8ClampedArray }

async function decodePng(buf: Buffer): Promise<Pixels> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data as unknown as Uint8ClampedArray };
}

interface Diff { mean: number; big: number; max: number; counted: number }
function diffPixels(a: Pixels, b: Pixels, skip?: (x: number, y: number) => boolean, bigAt = 48): Diff {
  ok(Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1, `images are the same size (${a.w}x${a.h} vs ${b.w}x${b.h})`);
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  let sum = 0, big = 0, max = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (skip?.(x, y)) continue;
      const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[j]), Math.abs(a.data[i + 1] - b.data[j + 1]), Math.abs(a.data[i + 2] - b.data[j + 2]));
      sum += d; n++;
      if (d > bigAt) big++;
      if (d > max) max = d;
    }
  }
  return { mean: sum / Math.max(1, n), big: big / Math.max(1, n), max, counted: n };
}

const hexAt = (p: Pixels, x: number, y: number) => `#${[0, 1, 2].map((k) => p.data[(y * p.w + x) * 4 + k].toString(16).padStart(2, '0')).join('')}`;

async function serverPdf(page: Page, template: unknown, values: Record<string, string>): Promise<Buffer> {
  const res = await page.context().request.post(`${BASE}/api/editor/preview`, { data: { template, values, format: 'pdf' } });
  ok(res.ok(), `server renders the PDF (HTTP ${res.status()})`);
  return Buffer.from(await res.body());
}

async function rasterOfPdf(pdf: Uint8Array, scale = 1): Promise<Pixels> {
  const { rasterizePdf } = await import('../../src/lib/render/raster');
  const r = await rasterizePdf(new Uint8Array(pdf), scale);
  return { w: r.width, h: r.height, data: r.data };
}

async function canvasShot(page: Page): Promise<Pixels> {
  return decodePng(await page.locator(tid('canvas')).screenshot());
}

async function setZoom100(page: Page): Promise<void> {
  await page.selectOption(tid('zoom'), '1');
  await fresh(page);
}

async function caseControls(): Promise<void> {
  console.log('Case controls: add a layer, type text with a placeholder, drag, resize, nudge, change every style control, save.');
  await withPage('chromium', async (page) => {
    await openEditor(page);
    const before = await templateJson(page);
    const n0 = before.layers.length;
    eq(await page.locator('[data-testid^="layer-box-"]').count(), n0, 'every layer has a box on the canvas');

    await page.click(tid('layer-add'));
    await settle(page, (t) => t.layers.length, n0 + 1, 'Add text adds a layer');
    const id = await selectedLayerId(page);
    ok(!!id && !before.layers.some((l: any) => l.id === id), `the new layer ${id} is selected`);
    await page.fill(tid('content-input'), 'Awarded to ');
    await page.click(tid('placeholder-chip-NAME'));
    await page.keyboard.type(' for ');
    await page.click(tid('placeholder-chip-ACHIEVEMENT'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).content, 'Awarded to {{NAME}} for {{ACHIEVEMENT}}', 'static text mixed with two placeholders');
    await fresh(page);
    const scale = await scaleOf(page);

    const l0 = await layerById(page, id);
    const box = tid(`layer-box-${id}`);
    await page.keyboard.down('Alt');
    await dragBy(page, await centreOf(page, box), 70, 90);
    await page.keyboard.up('Alt');
    const l1 = await layerById(page, id);
    near(l1.x - l0.x, 70 / scale, 1.5, 'dragging the box right by 70px moves it that far in points');
    near(l1.y - l0.y, 90 / scale, 1.5, 'dragging the box down by 90px moves it that far in points');

    const se = await centreOf(page, tid('handle-se'));
    await dragBy(page, se, 40, 20);
    const l2 = await layerById(page, id);
    near(l2.width - l1.width, 40 / scale, 1.5, 'the south-east handle widens the box');
    near(l2.height - l1.height, 20 / scale, 1.5, 'the south-east handle heightens the box');
    eq([l2.x, l2.y], [l1.x, l1.y], 'resizing from the south-east keeps the top-left corner');
    const nw = await centreOf(page, tid('handle-nw'));
    await dragBy(page, nw, 12, 8);
    const l3 = await layerById(page, id);
    near(l3.x - l2.x, 12 / scale, 1.5, 'the north-west handle moves the left edge');
    near(l3.width, l2.width - 12 / scale, 1.5, 'the north-west handle shrinks the width');
    near(l3.x + l3.width, l2.x + l2.width, 0.6, 'the right edge stays put when the left edge is dragged');
    near(l3.y + l3.height, l2.y + l2.height, 0.6, 'the bottom edge stays put when the top edge is dragged');

    await page.focus(box);
    await page.keyboard.press('ArrowRight');
    await settle(page, (t) => Math.round((t.layers.find((l: any) => l.id === id).x - l3.x) * 10) / 10, 1, 'ArrowRight nudges by 1 pt');
    await page.keyboard.press('Shift+ArrowDown');
    await settle(page, (t) => Math.round((t.layers.find((l: any) => l.id === id).y - l3.y) * 10) / 10, 10, 'Shift+ArrowDown nudges by 10 pt');
    await page.click(tid('nudge-left'));
    await settle(page, (t) => Math.round((t.layers.find((l: any) => l.id === id).x - l3.x) * 10) / 10, 0, 'the Nudge left button moves 1 pt');

    await page.fill(tid('x-input'), '100'); await page.fill(tid('y-input'), '120.5');
    await page.fill(tid('w-input'), '300'); await page.fill(tid('h-input'), '60');
    await settle(page, (t) => { const l = t.layers.find((x: any) => x.id === id); return [l.x, l.y, l.width, l.height]; }, [100, 120.5, 300, 60], 'x, y, width and height inputs');
    await page.click(tid('center-h'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).x, 271, 'Centre across page puts a 300pt box at x=271');

    await page.fill(tid('size-input'), '40');
    await page.fill(tid('min-size-input'), '12');
    await settle(page, (t) => { const s = t.layers.find((l: any) => l.id === id).style; return [s.size, s.minSize]; }, [40, 12], 'size and smallest size');
    for (const [key, pick] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['uppercase', 'uppercase']] as const) {
      await page.click(tid(`${key}-toggle`));
      await settle(page, (t) => t.layers.find((l: any) => l.id === id).style[pick], true, `${key} toggle on`);
    }
    await page.click(tid('underline-toggle'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).style.underline, false, 'underline toggle off again');
    await page.click(tid('align-right'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).style.align, 'right', 'alignment right');
    await page.click(tid('align-left'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).style.align, 'left', 'alignment left');
    await page.fill(tid('letter-spacing-input'), '2.5');
    await page.fill(tid('line-height-input'), '1.5');
    await page.fill(tid('opacity-input'), '60');
    await page.fill(tid('rotation-input'), '-8');
    await page.fill(tid('max-lines-input'), '3');
    await settle(page, (t) => { const s = t.layers.find((l: any) => l.id === id).style; return [s.letterSpacing, s.lineHeight, s.opacity, s.rotation, s.maxLines]; }, [2.5, 1.5, 0.6, -8, 3], 'letter spacing, line height, opacity, rotation, max lines');
    await page.click(`${tid('section-fit')} summary`);
    await page.selectOption(tid('fit-mode'), 'shrink');
    await page.check(tid('fit-abbreviate'));
    await page.check(tid('fit-uniform'));
    await page.fill(tid('fit-min-spacing'), '-1.5');
    await settle(page, (t) => { const f = t.layers.find((l: any) => l.id === id).style.fit; return [f.mode, f.allowAbbreviate, f.uniformAcrossBatch, f.minLetterSpacing]; }, ['shrink', true, true, -1.5], 'auto-fit mode, abbreviate, uniform size, tightest spacing');
    await page.fill(tid('color-hex'), '#12ab34');
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).style.color, '#12ab34', 'colour typed as hex');
    await page.fill(tid('font-search'), 'lora');
    await page.waitForSelector(tid('font-option-lora'));
    await page.click(tid('font-option-lora'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === id).style.fontId, 'lora', 'font chosen from the search results');
    await fresh(page);
    eq(await page.getAttribute(tid('font-current'), 'data-font-id'), 'lora', 'the panel shows the chosen font');

    await page.uncheck(tid('boxes-toggle'));
    const pageSz = (await templateJson(page)).pageSize;
    ok(pageSz[0] === 842 && pageSz[1] === 595, 'the page size stays A4 landscape');

    const count = (await templateJson(page)).layers.length;
    await page.check(tid('boxes-toggle'));
    await page.click(tid('layer-duplicate'));
    await settle(page, (t) => t.layers.length, count + 1, 'Duplicate adds a layer');
    const dupId = await selectedLayerId(page);
    ok(dupId !== id, 'the duplicate is selected and has its own id');
    const dup = await layerById(page, dupId);
    eq([dup.content, dup.style.fontId, dup.style.color], ['Awarded to {{NAME}} for {{ACHIEVEMENT}}', 'lora', '#12ab34'], 'the duplicate keeps text, font and colour');
    await page.click(tid('layer-delete'));
    await settle(page, (t) => t.layers.length, count, 'Delete removes the selected layer');
    ok((await templateJson(page)).layers.every((l: any) => l.id !== dupId), 'the deleted layer is gone');

    const current = await templateJson(page);
    await page.click(tid('dev-save'));
    await page.waitForFunction(() => document.querySelector('[data-testid="dev-status"]')?.textContent === 'Saved');
    const savedText = await page.evaluate(() => document.querySelector('[data-testid="saved-json"]')?.textContent || '');
    const saved = JSON.parse(savedText);
    const savedLayer = saved.layers.find((l: any) => l.id === id);
    eq(savedLayer, current.layers.find((l: any) => l.id === id), 'the saved CertTemplate JSON equals the edited layer, every property');
    eq(saved.layers.length, current.layers.length, 'the saved template has the same number of layers');
    const direct = await page.context().request.get(`${BASE}/api/templates/${encodeURIComponent(saved.id)}`);
    const directJson = await direct.json();
    eq((directJson.template ?? directJson).layers.find((l: any) => l.id === id).style, current.layers.find((l: any) => l.id === id).style, 'GET /api/templates/<id> returns the same style');
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR CONTROLS OK');
}

async function caseWysiwyg(): Promise<void> {
  console.log('Case wysiwyg: the canvas is the server render; the background is the untouched template outside the text boxes.');
  const fx = await ensureFixtures();
  const { DEFAULT_SAMPLE_ROWS } = await import('../../src/components/editor/sampleRows');
  await withPage('chromium', async (page) => {
    await openEditor(page);
    await setZoom100(page);
    await page.uncheck(tid('boxes-toggle'));
    await fresh(page);

    const boxesMask = (t: any, grow = 3) => (x: number, y: number) =>
      t.layers.some((l: any) => x >= l.x - grow && x <= l.x + l.width + grow && y >= l.y - grow && y <= l.y + l.height + grow);

    let t = await templateJson(page);
    let shot = await canvasShot(page);
    let pdf = await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[0]);
    let ref = await rasterOfPdf(pdf);
    let d = diffPixels(shot, ref);
    ok(d.mean < 0.5 && d.big < 0.001, `built-in design: canvas matches the server PDF (mean diff ${d.mean.toFixed(3)}, ${(d.big * 100).toFixed(3)}% of pixels differ a lot)`);
    const bgRef = await rasterOfPdf(new Uint8Array(await (await page.context().request.post(`${BASE}/api/editor/preview`, { data: { template: { ...t, layers: [] }, values: {}, format: 'pdf' } })).body()));
    let bd = diffPixels(shot, bgRef, boxesMask(t));
    ok(bd.mean < 0.3 && bd.big < 0.0005, `built-in design: outside the text boxes the canvas equals the untouched template (mean diff ${bd.mean.toFixed(3)}, max ${bd.max})`);
    const inside = diffPixels(shot, bgRef, (x, y) => !boxesMask(t, 0)(x, y));
    ok(inside.big > 0.01, `inside the text boxes the canvas differs from the template: text was drawn (${(inside.big * 100).toFixed(1)}% of box pixels)`);

    await page.click(tid('layer-item-name'));
    await page.fill(tid('color-hex'), '#b00020');
    await page.fill(tid('size-input'), '48');
    await page.fill(tid('rotation-input'), '4');
    await page.click(tid('layer-add'));
    await page.fill(tid('content-input'), 'Row {{ID}} / {{EVENT}}');
    await page.fill(tid('y-input'), '520');
    await fresh(page);
    t = await templateJson(page);
    shot = await canvasShot(page);
    ref = await rasterOfPdf(await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[0]));
    d = diffPixels(shot, ref);
    ok(d.mean < 0.5 && d.big < 0.001, `after edits the canvas still matches the server PDF (mean ${d.mean.toFixed(3)}, ${(d.big * 100).toFixed(3)}%)`);

    await page.fill(tid('row-input'), '3');
    await fresh(page);
    shot = await canvasShot(page);
    ref = await rasterOfPdf(await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[2]));
    d = diffPixels(shot, ref);
    ok(d.mean < 0.5 && d.big < 0.001, `preview as row 3 (the long name) matches the server PDF (mean ${d.mean.toFixed(3)})`);

    await page.setInputFiles(tid('background-upload'), fx.pdf);
    await page.waitForFunction(() => /Using/.test(document.querySelector('[data-testid="background-status"]')?.textContent || ''));
    await setZoom100(page);
    await fresh(page);
    t = await templateJson(page);
    ok(t.kind === 'pdf' && /^up_/.test(t.backgroundRef), `the uploaded PDF is referenced by id, not copied (${t.backgroundRef})`);
    shot = await canvasShot(page);
    const original = await rasterOfPdf(new Uint8Array(fs.readFileSync(fx.pdf)));
    bd = diffPixels(shot, original, boxesMask(t));
    ok(bd.mean < 0.3 && bd.big < 0.0005, `uploaded PDF: outside the text boxes the canvas equals the original template (mean ${bd.mean.toFixed(3)}, max ${bd.max})`);
    ref = await rasterOfPdf(await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[2]));
    d = diffPixels(shot, ref);
    ok(d.mean < 0.5 && d.big < 0.001, `uploaded PDF: canvas matches the server PDF (mean ${d.mean.toFixed(3)})`);
    const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
    eq(sha(fs.readFileSync(path.join(data, 'uploads', t.backgroundRef))), sha(fs.readFileSync(fx.pdf)), 'the stored template file is byte-identical to the uploaded one: it is never modified');
    const finalPdf = await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[2]);
    const { PDFDocument } = await import('pdf-lib');
    const out = await PDFDocument.load(finalPdf);
    eq(out.getPageCount(), 1, 'the final PDF is one page: the template page with the text drawn on it');

    await page.setInputFiles(tid('background-upload'), fx.png);
    await page.waitForFunction(() => /known-template\.png/.test(document.querySelector('[data-testid="background-status"]')?.textContent || ''));
    await setZoom100(page);
    await fresh(page);
    t = await templateJson(page);
    ok(t.kind === 'image', 'a PNG upload makes an image template');
    await page.check(tid('template-only-toggle'));
    const onlyBg = await canvasShot(page);
    const pngPx = await decodePng(fs.readFileSync(fx.png));
    for (const b of KNOWN.blocks) {
      const cx = Math.round(b.x + KNOWN.size / 2), cy = Math.round(b.y + KNOWN.size / 2);
      eq(hexAt(onlyBg, cx, cy), b.hex, `template-only view shows the PNG's own colour ${b.hex} at (${cx}, ${cy})`);
    }
    eq(hexAt(onlyBg, 5, 5), KNOWN.paper, 'template-only view shows the PNG paper colour');
    ok(pngPx.w === KNOWN.page[0] * 2, 'the PNG fixture is 2x the page size');
    await page.uncheck(tid('template-only-toggle'));
    await fresh(page);
    shot = await canvasShot(page);
    bd = diffPixels(shot, onlyBg, boxesMask(t));
    ok(bd.mean < 0.3 && bd.big < 0.0005, `PNG template: outside the text boxes the certificate equals the picture (mean ${bd.mean.toFixed(3)}, max ${bd.max})`);
    ref = await rasterOfPdf(await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[2]));
    d = diffPixels(shot, ref);
    ok(d.mean < 0.5 && d.big < 0.001, `PNG template: canvas matches the server PDF (mean ${d.mean.toFixed(3)})`);
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR WYSIWYG OK');
}

async function caseHelpers(): Promise<void> {
  console.log('Case helpers: undo/redo, snap-to-centre, preview as row N with the longest name, custom font upload.');
  const logicTest = path.join(ROOT, 'tests', 'editor', 'logic.test.ts');
  const unit = spawnSync(process.execPath, ['--import', 'tsx', '--test', logicTest], { cwd: ROOT, encoding: 'utf8' });
  ok(unit.status === 0, `unit tests for the editor logic pass (tests/editor/logic.test.ts)${unit.status === 0 ? '' : `\n${unit.stdout}\n${unit.stderr}`}`);

  const { DEFAULT_SAMPLE_ROWS } = await import('../../src/components/editor/sampleRows');
  const { longestRowIndex } = await import('../../src/components/editor/logic');
  const { builtinTemplate } = await import('../../src/lib/render/builtin');
  const expectedLongest = longestRowIndex(DEFAULT_SAMPLE_ROWS, builtinTemplate('classic'));
  ok(expectedLongest >= 0, `the longest row for the classic design is row ${expectedLongest + 1} (${DEFAULT_SAMPLE_ROWS[expectedLongest].NAME})`);

  await withPage('chromium', async (page) => {
    await openEditor(page);

    await page.click(tid('layer-item-name'));
    const sizeBefore = (await layerById(page, 'name')).style.size;
    await page.fill(tid('size-input'), '30');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.size, 30, 'size changed to 30');
    ok(!(await page.isDisabled(tid('undo'))), 'Undo is enabled after an edit');
    await page.click(tid('undo'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.size, sizeBefore, 'Undo restores the old size');
    ok(!(await page.isDisabled(tid('redo'))), 'Redo is enabled after an undo');
    await page.click(tid('redo'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.size, 30, 'Redo reapplies it');
    await page.fill(tid('size-input'), '31');
    await page.fill(tid('size-input'), '32');
    await page.fill(tid('size-input'), '33');
    await page.click(tid('undo'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.size, 30, 'a burst of edits to one field is a single undo step');
    const p0 = await layerById(page, 'name');
    const scale = await scaleOf(page);
    await page.keyboard.down('Alt');
    await dragBy(page, await centreOf(page, tid('layer-box-name')), 60, 40);
    await page.keyboard.up('Alt');
    const p1 = await layerById(page, 'name');
    near(p1.x - p0.x, 60 / scale, 1.5, 'drag moved the box');
    await page.click(tid('undo'));
    await settle(page, (t) => { const l = t.layers.find((x: any) => x.id === 'name'); return [l.x, l.y]; }, [p0.x, p0.y], 'one Undo puts a whole drag back');
    await page.click(tid('layer-add'));
    const n = (await templateJson(page)).layers.length;
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await settle(page, (t) => t.layers.length, n - 1, 'Ctrl/Cmd+Z undoes adding a layer');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await settle(page, (t) => t.layers.length, n, 'Ctrl/Cmd+Shift+Z redoes it');

    await page.click(tid('layer-item-subtitle'));
    const sub = await layerById(page, 'subtitle');
    const pageW = 842, pageH = 595;
    const c0 = await centreOf(page, tid('layer-box-subtitle'));
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    await page.mouse.move(c0.x + 90, c0.y + 5, { steps: 5 });
    ok((await page.locator(tid('guide-x')).count()) === 0, 'no vertical guide while the box is far from the centre');
    await page.mouse.move(c0.x + 3, c0.y + 5, { steps: 5 });
    await page.waitForSelector(tid('guide-x'));
    ok(true, 'a vertical guide shows while the box is near the page centre');
    await page.mouse.up();
    const s1 = await layerById(page, 'subtitle');
    near(s1.x + s1.width / 2, pageW / 2, 0.15, 'the box snapped exactly onto the centre line');
    ok((await page.locator(tid('guide-x')).count()) === 0, 'the guide disappears after dropping');
    await page.keyboard.down('Alt');
    const c2 = await centreOf(page, tid('layer-box-subtitle'));
    await dragBy(page, c2, 4, 0);
    await page.keyboard.up('Alt');
    await settle(page, (t) => { const l = t.layers.find((x: any) => x.id === 'subtitle'); return Math.abs(l.x + l.width / 2 - pageW / 2) > 0.3; }, true, 'holding Alt turns snapping off (a 4px drag is not pulled back to the centre)');
    ok(sub.x !== undefined, 'subtitle fixture read');
    const midY = pageH / 2;
    const c1 = await centreOf(page, tid('layer-box-subtitle'));
    const wantDy = (midY - (s1.y + s1.height / 2)) * scale;
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(c1.x, c1.y + wantDy - 3, { steps: 8 });
    await page.waitForSelector(tid('guide-y'));
    ok(true, 'a horizontal guide shows near the vertical centre');
    await page.mouse.up();
    const s2 = await layerById(page, 'subtitle');
    near(s2.y + s2.height / 2, midY, 0.15, 'the box snapped onto the horizontal centre');
    await page.click(tid('row-longest'));
    await fresh(page);
    eq(Number(await page.inputValue(tid('row-input'))), expectedLongest + 1, 'Longest name jumps to the longest row');
    eq(await page.textContent(tid('row-label')), DEFAULT_SAMPLE_ROWS[expectedLongest].NAME, 'the row label shows that row\'s name');
    await page.waitForSelector(tid('fit-review'));
    const notes = await page.textContent(tid('fit-review'));
    ok(/lines|shrunk|shortened/.test(notes || ''), `the fit review lists what auto-fit did to the long name (${(notes || '').trim().slice(0, 90)})`);
    const t = await templateJson(page);
    await page.uncheck(tid('boxes-toggle'));
    await page.selectOption(tid('zoom'), '1');
    await fresh(page);
    const shot = await canvasShot(page);
    const ref = await rasterOfPdf(await serverPdf(page, t, DEFAULT_SAMPLE_ROWS[expectedLongest]));
    const d = diffPixels(shot, ref);
    ok(d.mean < 0.5 && d.big < 0.001, `the preview of the longest row is the server render of that row (mean ${d.mean.toFixed(3)})`);
    await page.fill(tid('row-input'), '2');
    await fresh(page);
    eq(await page.textContent(tid('row-label')), DEFAULT_SAMPLE_ROWS[1].NAME, 'typing row 2 shows row 2');
    await page.click(tid('row-next'));
    await fresh(page);
    eq(Number(await page.inputValue(tid('row-input'))), 3, 'the next-row button moves on');
    await page.check(tid('boxes-toggle'));

    await page.click(tid('layer-item-name'));
    await page.uncheck(tid('boxes-toggle'));
    await page.selectOption(tid('zoom'), '1');
    await fresh(page);
    const before = await canvasShot(page);
    const fontFile = path.join(ROOT, 'assets', 'fonts', 'pinyon-script', 'latin-400-normal.ttf');
    await page.setInputFiles(tid('font-upload'), fontFile);
    await page.waitForFunction(() => /Added/.test(document.querySelector('[data-testid="font-upload-status"]')?.textContent || ''));
    const fid = await page.getAttribute(tid('font-current'), 'data-font-id');
    ok(!!fid && fid.startsWith('upload:up_'), `the uploaded font becomes the layer's font (${fid})`);
    await settle(page, (tt) => tt.layers.find((l: any) => l.id === 'name').style.fontId.startsWith('upload:'), true, 'the template JSON references the uploaded font');
    await fresh(page);
    await page.waitForSelector(`${tid('my-font-option')}[data-font-loaded="1"]`);
    const loaded = await page.evaluate((id) => document.fonts.check(`16px "cf-${id.replace(':', '-')}"`), fid!);
    ok(loaded, 'the uploaded font is loaded in the browser for live previews');
    const after = await canvasShot(page);
    const dd = diffPixels(before, after, undefined, 48);
    ok(dd.big > 0.002, `the preview changed to the uploaded font (${(dd.big * 100).toFixed(2)}% of pixels)`);
    const tt = await templateJson(page);
    const refUp = await rasterOfPdf(await serverPdf(page, tt, DEFAULT_SAMPLE_ROWS[2]));
    const d2 = diffPixels(after, refUp);
    ok(d2.mean < 0.5 && d2.big < 0.001, `the server PDF uses the uploaded font too (mean ${d2.mean.toFixed(3)})`);
    const bad = path.join(data, 'not-a-font.ttf');
    fs.writeFileSync(bad, 'this is just text, not a font');
    await page.setInputFiles(tid('font-upload'), bad);
    await page.waitForFunction(() => /font|\.ttf|\.otf/i.test(document.querySelector('[data-testid="font-upload-status"]')?.textContent || '') && !/Added|Uploading/.test(document.querySelector('[data-testid="font-upload-status"]')?.textContent || ''));
    ok(true, `a non-font file is refused: "${await page.textContent(tid('font-upload-status'))}"`);
    eq(await page.getAttribute(tid('font-current'), 'data-font-id'), fid, 'the layer keeps its font after a refused upload');
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR HELPERS OK');
}

async function caseFontSearch(): Promise<void> {
  console.log('Case font-search: full catalogue search with live previews, applying a font, "fonts in this template".');
  const fx = await ensureFixtures();
  await withPage('chromium', async (page, ctx) => {
    await openEditor(page);
    await page.click(tid('layer-item-name'));

    const first = await (await ctx.request.get(`${BASE}/api/editor/fonts?q=&limit=5`)).json();
    ok(first.total >= 1500, `the font catalogue has ${first.total} families (source: ${first.source})`);
    ok(first.fonts.length > 0 && first.fonts[0].family, 'an empty search lists popular certificate fonts first');
    const placeholder = await page.getAttribute(tid('font-search'), 'placeholder');
    ok(new RegExp(`Search ${first.total.toLocaleString('en-US')}`).test(placeholder || ''), `the search box says how many fonts it searches ("${placeholder}")`);

    await page.fill(tid('font-search'), 'playfair');
    await page.waitForSelector(tid('font-option-playfair-display'));
    ok((await page.locator('[data-testid^="font-option-"]').count()) >= 2, 'searching "playfair" lists several Playfair families');
    const opt = page.locator(tid('font-option-playfair-display'));
    await opt.scrollIntoViewIfNeeded();
    await page.waitForSelector(`${tid('font-option-playfair-display')}[data-font-loaded="1"]`);
    await page.waitForFunction(() => document.fonts.check('20px "cf-playfair-display"'));
    const fam = await opt.locator(tid('font-preview')).evaluate((el) => getComputedStyle(el).fontFamily);
    ok(fam.includes('cf-playfair-display'), `the preview text is set in the font itself (${fam})`);
    const widths = await page.evaluate(() => {
      const probe = (family: string) => { const s = document.createElement('span'); s.style.cssText = `font:32px ${family};position:absolute;visibility:hidden;white-space:nowrap`; s.textContent = 'Ada Lovelace 2026'; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
      return { font: probe('"cf-playfair-display", monospace'), fallback: probe('monospace') };
    });
    ok(Math.abs(widths.font - widths.fallback) > 3, `the browser really draws Playfair Display, not a fallback (${widths.font.toFixed(1)}px vs ${widths.fallback.toFixed(1)}px)`);

    const { ServerFontProvider } = await import('../../src/lib/fonts/server');
    const faces = await new ServerFontProvider().getFaces('playfair-display', false, false);
    const served = Buffer.from(await (await ctx.request.get(`${BASE}/api/editor/font-file/playfair-display`)).body());
    eq(crypto.createHash('sha256').update(served).digest('hex'), crypto.createHash('sha256').update(faces[0].bytes).digest('hex'), 'the preview font file is the same file the renderer embeds');
    const css = await (await ctx.request.get(`${BASE}/api/editor/font-css?id=playfair-display`)).text();
    ok(/@font-face/.test(css) && css.includes('/api/editor/font-file/playfair-display'), 'GET /api/editor/font-css returns an @font-face for the font');

    await page.click(tid('font-option-playfair-display'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.fontId, 'playfair-display', 'clicking the result applies it to the selected layer');
    await fresh(page);

    await page.fill(tid('font-search'), 'caveat');
    await page.waitForSelector(tid('font-option-caveat'));
    await page.click(tid('font-option-caveat'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.fontId, 'caveat', 'a long-tail catalogue font (Caveat) can be applied');
    await fresh(page);
    eq(await page.getAttribute(tid('editor-root'), 'data-render-state'), 'ready', 'the server draws the long-tail font without error');
    const caveat = await new ServerFontProvider().getFaces('caveat', false, false);
    ok(caveat[0].label.startsWith('caveat'), `the renderer used Caveat's own font file, not a fallback (${caveat[0].label})`);

    await page.fill(tid('font-search'), 'montserat');
    await page.waitForSelector(tid('font-fuzzy'));
    ok((await page.locator(tid('font-option-montserrat')).count()) === 1, 'a typo ("montserat") still finds Montserrat');
    await page.fill(tid('font-search'), '');
    await page.click(tid('font-category-handwriting'));
    await page.waitForFunction(() => document.querySelector('[data-testid="font-result-count"]')?.getAttribute('data-state') === 'ready');
    const cats = await (await ctx.request.get(`${BASE}/api/editor/fonts?category=handwriting&limit=100`)).json();
    ok(cats.fonts.length > 10 && cats.fonts.every((f: any) => f.category === 'handwriting'), 'the Script filter only lists handwriting fonts');
    await page.click(tid('font-category-all'));
    await page.fill(tid('font-search'), 'qqqzzzxxx');
    await page.waitForSelector(tid('font-empty'));
    ok(true, 'a search with no match says so in plain words');
    await page.fill(tid('font-search'), '');

    ok((await page.locator(tid('template-fonts')).count()) === 0, 'no "fonts in this template" panel for a built-in design');
    await page.setInputFiles(tid('background-upload'), fx.pdf);
    await page.waitForFunction(() => /Using/.test(document.querySelector('[data-testid="background-status"]')?.textContent || ''));
    await page.waitForSelector(tid('template-fonts'));
    const ids = await page.locator(tid('template-font-option')).evaluateAll((els) => els.map((e) => e.getAttribute('data-font-id')));
    ok(ids.includes('playfair-display') && ids.includes('lato'), `"Fonts in this template" suggests Playfair Display and Lato from the uploaded PDF (${ids.join(', ')})`);
    const hints = await page.locator(tid('template-font-option')).allTextContents();
    ok(hints.some((h) => /PlayfairDisplay/i.test(h)), 'each suggestion names the font found inside the PDF');
    await page.waitForSelector(`${tid('template-font-option')}[data-font-loaded="1"]`);
    await page.click(`${tid('template-font-option')}[data-font-id="playfair-display"]`);
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.fontId, 'playfair-display', 'a suggested template font can be applied with one click');

    const up = await ctx.request.post(`${BASE}/api/editor/background`, { multipart: { file: { name: 'known.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(fx.pdf) } } });
    const upj = await up.json();
    const tf = await (await ctx.request.post(`${BASE}/api/editor/template-fonts`, { data: { uploadId: upj.uploadId } })).json();
    ok(tf.suggestions.some((s: any) => s.match?.id === 'playfair-display') && tf.suggestions.some((s: any) => s.match?.id === 'lato'), 'POST /api/editor/template-fonts matches the PDF fonts to catalogue fonts');
    const pngUp = await (await ctx.request.post(`${BASE}/api/editor/background`, { multipart: { file: { name: 'known.png', mimeType: 'image/png', buffer: fs.readFileSync(fx.png) } } })).json();
    const tfPng = await (await ctx.request.post(`${BASE}/api/editor/template-fonts`, { data: { uploadId: pngUp.uploadId } })).json();
    eq(tfPng.suggestions, [], 'a PNG template has no fonts to suggest (nothing is invented)');
    const anon = await fetch(`${BASE}/api/editor/fonts?q=lora`);
    eq(anon.status, 401, 'the font search needs a signed-in organizer');
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR FONT SEARCH OK');
}

const NATIVE_STUB = `window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#abcdef' }); } };`;

async function colourInBrowser(name: 'chromium' | 'firefox' | 'webkit', fx: { pdf: string; png: string }): Promise<void> {
  const logic = await import('../../src/components/editor/logic');
  await withPage(name, async (page, ctx) => {
    await openEditor(page);
    await page.click(tid('layer-item-name'));

    await page.fill(tid('color-hex'), '#123abc');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, '#123abc', `${name}: hex entry`);
    await page.fill(tid('color-hex'), 'rgb(200, 100, 50)');
    await page.press(tid('color-hex'), 'Enter');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, '#c86432', `${name}: rgb(200, 100, 50) entered in the hex box`);
    await page.fill(tid('color-hex'), 'hsl(210, 40%, 30%)');
    await page.press(tid('color-hex'), 'Enter');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, logic.hslToHex(210, 40, 30), `${name}: hsl(210, 40%, 30%) entered in the hex box`);
    await page.fill(tid('color-r'), '10'); await page.fill(tid('color-g'), '200'); await page.fill(tid('color-b'), '90');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, '#0ac85a', `${name}: R, G, B fields`);
    ok((await page.inputValue(tid('color-h'))) === String(logic.hexToHsl('#0ac85a').h), `${name}: the H field follows the colour`);
    await page.fill(tid('color-h'), '300'); await page.fill(tid('color-s'), '60'); await page.fill(tid('color-l'), '40');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, logic.hslToHex(300, 60, 40), `${name}: H, S, L fields`);
    await page.fill(tid('color-hex'), 'banana');
    ok((await page.locator('[role="alert"]', { hasText: 'Use a hex' }).count()) === 1, `${name}: nonsense is rejected with a hint`);
    await page.fill(tid('color-hex'), '#abc');
    await page.press(tid('color-hex'), 'Enter');
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, '#aabbcc', `${name}: short hex #abc expands to #aabbcc`);

    await setZoom100(page);
    await page.click(tid('eyedropper-template'));
    await page.waitForSelector(`${tid('sample-overlay')}[data-ready="1"]`);
    const cv = (await page.locator(tid('canvas')).boundingBox())!;
    await page.mouse.click(cv.x + 3, cv.y + 3);
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, '#fbf8f1', `${name}: sampling the Classic design's paper gives its exact hex #fbf8f1`);
    ok((await page.locator(tid('sample-overlay')).count()) === 0, `${name}: the picker closes after one click`);

    await page.setInputFiles(tid('background-upload'), fx.pdf);
    await page.waitForFunction(() => /Using/.test(document.querySelector('[data-testid="background-status"]')?.textContent || ''));
    await setZoom100(page);
    for (const b of KNOWN.blocks) {
      await page.click(tid('eyedropper-template'));
      await page.waitForSelector(`${tid('sample-overlay')}[data-ready="1"]`);
      const box = (await page.locator(tid('canvas')).boundingBox())!;
      await page.mouse.move(box.x + b.x + KNOWN.size / 2 - 10, box.y + b.y + KNOWN.size / 2 - 10);
      await page.waitForSelector(tid('sample-readout'));
      eq(await page.textContent(tid('sample-readout')), b.hex, `${name}: the hover readout shows the pixel colour ${b.hex}`);
      await page.mouse.click(box.x + b.x + KNOWN.size / 2, box.y + b.y + KNOWN.size / 2);
      await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, b.hex, `${name}: eyedropper on the uploaded PDF returns exactly ${b.hex}`);
    }
    await page.click(tid('eyedropper-template'));
    await page.waitForSelector(tid('sample-overlay'));
    await page.keyboard.press('Escape');
    ok((await page.locator(tid('sample-overlay')).count()) === 0, `${name}: Escape cancels sampling`);

    await page.waitForSelector(tid('palette-swatch'));
    const palette = await page.locator(tid('palette-swatch')).evaluateAll((els) => els.map((e) => e.getAttribute('data-hex')));
    for (const hex of [KNOWN.paper, ...KNOWN.blocks.map((b) => b.hex)]) ok(palette.includes(hex), `${name}: the extracted palette contains ${hex}`);
    await page.click(`${tid('palette-swatch')}[data-hex="${KNOWN.blocks[1].hex}"]`);
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, KNOWN.blocks[1].hex, `${name}: clicking a palette swatch applies it`);

    await page.click(tid('color-save'));
    await page.waitForSelector(`${tid('saved-swatch')}[data-hex="${KNOWN.blocks[1].hex}"]`);
    ok((await page.locator(`${tid('recent-swatch')}[data-hex="${KNOWN.blocks[0].hex}"]`).count()) >= 1, `${name}: sampled colours appear under Recent`);
    await page.reload({ waitUntil: 'load' });
    await fresh(page);
    await page.click(tid('layer-item-name'));
    ok((await page.locator(`${tid('saved-swatch')}[data-hex="${KNOWN.blocks[1].hex}"]`).count()) === 1, `${name}: the saved colour is still there after reloading`);

    const hasNative = await page.evaluate(() => 'EyeDropper' in window);
    eq(await page.locator(tid('eyedropper-screen')).count(), hasNative ? 1 : 0, `${name}: the "Pick from screen" button appears only when EyeDropper exists (${hasNative ? 'it does' : 'it does not'})`);
    ok((await page.locator(tid('eyedropper-template')).count()) === 1, `${name}: click-to-sample is always offered`);

    const chosen = '#d4145a';
    await page.setInputFiles(tid('background-upload'), fx.png);
    await page.waitForFunction(() => /known-template\.png/.test(document.querySelector('[data-testid="background-status"]')?.textContent || ''));
    await page.click(tid('layer-item-name'));
    await page.fill(tid('content-input'), 'MMMM');
    await page.fill(tid('size-input'), '120');
    await page.fill(tid('min-size-input'), '60');
    await page.click(tid('bold-toggle'));
    await page.fill(tid('color-hex'), chosen);
    await fresh(page);
    const t = await templateJson(page);
    const layer = t.layers.find((l: any) => l.id === 'name');
    eq(layer.style.color, chosen, `${name}: the template stores the chosen hex`);
    const pdf = await serverPdf(page, t, { NAME: 'x' });
    const px = await rasterOfPdf(pdf);
    const counts = new Map<string, number>();
    for (let y = Math.floor(layer.y); y < layer.y + layer.height; y++) for (let x = Math.floor(layer.x); x < layer.x + layer.width; x++) {
      const h = hexAt(px, x, y);
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const top = [...counts.entries()].filter(([h]) => h !== KNOWN.paper).sort((a, b) => b[1] - a[1])[0];
    ok(top?.[0] === chosen && top[1] > 400, `${name}: the dominant ink colour in the PDF is exactly ${chosen} (${top?.[1]} pixels)`);
    const { PDFDocument } = await import('pdf-lib');
    const { inflateSync } = await import('node:zlib');
    const doc = await PDFDocument.load(pdf);
    const streams: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const contents = (obj as any).contents;
      if (contents && (obj as any).dict?.get) {
        try { streams.push(inflateSync(Buffer.from(contents)).toString('latin1')); } catch {  }
      }
    }
    const rg = [0xd4, 0x14, 0x5a].map((v) => (v / 255).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')).join(' ');
    ok(streams.some((s) => s.includes(`${rg} rg`) || s.includes(`${(0xd4 / 255).toString().slice(0, 6)}`)), `${name}: the PDF content stream fills text with ${chosen} (${rg} rg)`);

    if (name === 'chromium') {
      const page2 = await ctx.newPage();
      await page2.goto(`${BASE}/dev/editor`, { waitUntil: 'load' });
      await fresh(page2);
      ok((await page2.locator(tid('eyedropper-screen')).count()) === 1, 'chromium: Chromium has the native EyeDropper');
      await page2.close();
    }
  }, name === 'chromium' ? undefined : undefined);
}

async function caseColour(): Promise<void> {
  console.log('Case colour: hex/RGB/HSL entry, eyedropper on a known template pixel in three browsers, palette, PDF colour.');
  const fx = await ensureFixtures();
  const logic = await import('../../src/components/editor/logic');
  eq(logic.parseColour('rgb(31, 58, 95)'), '#1f3a5f', 'colour parser reads rgb()');
  eq(logic.parseColour('hsl(214, 51%, 25%)'), logic.hslToHex(214, 51, 25), 'colour parser reads hsl()');
  for (const name of ['chromium', 'firefox', 'webkit'] as const) {
    console.log(`  -- ${name}`);
    await colourInBrowser(name, fx);
  }

  await withPage('chromium', async (page) => {
    await openEditor(page);
    await page.click(tid('layer-item-name'));
    await page.click(tid('eyedropper-screen'));
    await settle(page, (t) => t.layers.find((l: any) => l.id === 'name').style.color, '#abcdef', 'chromium: the native EyeDropper result is applied to the layer');
  }, NATIVE_STUB);
  console.log(`${checks} checks passed`);
  console.log('EDITOR COLOUR OK');
}

async function caseModes(): Promise<void> {
  console.log('Case modes: Basic hides the technical controls, Advanced shows them all, the choice is remembered, Full screen is bigger.');
  const shots = process.env.SHOTS;
  await withPage('chromium', async (page) => {
    await page.goto(`${BASE}/dev/editor`, { waitUntil: 'load', timeout: 120_000 });
    await fresh(page);
    eq(await page.locator(tid('mode-basic')).getAttribute('aria-pressed'), 'true', 'the editor opens in Basic mode');
    await page.click(tid('layer-item-name'));
    for (const hidden of ['zoom', 'row-longest', 'section-spacing', 'section-fit', 'x-input', 'min-size-input', 'layer-up-name', 'boxes-toggle']) {
      eq(await page.locator(tid(hidden)).count(), 0, `Basic mode hides ${hidden}`);
    }
    for (const shown of ['content-input', 'section-font', 'size-up', 'size-down', 'bold-toggle', 'align-center', 'section-colour', 'center-h', 'layer-add', 'undo', 'row-next', 'fullscreen', 'download-pdf']) {
      ok((await page.locator(tid(shown)).count()) >= 1, `Basic mode shows ${shown}`);
    }
    const sizeBefore = Number(await page.locator(tid('size-input')).inputValue());
    const stepBy = sizeBefore > 40 ? 4 : 2;
    await page.click(tid('size-up'));
    await page.waitForTimeout(400);
    eq(Number(await page.locator(tid('size-input')).inputValue()), sizeBefore + stepBy, `the Bigger button raises the size by ${stepBy}`);
    await page.click(tid('size-down'));
    await page.waitForTimeout(400);
    eq(Number(await page.locator(tid('size-input')).inputValue()), sizeBefore, 'the Smaller button lowers it again');
    const cv = (await page.locator(tid('canvas')).boundingBox())!;
    console.log(`  canvas in Basic at 1720px wide: ${Math.round(cv.width)} x ${Math.round(cv.height)}`);
    ok(cv.width >= 850, 'the certificate is drawn large (at least 850 px wide)');
    if (shots) await page.screenshot({ path: path.join(shots, 'editor-basic.png') });

    await page.click(tid('fullscreen'));
    await page.waitForTimeout(600);
    const full = (await page.locator(tid('canvas')).boundingBox())!;
    console.log(`  canvas in Full screen: ${Math.round(full.width)} x ${Math.round(full.height)}`);
    ok(full.width >= cv.width, 'Full screen is at least as big');
    if (shots) await page.screenshot({ path: path.join(shots, 'editor-full.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    eq(await page.locator(tid('fullscreen')).getAttribute('aria-pressed'), 'false', 'Escape closes Full screen');

    await page.click(tid('mode-advanced'));
    for (const shown of ['zoom', 'row-longest', 'section-spacing', 'section-fit', 'x-input', 'min-size-input', 'boxes-toggle', 'template-only-toggle', 'letter-spacing-input', 'fit-mode', 'rotation-input']) {
      ok((await page.locator(tid(shown)).count()) >= 1, `Advanced mode shows ${shown}`);
    }
    if (shots) await page.screenshot({ path: path.join(shots, 'editor-advanced.png') });
    await page.reload({ waitUntil: 'load' });
    await fresh(page);
    eq(await page.locator(tid('mode-advanced')).getAttribute('aria-pressed'), 'true', 'Advanced is remembered after a reload');
    await page.click(tid('mode-basic'));
    eq(await page.locator(tid('zoom')).count(), 0, 'switching back to Basic hides the advanced toolbar again');
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR MODES OK');
}

async function caseFinder(): Promise<void> {
  console.log('Case finder: upload a template with text in a known font, box the text, find the font, use it for every text box.');
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  const { ownLatinFace } = await import('../../src/lib/fonts/server');
  const face = (await ownLatinFace('playfair-display', false))!;
  GlobalFonts.register(Buffer.from(face.bytes), 'finder_playfair');
  const W = 1400, H = 990, c = createCanvas(W, H), cx = c.getContext('2d');
  cx.fillStyle = '#fbf8f1'; cx.fillRect(0, 0, W, H);
  cx.strokeStyle = '#1f3a5f'; cx.lineWidth = 12; cx.strokeRect(40, 40, W - 80, H - 80);
  cx.fillStyle = '#1f3a5f'; cx.font = '70px "finder_playfair"'; cx.textAlign = 'center';
  const words = 'Certificate of Achievement';
  cx.fillText(words, W / 2, 480);
  const tw = cx.measureText(words).width;
  const frac = { x: (W / 2 - tw / 2 - 25) / W, y: (480 - 78) / H, w: (tw + 50) / W, h: 110 / H };
  const png = c.toBuffer('image/png');

  await withPage('chromium', async (page) => {
    await openEditor(page);
    await page.setInputFiles(tid('background-upload'), { name: 'my-template.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => /Using/.test(document.querySelector('[data-testid="background-status"]')?.textContent || ''), null, { timeout: 30_000 });
    await fresh(page);
    await page.click(tid('open-font-finder'));
    await page.waitForSelector(tid('font-finder'));
    ok((await page.locator(tid('finder-go')).isDisabled()), 'Find is disabled until a box is drawn and words are typed');
    await page.waitForFunction(() => { const i = document.querySelector('[data-testid="finder-image"] img') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30_000 });
    const img = (await page.locator(tid('finder-image')).boundingBox())!;
    await page.mouse.move(img.x + frac.x * img.width, img.y + frac.y * img.height);
    await page.mouse.down();
    await page.mouse.move(img.x + (frac.x + frac.w) * img.width, img.y + (frac.y + frac.h) * img.height, { steps: 8 });
    await page.mouse.up();
    ok((await page.locator(tid('finder-rect')).count()) === 1, 'dragging draws the selection box');
    ok((await page.locator(tid('finder-go')).isDisabled()), 'still disabled until the words are typed');
    await page.fill(tid('finder-text'), words);
    await page.selectOption(tid('finder-style'), 'serif');
    page.on('request', (r) => { if (r.url().includes('identify-font')) console.log('  identify-font requested'); });
    page.on('response', (r) => { if (r.url().includes('identify-font')) console.log(`  identify-font responded ${r.status()}`); });
    page.on('requestfailed', (r) => { if (r.url().includes('identify-font')) console.log(`  identify-font failed: ${r.failure()?.errorText}`); });
    page.on('console', (m) => { if (m.type() === 'error') console.log(`  browser console: ${m.text().slice(0, 200)}`); });
    await page.click(tid('finder-go'));
    await page.waitForSelector(`${tid('finder-results')}, ${tid('finder-error')}`, { timeout: 120_000 });
    if (await page.locator(tid('finder-error')).count()) throw new Error(`finder error: ${await page.locator(tid('finder-error')).innerText()}`);
    const ids = await page.locator(tid('finder-match')).evaluateAll((els) => els.map((e) => e.getAttribute('data-font-id')));
    console.log(`  matches: ${ids.slice(0, 6).join(', ')}`);
    if (process.env.SHOTS) {
      const src = await page.locator(tid('finder-seen')).getAttribute('src');
      if (src) fs.writeFileSync(path.join(process.env.SHOTS, 'finder-seen.png'), Buffer.from(src.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(process.env.SHOTS, 'finder-template.png'), png);
      await page.screenshot({ path: path.join(process.env.SHOTS, 'finder-results.png'), fullPage: true });
    }
    eq(ids[0], 'playfair-display', 'the font used on the template is the best match');
    ok((await page.locator(tid('finder-seen')).count()) === 1, 'the cleaned-up text that was compared is shown');

    await page.selectOption(tid('finder-target'), 'all');
    await page.click(`${tid('finder-match')}[data-font-id="playfair-display"]`);
    await page.waitForSelector(tid('finder-applied'));
    await page.click(tid('font-finder-close'));
    const t = await templateJson(page);
    ok(t.layers.length > 1 && t.layers.every((l: any) => l.style.fontId === 'playfair-display'), `"Every text box" now uses Playfair Display (${t.layers.map((l: any) => l.style.fontId).join(', ')})`);

    await page.click(tid('open-font-finder'));
    await page.fill(tid('finder-text'), words);
    await page.mouse.move(img.x + 5, img.y + 5);
    ok((await page.locator(tid('finder-error')).count()) === 0, 'no error shown before searching');
    await page.click(tid('font-finder-close'));
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR FINDER OK');
}

async function caseQr(): Promise<void> {
  console.log('Case qr: the QR code is optional; add it, see it in the preview, move it, resize it, remove it.');
  await withPage('chromium', async (page) => {
    await openEditor(page);
    ok(!(await templateJson(page)).qr, 'a template has no QR code until one is added');
    eq(await page.locator(tid('qr-box')).count(), 0, 'no QR box on the canvas by default');

    await page.click(tid('qr-add'));
    await fresh(page);
    const t1 = await templateJson(page);
    ok(!!t1.qr && t1.qr.size >= 40, `Add QR code places one (${JSON.stringify(t1.qr)})`);
    ok(t1.qr.x + t1.qr.size <= t1.pageSize[0] && t1.qr.y + t1.qr.size <= t1.pageSize[1], 'it sits inside the page');
    eq(await page.locator(tid('qr-box')).getAttribute('data-selected'), '1', 'the new QR box is selected');
    ok((await page.locator(tid('qr-panel')).count()) === 1, 'the QR panel replaces the text panel');
    ok((await page.locator(tid('layer-item-qr')).count()) === 1, 'the QR code is listed with the other items');

    const dark = await page.evaluate(async () => {
      const img = document.querySelector('[data-testid="canvas-render"]') as HTMLImageElement;
      const box = document.querySelector('[data-testid="qr-box"]') as HTMLElement;
      const canvas = document.querySelector('[data-testid="canvas"]') as HTMLElement;
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
      const kx = img.naturalWidth / canvas.clientWidth, ky = img.naturalHeight / canvas.clientHeight;
      const x = Math.round(box.offsetLeft * kx), y = Math.round(box.offsetTop * ky), w = Math.round(box.offsetWidth * kx), h = Math.round(box.offsetHeight * ky);
      const d = ctx.getImageData(x, y, w, h).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) n++;
      return n / (d.length / 4);
    });
    ok(dark > 0.2 && dark < 0.7, `the preview shows a QR pattern inside the box (${Math.round(dark * 100)}% dark)`);

    const box = (await page.locator(tid('qr-box')).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    const t2 = await templateJson(page);
    ok(t2.qr.x < t1.qr.x - 20 && t2.qr.y < t1.qr.y - 10, `dragging moves the QR code (${t1.qr.x},${t1.qr.y} -> ${t2.qr.x},${t2.qr.y})`);
    const h = (await page.locator(tid('qr-handle')).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const t3 = await templateJson(page);
    ok(t3.qr.size > t2.qr.size + 10, `dragging the corner makes it bigger (${t2.qr.size} -> ${t3.qr.size})`);
    await page.click(tid('qr-smaller'));
    ok((await templateJson(page)).qr.size < t3.qr.size, 'the Smaller button shrinks it');
    await page.click(tid('qr-corner'));
    const t4 = await templateJson(page);
    ok(t4.qr.x + t4.qr.size > t4.pageSize[0] - 80, 'Bottom-right corner puts it back in the corner');

    await page.click(tid('layer-item-name'));
    ok((await page.locator(tid('style-panel')).count()) === 1, 'selecting a text box brings the text panel back');

    await page.click(tid('layer-item-qr'));
    await page.click(tid('qr-remove'));
    ok(!(await templateJson(page)).qr && (await page.locator(tid('qr-box')).count()) === 0, 'Remove the QR code takes it off the template');
    await page.click(tid('qr-add'));
    await page.locator(tid('qr-box')).focus();
    await page.keyboard.press('Delete');
    ok(!(await templateJson(page)).qr, 'the Delete key removes a selected QR code');
  });
  console.log(`${checks} checks passed`);
  console.log('EDITOR QR OK');
}

const CASES: Record<string, () => Promise<void>> = {
  controls: caseControls, modes: caseModes, finder: caseFinder, qr: caseQr, wysiwyg: caseWysiwyg, helpers: caseHelpers, 'font-search': caseFontSearch, colour: caseColour,
};

async function main(): Promise<void> {
  const i = process.argv.indexOf('--case');
  const which = i >= 0 ? process.argv[i + 1] : 'all';
  const names = which === 'all' ? Object.keys(CASES) : [which];
  for (const n of names) if (!CASES[n]) throw new Error(`Unknown case "${n}". Use: ${Object.keys(CASES).join(', ')} or all.`);
  try {
    await startServer();
    for (const p of ['/dev/editor', '/api/editor/fonts?q=a', '/api/editor/background/classic', '/api/editor/palette/classic', '/api/editor/font-css?id=lora']) {
      await fetch(`${BASE}${p}`, { headers: { cookie: `cf_session=${cookieValue}` }, signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
    }
    for (const n of names) await CASES[n]();
  } finally {
    stopServer();
  }
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); stopServer(); process.exit(1); });
