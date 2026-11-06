import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-render-'));
process.env.CERTFLOW_DATA_DIR = DATA;
delete process.env.GOOGLE_FONTS_API_KEY;
const ROOT = process.cwd();

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}
const log = (m: string) => console.log(`  ${m}`);
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

type RenderMod = typeof import('../../src/lib/render');
type RasterMod = typeof import('../../src/lib/render/raster');
type Contracts = typeof import('../../src/lib/contracts');
type CertTemplate = import('../../src/lib/contracts').CertTemplate;
type TextLayer = import('../../src/lib/contracts').TextLayer;
type TextStyle = import('../../src/lib/contracts').TextStyle;
type RenderedCert = import('../../src/lib/contracts').RenderedCert;
type Raster = import('../../src/lib/render/raster').Raster;

interface Ctx {
  R: RenderMod;
  K: RasterMod;
  fonts: import('../../src/lib/fonts/server').ServerFontProvider;
  contracts: Contracts;
}
let ctxPromise: Promise<Ctx> | null = null;
function ctx(): Promise<Ctx> {
  return (ctxPromise ??= (async () => {
    const R = await import('../../src/lib/render');
    const K = await import('../../src/lib/render/raster');
    const { ServerFontProvider } = await import('../../src/lib/fonts/server');
    const contracts = await import('../../src/lib/contracts');
    return { R, K, fonts: new ServerFontProvider(), contracts };
  })());
}

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let cur: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some((x) => x !== '')) rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  const [head, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const A4: [number, number] = [842, 595];

async function L(id: string, content: string, x: number, y: number, width: number, height: number, style: Partial<TextStyle> = {}): Promise<TextLayer> {
  const { R } = await ctx();
  return { id, content, x, y, width, height, style: R.defaultStyle(style) };
}
function tpl(layers: TextLayer[], over: Partial<CertTemplate> = {}): CertTemplate {
  return { id: 't', name: 't', kind: 'builtin', pageSize: A4, layers, ...over };
}
let counter = 0;
async function render(
  template: CertTemplate, values: Record<string, string>, opts: { background?: Uint8Array | null; sizeCaps?: Record<string, number>; certId?: string; recordId?: string; personKey?: string; verifyCode?: string; verifyUrl?: string } = {},
): Promise<RenderedCert> {
  const { R, fonts } = await ctx();
  counter++;
  const verifyCode = opts.verifyCode ?? `VC${counter}`;
  return R.renderCertificate({
    template, background: opts.background ?? null, values, certId: opts.certId ?? `cert${counter}`, recordId: opts.recordId ?? `rec${counter}`,
    personKey: opts.personKey ?? `person${counter}`, verifyCode, verifyUrl: opts.verifyUrl ?? `https://certflow.test/verify/${verifyCode}`,
    fileName: 'x.pdf', sizeCaps: opts.sizeCaps,
  }, fonts);
}
const textOf = async (pdf: Uint8Array) => {
  const { K } = await ctx();
  return (await K.pdfTextItems(pdf)).filter((i) => i.str.trim()).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
};

interface Rect { x: number; y: number; w: number; h: number }
const inside = (px: number, py: number, rects: Rect[], pad: number, scale: number) =>
  rects.some((r) => px >= (r.x * scale - pad) && px < ((r.x + r.w) * scale + pad) && py >= (r.y * scale - pad) && py < ((r.y + r.h) * scale + pad));

function diffCounts(a: Raster, b: Raster, rects: Rect[], scale: number, tol = 0, pad = 3) {
  check(a.width === b.width && a.height === b.height, `raster sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  let inn = 0, out = 0;
  let firstOut = '';
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) {
        if (inside(x, y, rects, pad, scale)) inn++; else { out++; if (!firstOut) firstOut = `(${x},${y}) ${a.data[i]},${a.data[i + 1]},${a.data[i + 2]} vs ${b.data[i]},${b.data[i + 1]},${b.data[i + 2]}`; }
      }
    }
  }
  return { inside: inn, outside: out, firstOut };
}
const pixel = (r: Raster, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * r.width + Math.round(x)) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const unhex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

interface Ink { count: number; x0: number; y0: number; x1: number; y1: number; w: number; h: number; mode: [number, number, number] | null; modeCount: number }
function ink(r: Raster, region?: Rect, scale = 1): Ink {
  let count = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const hist = new Map<number, number>();
  const rx0 = region ? Math.max(0, Math.floor(region.x * scale)) : 0, ry0 = region ? Math.max(0, Math.floor(region.y * scale)) : 0;
  const rx1 = region ? Math.min(r.width, Math.ceil((region.x + region.w) * scale)) : r.width, ry1 = region ? Math.min(r.height, Math.ceil((region.y + region.h) * scale)) : r.height;
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const i = (y * r.width + x) * 4;
      const R = r.data[i], G = r.data[i + 1], B = r.data[i + 2];
      if (R === 255 && G === 255 && B === 255) continue;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const k = (R << 16) | (G << 8) | B;
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }
  let mode: [number, number, number] | null = null, modeCount = 0;
  for (const [k, n] of hist) if (n > modeCount) { modeCount = n; mode = [(k >> 16) & 255, (k >> 8) & 255, k & 255]; }
  return { count, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, mode, modeCount };
}

async function makeImage(kind: 'png' | 'jpg', w: number, h: number): Promise<{ bytes: Uint8Array; paper: [number, number, number]; band: [number, number, number] }> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#e8f0fe'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d93025'; g.fillRect(0, 0, w, 40);
  g.fillStyle = '#188038'; g.fillRect(0, h - 30, w, 30);
  const buf = kind === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 95);
  return { bytes: new Uint8Array(buf), paper: [0xe8, 0xf0, 0xfe], band: [0xd9, 0x30, 0x25] };
}

async function casePersonalize() {
  const { R } = await ctx();
  const rows = readCsv(path.join(ROOT, 'fixtures', 'clean25.csv'));
  check(rows.length === 25, `fixtures/clean25.csv should have 25 rows, has ${rows.length}`);
  const template = R.builtinTemplate('classic');
  const bg = await R.builtinBackground('classic');
  const seen = new Set<string>();
  const texts: string[] = [];
  const first = new Map<string, RenderedCert>();
  for (const [i, row] of rows.entries()) {
    const values = { NAME: row.Name, EMAIL: row.Email, EVENT: row.Event, ACHIEVEMENT: `${row.Award} in the finals`, CERTIFICATE_TYPE: row.Award, DATE: row.Date, ID: `S${1000 + i}` };
    const r = await render(template, values, { background: bg, verifyCode: `CODE${i}`, certId: `c${i}`, recordId: `r${i}`, personKey: `p${i}` });
    first.set(row.Name, r);
    check(sha(r.pdf) === r.sha256, `row ${i + 1}: RenderedCert.sha256 is not the SHA-256 of the PDF bytes`);
    check(!seen.has(r.sha256), `row ${i + 1}: two certificates share a sha256`);
    seen.add(r.sha256);
    const text = await textOf(r.pdf);
    texts.push(text);
    check(!text.includes('{{') && !text.includes('}}'), `row ${i + 1}: literal "{{" left in "${text}"`);
    check(!/undefined|null|NaN/.test(text), `row ${i + 1}: placeholder fell through as undefined/null: "${text}"`);
    check(text.includes(row.Name), `row ${i + 1}: name "${row.Name}" missing from "${text}"`);
    check(text.includes(row.Event), `row ${i + 1}: event "${row.Event}" missing`);
    check(text.includes(`${row.Award} in the finals`), `row ${i + 1}: achievement missing`);
    check(text.includes(row.Award.toUpperCase()), `row ${i + 1}: award type (uppercase layer) missing`);
    check(text.includes(row.Date), `row ${i + 1}: date missing`);
    check(text.includes('CERTIFICATE OF ACHIEVEMENT') && text.includes('This certificate is proudly presented to'), `row ${i + 1}: static text lost`);
    check(text.includes(`CODE${i}`), `row ${i + 1}: {{VERIFY_CODE}} layer shows no verify code in "${text}"`);
    for (const other of rows) {
      if (other.Name !== row.Name && !row.Name.includes(other.Name) && text.includes(other.Name)) fail(`row ${i + 1}: certificate for ${row.Name} also contains ${other.Name}`);
    }
  }
  check(seen.size === 25, '25 distinct certificates expected');
  const r0 = first.get(rows[0].Name)!;
  const again = await render(template, { NAME: rows[0].Name, EMAIL: rows[0].Email, EVENT: rows[0].Event, ACHIEVEMENT: `${rows[0].Award} in the finals`, CERTIFICATE_TYPE: rows[0].Award, DATE: rows[0].Date, ID: 'S1000' }, { background: bg, verifyCode: 'CODE0', certId: 'c0', recordId: 'r0', personKey: 'p0' });
  check(again.sha256 === r0.sha256, 'rendering the same certificate twice must give byte-identical PDFs (idempotent saves and stable hashes depend on it)');
  log('25 certificates personalized, all distinct; re-rendering one gives an identical PDF');
  const partial = await render(template, { NAME: 'Only Name' }, { background: bg });
  const pt = await textOf(partial.pdf);
  check(pt.includes('Only Name') && !pt.includes('{{') && !/undefined|null/.test(pt), `missing values mishandled: "${pt}"`);
  const evil = await render(template, { NAME: '{{EVENT}}', EVENT: 'REAL-EVENT' }, { background: bg });
  const et = await textOf(evil.pdf);
  check(et.includes('{{EVENT}}'), `a value that looks like a placeholder was expanded: "${et}"`);
  void texts;
  console.log('RENDER PERSONALIZE OK');
}

async function caseTemplates() {
  const { R, K } = await ctx();
  const { PDFDocument } = await import('pdf-lib');
  const values = { NAME: 'Priya Natarajan', EVENT: 'HackFest 2026', ACHIEVEMENT: 'building the winning project', CERTIFICATE_TYPE: '1st Prize', DATE: '2026-03-14' };

  for (const def of R.BUILTIN_BACKGROUNDS) {
    const t = R.builtinTemplate(def.id);
    const r = await render(t, values, { background: await R.builtinBackground(def.id) });
    const doc = await PDFDocument.load(r.pdf);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    check(w === 842 && h === 595 && doc.getPageCount() === 1, `built-in ${def.id}: page is ${w}x${h} x${doc.getPageCount()}`);
    const ras = await K.rasterizePdf(r.pdf, 1);
    const paper = unhex(def.paper);
    const sample = pixel(ras, 400, 552);
    check(near(sample, paper, 2), `built-in ${def.id}: paper colour at (400,552) is ${hex(sample)}, expected ${def.paper}`);
    const items = await K.pdfTextItems(r.pdf);
    const name = items.find((i) => i.str.includes('Priya'));
    const layer = t.layers.find((l) => l.id === 'name')!;
    check(!!name, `built-in ${def.id}: name not drawn`);
    check(name.x >= layer.x && name.x + name.width <= layer.x + layer.width + 0.5 && name.y >= layer.y && name.y <= layer.y + layer.height + 2, `built-in ${def.id}: name at (${name.x.toFixed(1)},${name.y.toFixed(1)}) is outside its box`);
    const title = items.find((i) => i.str.includes('CERTIFICATE OF'));
    check(!!title, `built-in ${def.id}: title not drawn`);
    const tl = t.layers.find((l) => l.id === 'title')!;
    check(title.y >= tl.y && title.y <= tl.y + tl.height + 2, `built-in ${def.id}: title baseline ${title.y.toFixed(1)} outside box ${tl.y}-${tl.y + tl.height}`);
  }
  log(`${R.BUILTIN_BACKGROUNDS.length} built-in templates render with correct paper colour and positioned layers`);

  const upDir = path.join(DATA, 'uploads');
  fs.mkdirSync(upDir, { recursive: true });
  const pdfFile = path.join(upDir, 'template.pdf');
  fs.writeFileSync(pdfFile, await R.builtinBackground('bronze'));
  const png = await makeImage('png', 842, 595);
  const jpg = await makeImage('jpg', 842, 595);
  const portrait = await makeImage('png', 612, 792);
  const layers = [
    await L('name', '{{NAME}}', 100, 200, 642, 70, { fontId: 'playfair-display', size: 40, color: '#202124' }),
    await L('body', 'for {{ACHIEVEMENT}} at {{EVENT}}', 100, 300, 642, 50, { size: 16 }),
  ];
  const cases: { label: string; bytes: Uint8Array; size: [number, number]; type: 'pdf' | 'png' | 'jpg'; paper?: [number, number, number]; band?: [number, number, number]; tol: number }[] = [
    { label: 'uploaded PDF', bytes: new Uint8Array(fs.readFileSync(pdfFile)), size: A4, type: 'pdf', paper: unhex('#fff8f2'), tol: 2 },
    { label: 'uploaded PNG', bytes: png.bytes, size: A4, type: 'png', paper: png.paper, band: png.band, tol: 3 },
    { label: 'uploaded JPG', bytes: jpg.bytes, size: A4, type: 'jpg', paper: jpg.paper, band: jpg.band, tol: 8 },
    { label: 'portrait Letter PNG', bytes: portrait.bytes, size: [612, 792], type: 'png', paper: portrait.paper, band: portrait.band, tol: 3 },
  ];
  for (const c of cases) {
    const t = tpl(layers.map((l) => ({ ...l, width: Math.min(l.width, c.size[0] - 200) })), { pageSize: c.size, kind: c.type === 'pdf' ? 'pdf' : 'image', backgroundRef: 'up_x' });
    const r = await render(t, values, { background: c.bytes });
    const doc = await PDFDocument.load(r.pdf);
    const pg = doc.getPage(0);
    check(Math.abs(pg.getWidth() - c.size[0]) < 0.01 && Math.abs(pg.getHeight() - c.size[1]) < 0.01, `${c.label}: page size ${pg.getWidth()}x${pg.getHeight()} != ${c.size}`);
    const text = await textOf(r.pdf);
    check(text.includes('Priya Natarajan') && text.includes('HackFest 2026'), `${c.label}: layers not drawn ("${text}")`);
    const ras = await K.rasterizePdf(r.pdf, 1);
    const p = pixel(ras, 30, c.size[1] - 120);
    check(near(p, c.paper!, c.tol), `${c.label}: background pixel ${hex(p)} != ${hex(c.paper!)}`);
    if (c.band) { const b = pixel(ras, c.size[0] / 2, 20); check(near(b, c.band, c.tol + 2), `${c.label}: top band pixel ${hex(b)} != ${hex(c.band)}`); }
    const items = await K.pdfTextItems(r.pdf);
    const nm = items.find((i) => i.str.includes('Priya'))!;
    check(nm.x >= 100 && nm.x + nm.width <= 100 + t.layers[0].width + 0.5 && nm.y > 200 && nm.y < 275, `${c.label}: name at (${nm.x.toFixed(1)},${nm.y.toFixed(1)}) not inside its box`);
    log(`${c.label}: ${c.size[0]}x${c.size[1]}, background pixels preserved, layers positioned`);
  }
  const wrongType = await R.renderCertificate({ template: tpl(layers), background: png.bytes, backgroundType: 'jpg', values, certId: 'c', recordId: 'r', personKey: 'p', verifyCode: 'v', verifyUrl: 'u', fileName: 'x.pdf' }, (await ctx()).fonts);
  check((await textOf(wrongType.pdf)).includes('Priya'), 'declared-type mismatch broke rendering');
  let msg = '';
  try { await render(tpl(layers), values, { background: new Uint8Array([1, 2, 3, 4, 5]) }); } catch (e) { msg = (e as Error).message; }
  check(/PDF, PNG or JPG/.test(msg), `non-template background should say it must be a PDF, PNG or JPG; got "${msg}"`);
  const size = await R.backgroundPageSize(await R.builtinBackground('classic'));
  check(size[0] === 842 && size[1] === 595, `backgroundPageSize(classic) = ${size}`);
  const psize = await R.backgroundPageSize(portrait.bytes);
  check(Math.abs(psize[0] / psize[1] - 612 / 792) < 0.001, `backgroundPageSize(portrait png) = ${psize}`);
  console.log('RENDER TEMPLATES OK');
}

async function caseOverlayOnly() {
  const { R, K } = await ctx();
  const { PDFDocument, rgb } = await import('pdf-lib');
  const values = { NAME: 'Priya Natarajan', EVENT: 'HackFest 2026', ACHIEVEMENT: 'building the winning project', CERTIFICATE_TYPE: '1st Prize', DATE: '2026-03-14', VERIFY_CODE: 'ABC123' };

  const png = await makeImage('png', 842, 595);
  const upDir = path.join(DATA, 'uploads');
  fs.mkdirSync(upDir, { recursive: true });
  const pdfFile = path.join(upDir, 'overlay-template.pdf');
  fs.writeFileSync(pdfFile, await R.builtinBackground('modern'));
  const pngFile = path.join(upDir, 'overlay-template.png');
  fs.writeFileSync(pngFile, png.bytes);

  const withQr = async (id: string) => {
    const t = R.builtinTemplate(id);
    t.qr = { x: 640, y: 420, size: 100 };
    return t;
  };
  const rectsOf = (t: CertTemplate): Rect[] => [...t.layers.map((l) => ({ x: l.x, y: l.y, w: l.width, h: l.height })), ...(t.qr ? [{ x: t.qr.x, y: t.qr.y, w: t.qr.size, h: t.qr.size }] : [])];

  const scenarios: { label: string; template: CertTemplate; file: string; scale: number; tol: number; ref: () => Promise<Raster> }[] = [
    { label: 'built-in classic (generated PDF)', template: await withQr('classic'), file: '', scale: 2, tol: 0, ref: async () => K.rasterizePdf(await R.builtinBackground('classic'), 2) },
    { label: 'uploaded PDF (modern design)', template: { ...(await withQr('modern')), kind: 'pdf', backgroundRef: 'up_pdf' }, file: pdfFile, scale: 2, tol: 0, ref: async () => K.rasterizePdf(new Uint8Array(fs.readFileSync(pdfFile)), 2) },
    {
      label: 'uploaded PNG', template: { ...tpl(R.builtinTemplate('classic').layers, { kind: 'image', backgroundRef: 'up_png', qr: { x: 640, y: 420, size: 100 } }) }, file: pngFile, scale: 1, tol: 3,
      ref: async () => {
        const { createCanvas, loadImage } = await import('@napi-rs/canvas');
        const img = await loadImage(Buffer.from(fs.readFileSync(pngFile)));
        const c = createCanvas(842, 595);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 842, 595);
        return { width: 842, height: 595, data: d.data as unknown as Uint8ClampedArray, png: () => c.toBuffer('image/png') };
      },
    },
  ];

  const bad = async (t: CertTemplate, bytes: Uint8Array) => (await render(t, values, { background: bytes })).pdf;

  for (const s of scenarios) {
    const bytes = s.file ? new Uint8Array(fs.readFileSync(s.file)) : await R.builtinBackground('classic');
    const before = sha(bytes);
    const fileBefore = s.file ? sha(fs.readFileSync(s.file)) : '';
    const r = await render(s.template, values, { background: bytes });
    const rects = rectsOf(s.template);
    const ref = await s.ref();
    const out = await K.rasterizePdf(r.pdf, s.scale);
    const d = diffCounts(ref, out, rects, s.scale, s.tol);
    check(d.outside === 0, `${s.label}: ${d.outside} pixels outside text/QR boxes differ from the original template, first at ${d.firstOut}`);
    check(d.inside > 800, `${s.label}: only ${d.inside} pixels changed inside the boxes; the overlay is missing`);
    check(sha(bytes) === before, `${s.label}: the template bytes were modified in memory`);
    if (s.file) check(sha(fs.readFileSync(s.file)) === fileBefore, `${s.label}: the template file changed on disk`);
    log(`${s.label}: 0 pixels differ outside boxes, ${d.inside} inside; template bytes unchanged`);

    const bare = await render({ ...s.template, layers: [], qr: undefined }, values, { background: bytes });
    const dBare = diffCounts(ref, await K.rasterizePdf(bare.pdf, s.scale), [], s.scale, s.tol);
    check(dBare.inside + dBare.outside === 0, `${s.label}: control baseline: an empty overlay differs from the template in ${dBare.inside + dBare.outside} pixels`);

    const wrong = await PDFDocument.create();
    wrong.addPage(s.template.pageSize).drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(0.97, 0.96, 0.94) });
    const recoloured = await bad(s.template, await wrong.save());
    const dBad = diffCounts(ref, await K.rasterizePdf(recoloured, s.scale), rects, s.scale, s.tol);
    check(dBad.outside > 5000, `${s.label}: control FAILED, a recoloured background was not detected (${dBad.outside} outside pixels)`);
    const washed = await PDFDocument.load(r.pdf);
    washed.getPage(0).drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(0, 0, 0), opacity: 0.02 });
    const dWash = diffCounts(ref, await K.rasterizePdf(await washed.save(), s.scale), rects, s.scale, s.tol);
    check(dWash.outside > 5000, `${s.label}: control FAILED, a 2% full-page tint was not detected (${dWash.outside} outside pixels)`);
    const flipped = bytes.slice();
    flipped[Math.floor(flipped.length / 2)] ^= 1;
    check(sha(flipped) !== before, 'control FAILED: byte-change detection');
    log(`${s.label}: controls caught (recoloured background: ${dBad.outside} px, 2% tint: ${dWash.outside} px)`);
  }
  console.log('RENDER OVERLAY ONLY OK');
}

async function caseStyles() {
  const { R, K } = await ctx();
  const SCALE = 2;
  const PAGE: [number, number] = [700, 300];
  const WIDE: Rect = { x: 80, y: 60, w: 540, h: 180 };
  const NARROW: Rect = { x: 240, y: 60, w: 220, h: 180 };
  const baseStyle: Partial<TextStyle> = {
    fontId: 'noto-serif', size: 44, minSize: 20, color: '#c0392b', align: 'center', maxLines: 1, lineHeight: 1.2, opacity: 1,
    fit: { mode: 'shrink', allowAbbreviate: false, minLetterSpacing: 0, uniformAcrossBatch: false },
  };
  const box = (b: Rect) => ({ x: b.x, y: b.y, width: b.w, height: b.h });
  const draw = async (b: Rect, content: string, over: Partial<TextStyle>) => {
    const layer = await L('x', content, b.x, b.y, b.w, b.h, { ...baseStyle, ...over, fit: { ...baseStyle.fit!, ...(over.fit ?? {}) } });
    void box;
    const r = await render(tpl([layer], { pageSize: PAGE }), {});
    const raster = await K.rasterizePdf(r.pdf, SCALE);
    return { r, raster, ink: ink(raster, undefined, 1), text: await textOf(r.pdf), fit: r.fits.x };
  };
  type Out = Awaited<ReturnType<typeof draw>>;
  const WORD = 'Hamburg';
  const LONG = 'Alexander Montgomery Cornwallis Fitzwilliam';
  let n = 0;
  const prop = async (name: string, b: Rect, content: string, over: Partial<TextStyle>, assert: (base: Out, v: Out) => string | void, baseOver: Partial<TextStyle> = {}) => {
    const base = await draw(b, content, baseOver);
    const v = await draw(b, content, { ...baseOver, ...over });
    const d = diffCounts(base.raster, v.raster, [b], SCALE, 0, 2);
    check(d.inside > 40, `style "${name}" changed only ${d.inside} pixels: it has no visible effect`);
    check(d.outside === 0, `style "${name}" changed ${d.outside} pixels OUTSIDE its text box, first at ${d.firstOut}`);
    const extra = assert(base, v);
    n++;
    log(`${name.padEnd(22)} ${String(d.inside).padStart(6)} px changed inside box, 0 outside${extra ? `; ${extra}` : ''}`);
  };

  const base = await draw(WIDE, WORD, {});
  check(base.ink.mode && hex(base.ink.mode) === '#c0392b', `baseline colour is ${base.ink.mode ? hex(base.ink.mode) : 'none'}, expected #c0392b`);
  check(base.ink.x0 >= WIDE.x * SCALE - 2 && base.ink.x1 <= (WIDE.x + WIDE.w) * SCALE + 2, 'baseline ink leaves its box');
  const ctr = (base.ink.x0 + base.ink.x1) / 2 / SCALE;
  check(Math.abs(ctr - (WIDE.x + WIDE.w / 2)) < 4, `baseline text is not centred (centre ${ctr.toFixed(1)} vs ${WIDE.x + WIDE.w / 2})`);

  await prop('fontId (catalogue)', WIDE, WORD, { fontId: 'playfair-display' }, (b, v) => { check(v.ink.w !== b.ink.w, 'same ink width in a different font'); });

  const loraFile = path.join(ROOT, 'assets', 'fonts', 'lora', 'latin-400-normal.ttf');
  fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
  fs.copyFileSync(loraFile, path.join(DATA, 'uploads', 'up_testfont'));
  await prop('fontId (uploaded TTF)', WIDE, WORD, { fontId: 'upload:up_testfont' }, () => undefined);
  const lora = await draw(WIDE, WORD, { fontId: 'lora' });
  const upl = await draw(WIDE, WORD, { fontId: 'upload:up_testfont' });
  const dUp = diffCounts(lora.raster, upl.raster, [], SCALE);
  check(dUp.outside === 0, `an uploaded copy of Lora must render exactly like catalogue Lora, but ${dUp.outside} pixels differ`);
  const missing = await draw(WIDE, WORD, { fontId: 'upload:up_doesnotexist' });
  check(missing.text.includes(WORD), 'a missing uploaded font must fall back instead of failing the certificate');

  await prop('size 44 -> 60', WIDE, WORD, { size: 60 }, (b, v) => {
    const ratio = v.ink.h / b.ink.h;
    check(ratio > 1.25 && ratio < 1.5, `ink height ratio ${ratio.toFixed(2)}, expected about 1.36`);
    return `height x${ratio.toFixed(2)}`;
  });
  {
    const tight: Rect = { x: 240, y: 90, w: 220, h: 60 };
    const lo = await draw(tight, 'Christopher', { size: 44, minSize: 10 });
    const hi = await draw(tight, 'Christopher', { size: 44, minSize: lo.fit.fontSize + 3 });
    check(lo.fit.fontSize < 44 && !lo.fit.overflow, `baseline should shrink and fit, got ${JSON.stringify(lo.fit)}`);
    check(hi.fit.fontSize >= lo.fit.fontSize + 3 - 0.01, `fit size ${hi.fit.fontSize} dropped below the raised minSize ${lo.fit.fontSize + 3}`);
    check(hi.fit.overflow === true, 'text that cannot fit at minSize must be flagged overflow, not silently shrunk');
    const measured = (await K.pdfTextItems(hi.r.pdf)).find((i) => i.str.startsWith('Chri'))!.height;
    check(measured >= lo.fit.fontSize + 3 - 0.1, `pdf.js measures ${measured}pt text; minSize is ${lo.fit.fontSize + 3}`);
    n++;
    log(`minSize                 shrinks to ${lo.fit.fontSize}pt; with minSize ${lo.fit.fontSize + 3} stays >= it and flags overflow`);
  }

  await prop('colour #c0392b -> #2e86c1', WIDE, WORD, { color: '#2e86c1' }, (_b, v) => {
    check(v.ink.mode && hex(v.ink.mode) === '#2e86c1', `measured colour ${v.ink.mode ? hex(v.ink.mode) : 'none'}, expected exactly #2e86c1`);
    return 'measured exactly #2e86c1';
  });
  for (const c of ['#000000', '#f1c40f', '#123456', '#abcdef']) {
    const v = await draw(WIDE, WORD, { color: c });
    check(v.ink.mode && hex(v.ink.mode) === c, `colour ${c}: measured ${v.ink.mode ? hex(v.ink.mode) : 'none'}`);
  }
  log('colours #000000 #f1c40f #123456 #abcdef measured exactly');

  await prop('bold (real bold file)', WIDE, WORD, { bold: true }, (b, v) => { check(v.ink.count > b.ink.count * 1.08, `bold ink ${v.ink.count} vs ${b.ink.count}`); });
  await prop('italic (real italic file)', WIDE, WORD, { italic: true }, () => undefined);
  await prop('bold (synthetic)', WIDE, WORD, { bold: true }, (b, v) => {
    check(v.ink.count > b.ink.count * 1.04, `synthetic bold did not thicken the text (${v.ink.count} vs ${b.ink.count})`);
    check(v.ink.mode && hex(v.ink.mode) === '#c0392b', `synthetic bold changed the colour to ${v.ink.mode ? hex(v.ink.mode) : 'none'}`);
  }, { fontId: 'great-vibes' });
  await prop('italic (synthetic)', WIDE, WORD, { italic: true }, () => undefined, { fontId: 'great-vibes' });

  await prop('underline', WIDE, WORD, { underline: true }, (b, v) => {
    let best = 0, bestRow = 0;
    for (let y = v.ink.y0; y <= v.ink.y1; y++) {
      let run = 0, longest = 0;
      for (let x = v.ink.x0; x <= v.ink.x1; x++) {
        const i = (y * v.raster.width + x) * 4;
        if (v.raster.data[i] === 0xc0 && v.raster.data[i + 1] === 0x39 && v.raster.data[i + 2] === 0x2b) { run++; longest = Math.max(longest, run); } else run = 0;
      }
      if (longest > best) { best = longest; bestRow = y; }
    }
    check(best >= 0.8 * b.ink.w, `no underline rule found (longest solid run ${best}px of ${b.ink.w}px)`);
    check(v.ink.y1 > b.ink.y1 - 2, 'underline is not below the text');
    return `rule ${best}px wide at row ${bestRow}`;
  });
  for (const al of ['left', 'right'] as const) {
    await prop(`align ${al}`, WIDE, WORD, { align: al }, (_b, v) => {
      if (al === 'left') check(Math.abs(v.ink.x0 - WIDE.x * SCALE) < 14, `left edge at ${(v.ink.x0 / SCALE).toFixed(1)}pt, box starts at ${WIDE.x}`);
      else check(Math.abs(v.ink.x1 - (WIDE.x + WIDE.w) * SCALE) < 14, `right edge at ${(v.ink.x1 / SCALE).toFixed(1)}pt, box ends at ${WIDE.x + WIDE.w}`);
    });
  }
  await prop('letterSpacing 0 -> 8', WIDE, WORD, { letterSpacing: 8 }, (b, v) => {
    const grew = (v.ink.w - b.ink.w) / SCALE;
    check(grew > 0.8 * 6 * 8 && grew < 1.2 * 6 * 8, `ink widened by ${grew.toFixed(1)}pt, expected about ${6 * 8}pt (6 gaps of 8pt)`);
    return `+${grew.toFixed(1)}pt`;
  });
  await prop('lineHeight 1.0 -> 1.8', NARROW, LONG, { lineHeight: 1.8, size: 28, minSize: 8, maxLines: 2, fit: { mode: 'wrap' } as never }, (b, v) => {
    check(b.fit.lines.length === 2 && v.fit.lines.length === 2, `expected two lines, got ${b.fit.lines.length}/${v.fit.lines.length}`);
    const grew = (v.ink.h - b.ink.h) / SCALE;
    check(Math.abs(b.fit.fontSize - v.fit.fontSize) < 0.01, `size changed with lineHeight (${b.fit.fontSize} -> ${v.fit.fontSize})`);
    const want = 0.8 * b.fit.fontSize;
    check(Math.abs(grew - want) < 2.5, `block grew ${grew.toFixed(1)}pt, expected about ${want.toFixed(1)}pt`);
    return `block +${grew.toFixed(1)}pt`;
  }, { lineHeight: 1.0, size: 28, minSize: 8, maxLines: 2, fit: { mode: 'wrap' } as never });
  await prop('uppercase', WIDE, 'Hamburg Haven', { uppercase: true }, (_b, v) => {
    check(v.text === 'HAMBURG HAVEN', `extracted text is "${v.text}", expected uppercase`);
  });
  await prop('opacity 1 -> 0.5', WIDE, WORD, { opacity: 0.5 }, (_b, v) => {
    const c = unhex('#c0392b').map((x) => Math.round(x * 0.5 + 255 * 0.5));
    check(v.ink.mode && near(v.ink.mode, c, 1), `half-opacity colour measured ${v.ink.mode ? hex(v.ink.mode) : 'none'}, expected ${hex(c)} (+-1)`);
    return `measured ${hex(v.ink.mode!)}`;
  });
  await prop('opacity 0.5 bold underline', WIDE, WORD, { opacity: 0.5 }, (_b, v) => {
    const c = unhex('#c0392b').map((x) => Math.round(x * 0.5 + 255 * 0.5));
    check(v.ink.mode && near(v.ink.mode, c, 1), `synthetic-bold underlined half-opacity text measured ${v.ink.mode ? hex(v.ink.mode) : 'none'}, expected ${hex(c)}`);
  }, { fontId: 'great-vibes', bold: true, underline: true });
  for (const deg of [15, -15]) {
    await prop(`rotation ${deg > 0 ? '+' : ''}${deg} deg`, WIDE, WORD, { rotation: deg }, (b, v) => {
      check(v.ink.h > b.ink.h + 25, `rotated block is not taller (${v.ink.h} vs ${b.ink.h})`);
      const mid = (v.ink.x0 + v.ink.x1) / 2;
      const centroid = (from: number, to: number) => {
        let sy = 0, c = 0;
        for (let y = v.ink.y0; y <= v.ink.y1; y++) for (let x = from; x < to; x++) { const i = (y * v.raster.width + x) * 4; if (v.raster.data[i] !== 255 || v.raster.data[i + 2] !== 255) { sy += y; c++; } }
        return sy / c;
      };
      const dy = centroid(Math.round(mid), v.ink.x1 + 1) - centroid(v.ink.x0, Math.round(mid));
      check(deg > 0 ? dy > 10 : dy < -10, `rotation ${deg}: right half is ${dy.toFixed(1)}px lower than the left half (clockwise = positive, like CSS)`);
      check(Math.abs((v.ink.x0 + v.ink.x1) / 2 / SCALE - (WIDE.x + WIDE.w / 2)) < 6, 'rotation moved the text off the box centre');
    });
  }
  await prop('maxLines 1 -> 2', NARROW, LONG, { maxLines: 2, minSize: 8 }, (b, v) => {
    check(b.fit.lines.length === 1 && v.fit.lines.length === 2, `lines ${b.fit.lines.length} -> ${v.fit.lines.length}, expected 1 -> 2`);
    check(v.fit.fontSize > b.fit.fontSize, `wrapping should allow a larger size (${b.fit.fontSize} -> ${v.fit.fontSize})`);
    return `lines 1 -> 2, size ${b.fit.fontSize} -> ${v.fit.fontSize}`;
  }, { maxLines: 1, size: 44, minSize: 8, fit: { mode: 'shrink-then-wrap' } as never });
  await prop('fit.mode shrink -> wrap', NARROW, LONG, { fit: { mode: 'wrap' } as never, maxLines: 2, minSize: 8 }, (b, v) => {
    check(!b.fit.wrapped && v.fit.wrapped, 'shrink mode must stay on one line, wrap mode must wrap');
  }, { fit: { mode: 'shrink' } as never, maxLines: 2, minSize: 8 });
  await prop('fit.allowAbbreviate', { x: 200, y: 90, w: 300, h: 60 }, 'Venkata Satya Sai Krishna Prasad Subrahmanyam', { fit: { allowAbbreviate: true } as never }, (b, v) => {
    check(!b.fit.abbreviated && v.fit.abbreviated, 'abbreviation flag did not toggle');
    check(/^Venkata .*Subrahmanyam$/.test(v.text.replace(/\s+/g, ' ')) || (v.text.includes('Venkata') && v.text.includes('Subrahmanyam')), `first/last name lost: "${v.text}"`);
    return `"${v.text}"`;
  }, { minSize: 16, maxLines: 1, fit: { allowAbbreviate: false } as never });
  {
    const probe = await draw({ x: 20, y: 90, w: 660, h: 60 }, 'Hamburgers Everywhere', { size: 40, minSize: 30 });
    const w0 = probe.ink.w / SCALE;
    const tightBox: Rect = { x: Math.round(350 - (w0 * 0.97) / 2), y: 90, w: Math.round(w0 * 0.97), h: 60 };
    await prop('fit.minLetterSpacing', tightBox, 'Hamburgers Everywhere', { fit: { minLetterSpacing: -2 } as never }, (b, v) => {
      check(b.fit.fontSize < 40 && b.fit.letterSpacing === 0, `without tightening the text should shrink: size ${b.fit.fontSize}, spacing ${b.fit.letterSpacing}`);
      check(v.fit.fontSize === 40 && v.fit.letterSpacing < 0 && v.fit.letterSpacing >= -2, `with room to tighten it should keep 40pt: size ${v.fit.fontSize}, spacing ${v.fit.letterSpacing}`);
      return `size ${b.fit.fontSize} -> ${v.fit.fontSize}, spacing ${b.fit.letterSpacing} -> ${v.fit.letterSpacing}`;
    }, { size: 40, minSize: 30, maxLines: 1, fit: { minLetterSpacing: 0 } as never });
  }
  log(`${n} style properties each change pixels only inside their own box`);
  console.log('RENDER STYLES OK');
}

async function caseNaming() {
  const { R } = await ctx();
  const eq = (got: string, want: string, label: string) => check(got === want, `${label}: got "${got}", want "${want}"`);
  eq(R.certFileName({ event: 'HackFest 2026', id: 'S1001', name: 'Aarav Sharma' }), 'HackFest-2026_S1001_Aarav-Sharma.pdf', 'basic pattern <EVENT>_<STUDENTID>_<Name>.pdf');
  eq(R.certFileName({ event: 'HackFest 2026', id: 'S1001', name: 'José Núñez' }), 'HackFest-2026_S1001_Jose-Nunez.pdf', 'Latin accents folded');
  eq(R.certFileName({ event: 'E', id: '1', name: 'Aarav', category: '1st Prize' }), 'E_1_Aarav_1st-Prize.pdf', 'category suffix');
  eq(R.certFileName({}), 'certificate.pdf', 'nothing to name it by');
  const devanagari = R.certFileName({ event: 'HackFest', id: 'S9', name: 'अनन्या शर्मा' });
  check(devanagari.startsWith('HackFest_S9_') && devanagari.includes('अनन्या') && devanagari.endsWith('.pdf'), `Devanagari name must stay recognisable: ${devanagari}`);

  const windowsBad = /[<>:"/\\|?*\u0000-\u001f]|[. ]\.pdf$|[. ]$/;
  const reserved = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;
  const nasty: Parameters<RenderMod['certFileName']>[0][] = [
    { name: 'CON' }, { name: 'nul' }, { event: 'AUX' }, { id: 'COM1' }, { name: 'lpt9' }, { name: 'com¹' }, { name: 'PRN.' },
    { event: 'a<b>c:d"e/f\\g|h?i*j', id: '../../etc/passwd', name: 'x\u0000y\u001fz' },
    { name: 'Trailing dots...', event: 'Event.' }, { name: '   spaces   ' }, { name: '....' }, { name: '.hidden' }, { name: '..' },
    { name: 'A'.repeat(500), event: 'E'.repeat(300), id: 'I'.repeat(300) },
    { name: 'अ'.repeat(500), event: 'ए'.repeat(100), id: '१'.repeat(100) },
    { name: '日本語の名前'.repeat(40) }, { name: '😀🎓 Emoji Name 🎉' }, { name: 'RTL ‮evil‬ name' }, { name: 'ＦＵＬＬＷＩＤＴＨ' },
    { name: 'é'.repeat(300) }, { name: 'Zoë̈ Ångström' }, { name: '​‌‍' },
  ];
  for (const parts of nasty) {
    const f = R.certFileName(parts);
    check(f.length <= 120, `name over 120 chars (${f.length}): ${JSON.stringify(parts).slice(0, 80)}`);
    check(Buffer.byteLength(f) <= 255, `name over 255 bytes (${Buffer.byteLength(f)}) would not exist on ext4/APFS: ${f.slice(0, 40)}`);
    check(f.endsWith('.pdf') && f.length > 4, `bad file name ${JSON.stringify(f)}`);
    check(!windowsBad.test(f), `illegal Windows characters or trailing dot/space in ${JSON.stringify(f)}`);
    check(!reserved.test(f), `Windows reserved device name: ${f}`);
    check(!f.startsWith('.') && !f.includes('..') && !f.includes('/') && !f.includes('\\'), `path-like or hidden name: ${f}`);
    check(!/[‪-‮⁦-⁩​-‏﻿]/.test(f), `bidi/zero-width characters survive in ${JSON.stringify(f)}`);
    check(f === f.normalize('NFC'), `file name is not NFC: ${f}`);
  }
  eq(R.certFileName({ name: 'CON' }), 'CON_.pdf', 'reserved name CON');
  log(`${nasty.length} hostile inputs produce safe names (reserved, illegal chars, trailing dots, 500-char inputs, bidi, emoji)`);

  const u = R.uniqueFileNames(['a.pdf', 'a.pdf', 'a.pdf', 'b.pdf']);
  eq(u.join(','), 'a.pdf,a-2.pdf,a-3.pdf,b.pdf', 'numbering');
  const ci = R.uniqueFileNames(['Ann.pdf', 'ann.pdf', 'ANN.pdf']);
  eq(ci.join(','), 'Ann.pdf,ann-2.pdf,ANN-3.pdf', 'case-insensitive collisions');
  const tricky = R.uniqueFileNames(['a.pdf', 'a.pdf', 'a-2.pdf']);
  check(new Set(tricky.map((x) => x.toLowerCase())).size === 3, `a-2 collision: ${tricky.join(',')}`);
  const long = R.certFileName({ name: 'N'.repeat(500), event: 'E'.repeat(500) });
  const many = R.uniqueFileNames(Array.from({ length: 1200 }, () => long));
  check(new Set(many.map((x) => x.toLowerCase())).size === 1200, '1200 identical long names must all become unique');
  check(many.every((x) => x.length <= 120 && x.endsWith('.pdf')), `suffixed names exceed 120 chars (max ${Math.max(...many.map((x) => x.length))})`);
  eq(many[1], long.replace(/\.pdf$/, '-2.pdf').length <= 120 ? many[1] : '', 'second long name suffix');
  check(many[999].endsWith('-1000.pdf') && many[999].length <= 120, `1000th duplicate: ${many[999]}`);
  const realistic = readCsv(path.join(ROOT, 'fixtures', 'clean25.csv')).map((r, i) => R.certFileName({ event: r.Event, id: `S${i % 5}`, name: r.Name.split(' ')[0] }));
  const uniq = R.uniqueFileNames(realistic);
  check(new Set(uniq.map((x) => x.toLowerCase())).size === uniq.length, 'realistic batch has collisions after uniqueFileNames');
  log(`collisions numbered -2/-3, case-insensitive, 1200 duplicates stay unique and at most 120 characters`);
  console.log('RENDER NAMING OK');
}

async function caseMetadataQr() {
  const { R, K } = await ctx();
  const { PDFDocument } = await import('pdf-lib');
  const jsQR = (await import('jsqr')).default;
  const decode = (r: Raster) => jsQR(r.data, r.width, r.height);

  const t = R.builtinTemplate('classic');
  t.qr = { x: 640, y: 420, size: 110 };
  const bg = await R.builtinBackground('classic');
  const people = [
    { personKey: 'S1001', name: 'Aarav Sharma' },
    { personKey: 'roll no 12, section a', name: 'Spaced Key' },
    { personKey: 'अनन्या@example.edu', name: 'अनन्या' },
    { personKey: 'a%20b+c/d?e=f&g', name: 'Percent' },
  ];
  for (let i = 0; i < 25; i++) people.push({ personKey: `P${i}`, name: `Person ${i}` });
  const decoded = new Set<string>();
  for (const [i, p] of people.entries()) {
    const certId = `cert_${i}_${crypto.randomBytes(4).toString('hex')}`;
    const recordId = `rec_${i}_${crypto.randomBytes(4).toString('hex')}`;
    const verifyCode = `V${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const verifyUrl = `https://certflow.test/verify/${verifyCode}`;
    const r = await render(t, { NAME: p.name, EVENT: 'E' }, { background: bg, certId, recordId, personKey: p.personKey, verifyCode, verifyUrl });
    const doc = await PDFDocument.load(r.pdf, { updateMetadata: false });
    check(doc.getSubject() === certId, `PDF Subject is "${doc.getSubject()}", expected the certId ${certId}`);
    const meta = await R.readCertMeta(r.pdf);
    check(meta.certId === certId && meta.recordId === recordId && meta.personKey === p.personKey && meta.verifyCode === verifyCode,
      `metadata round trip failed for ${JSON.stringify(p.personKey)}: ${JSON.stringify(meta)}`);
    check(doc.getProducer() === 'Facilify', 'producer');
    const ras = await K.rasterizePdf(r.pdf, 3);
    const qr = decode(ras);
    check(!!qr, `certificate ${i}: no QR code could be decoded`);
    check(qr.data === verifyUrl, `certificate ${i}: QR decodes to "${qr.data}", expected "${verifyUrl}"`);
    check(/\/verify\/[A-Za-z0-9]+$/.test(qr.data) && qr.data.endsWith(`/verify/${verifyCode}`), 'QR does not end in /verify/<verifyCode>');
    const corners = [qr.location.topLeftCorner, qr.location.topRightCorner, qr.location.bottomLeftCorner, qr.location.bottomRightCorner];
    for (const c of corners) check(c.x >= 640 * 3 - 6 && c.x <= 750 * 3 + 6 && c.y >= 420 * 3 - 6 && c.y <= 530 * 3 + 6, `QR corner (${(c.x / 3).toFixed(1)},${(c.y / 3).toFixed(1)}) is outside the box 640,420 110x110`);
    decoded.add(qr.data);
  }
  check(decoded.size === people.length, 'every certificate needs its own QR');
  log(`${people.length} certificates: Subject = certId, record/person/verify round-trip through readCertMeta, QR decodes to /verify/<code> inside its box`);

  const plain = await render(R.builtinTemplate('classic'), { NAME: 'No Qr' }, { background: bg });
  check(!decode(await K.rasterizePdf(plain.pdf, 3)), 'control: a template without qr must not contain a decodable QR');
  const withText = await render(R.builtinTemplate('classic'), { NAME: 'X' }, { background: bg, verifyCode: 'ZED999' });
  check((await textOf(withText.pdf)).includes('Verify: ZED999'), `"Verify: {{VERIFY_CODE}}" layer did not print the code: "${await textOf(withText.pdf)}"`);
  const one = await K.rasterizePdf((await render(t, { NAME: 'Q' }, { background: bg })).pdf, 3);
  const q = ink(one, { x: 640, y: 420, w: 110, h: 110 }, 3);
  check(q.mode !== null && near(q.mode, [0, 0, 0], 0), `QR modules are ${q.mode ? hex(q.mode) : 'missing'}, expected pure black`);
  console.log('RENDER METADATA QR OK');
}

function buildCorpus(): { name: string; kind: string }[] {
  const rnd = mulberry32(20261104);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const SYL = ['ka', 'ra', 'mi', 'sho', 'van', 'de', 'lu', 'tre', 'bha', 'shna', 'pra', 'sad', 'gan', 'ti', 'mo', 'zel', 'qui', 'xan', 'dro', 'phe', 'thy', 'sche', 'wo', 'ley', 'mann', 'berg', 'stein', 'ova', 'ski', 'czyk', 'ngu', 'yen', 'bao', 'hoang'];
  const word = (min: number, max: number) => { let w = ''; for (let i = int(min, max); i > 0; i--) w += pick(SYL); return w[0].toUpperCase() + w.slice(1); };
  const out: { name: string; kind: string }[] = [];
  const add = (kind: string, name: string) => out.push({ kind, name });

  const real = [
    'Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior', 'Venkata Satya Sai Krishna Prasad Subrahmanyam', 'Alexander Montgomery Cornwallis-Fitzwilliam III',
    'María del Rosario Cayetana Paloma Alfonsa Victoria Eugenia Fernanda Teresa Francisca de Paula Lourdes Antonia Josefa Fausta Rita Castor Dorotea Santa Esperanza Fitz-James Stuart y de Silva Falcó y Gurtubay',
    'Wolfgang Amadeus Mozart-Johann Chrysostomus Theophilus Gottlieb', 'Maria-Magdalena Wilhelmina Henrietta Sophia van der Westhuizen-Oppermann',
  ];
  real.forEach((n) => add('very-long', n));
  while (out.length < 30) add('very-long', Array.from({ length: int(6, 12) }, () => word(1, 4)).join(' '));

  ['Pneumonoultramicroscopicsilicovolcanoconiosis', 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', 'Supercalifragilisticexpialidocious',
    'Wolfeschlegelsteinhausenbergerdorff', 'Bartholomew-Maximilian-Christopherson-Featherstonehaugh'.replace(/-/g, '')].forEach((n) => add('long-word', n));
  while (out.filter((o) => o.kind === 'long-word').length < 25) add('long-word', word(10, 15));

  const DEV = ['अनन्या', 'शर्मा', 'कृष्णमूर्ति', 'वेंकटरमण', 'सुब्रह्मण्यम्', 'ज्ञानेश्वर', 'क्षत्रिय', 'श्रीमती', 'विक्रमादित्य', 'चंद्रशेखर', 'राजगोपालाचारी', 'नारायणस्वामी', 'प्रज्ञा', 'द्विवेदी', 'त्रिपाठी', 'मुखोपाध्याय', 'अय्यर', 'रामकृष्णन'];
  while (out.filter((o) => o.kind === 'devanagari').length < 40) {
    const n = out.filter((o) => o.kind === 'devanagari').length;
    add('devanagari', Array.from({ length: n < 5 ? 1 : n < 25 ? int(2, 4) : int(5, 9) }, () => pick(DEV)).join(' '));
  }

  while (out.filter((o) => o.kind === 'all-caps').length < 25) {
    const n = out.filter((o) => o.kind === 'all-caps').length;
    add('all-caps', Array.from({ length: n < 10 ? int(2, 3) : int(4, 9) }, () => word(1, 4)).join(' ').toUpperCase());
  }

  while (out.filter((o) => o.kind === 'hyphenated').length < 30) {
    const n = out.filter((o) => o.kind === 'hyphenated').length;
    const part = () => (n % 3 === 0 ? `${word(1, 3)}-${word(1, 3)}-${word(1, 3)}` : `${word(2, 4)}-${word(2, 4)}`);
    add('hyphenated', Array.from({ length: int(1, n < 15 ? 2 : 4) }, part).join(' '));
  }

  ['Nguyễn Thị Minh Khai', 'Đặng Thị Thùy Dương', 'Ångström Øresund Ærø Åkesson', 'Zoë Brontë-Müller', 'Łukasz Żółć Gęślą', 'Çağlar Şahin Öztürk', 'Þórunn Sæmundsdóttir',
    'João Antônio Conceição', 'François Hervé Lefèvre', 'Šimon Čapek Žižka', 'İbrahim Ağaoğlu', 'Mikołaj Kopernik', 'Béatrice Schönberg', 'Jürgen Müßig', 'Dvořák Antonín'].forEach((n) => add('diacritics', n));

  const SHORT = ['Li Wu', 'Ng', 'Al', 'Om', 'Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Anita Borg', 'Radia Perlman', 'Ken Thompson', 'Y', 'Mo Salah', 'Jo', 'Eve', 'Ravi Teja', 'Aditi Rao', 'Sam', 'Zhang Wei', 'Kim Min-jun', 'Aarav Sharma'];
  SHORT.forEach((n) => add('short', n));
  while (out.length < 200) add('mixed', Array.from({ length: int(2, 5) }, () => word(1, 4)).join(' '));
  return out.slice(0, 200);
}

interface FitConfig { id: string; label: string; box: Rect; style: Partial<TextStyle> }
const FIT_CONFIGS: FitConfig[] = [
  { id: 'wide-script', label: 'wide box, Great Vibes 56pt (script)', box: { x: 61, y: 10, w: 720, h: 76 }, style: { fontId: 'great-vibes', size: 56, minSize: 20, maxLines: 2, color: '#1f3a5f' } },
  { id: 'narrow-serif', label: 'narrow box, Noto Serif 36pt, 3 lines', box: { x: 61, y: 110, w: 230, h: 110 }, style: { fontId: 'noto-serif', size: 36, minSize: 12, maxLines: 3, color: '#222222' } },
  { id: 'narrow-caps', label: 'narrow box, Montserrat Bold caps 30pt', box: { x: 331, y: 110, w: 250, h: 110 }, style: { fontId: 'montserrat', bold: true, uppercase: true, letterSpacing: 1.5, size: 30, minSize: 11, maxLines: 3, color: '#7a1f1f' } },
  { id: 'wide-single', label: 'wide single line, Cinzel 40pt', box: { x: 61, y: 250, w: 720, h: 48 }, style: { fontId: 'cinzel', size: 40, minSize: 14, maxLines: 1, color: '#0b5d3b' } },
  { id: 'tiny-box', label: 'small box 150x44, Lato 20pt', box: { x: 611, y: 110, w: 170, h: 60 }, style: { fontId: 'lato', size: 20, minSize: 9, maxLines: 2, color: '#333399' } },
];
const fitFit = (over: Partial<TextStyle> = {}): Partial<TextStyle['fit']> => ({ mode: 'shrink-then-wrap', allowAbbreviate: true, minLetterSpacing: -0.5, uniformAcrossBatch: false, ...(over.fit ?? {}) });

async function fitTemplate(disabled: boolean): Promise<CertTemplate> {
  const layers: TextLayer[] = [];
  for (const c of FIT_CONFIGS) {
    const style: Partial<TextStyle> = { ...c.style, fit: fitFit() as TextStyle['fit'] };
    if (disabled) {
      Object.assign(style, { minSize: c.style.size, maxLines: 1, fit: { mode: 'shrink', allowAbbreviate: false, minLetterSpacing: c.style.letterSpacing ?? 0, uniformAcrossBatch: false } });
    }
    layers.push(await L(c.id, '{{NAME}}', c.box.x, c.box.y, c.box.w, c.box.h, style));
  }
  return tpl(layers, { pageSize: [842, 310] });
}

async function measureFit(pdf: Uint8Array, template: CertTemplate, name: string, opts: { checkChars: boolean }): Promise<string[]> {
  const { K } = await ctx();
  const problems: string[] = [];
  const items = (await K.pdfTextItems(pdf)).filter((i) => i.str.trim());
  const raster = await K.rasterizePdf(pdf, 2);
  for (const layer of template.layers) {
    const cfg = FIT_CONFIGS.find((c) => c.id === layer.id)!;
    const b = cfg.box;
    const mine = items.filter((i) => i.x >= b.x - 3 && i.x <= b.x + b.w + 3 && i.y > b.y - 4 && i.y < b.y + b.h + 40);
    const band: Rect = { x: b.x - 14, y: b.y - 8, w: b.w + 28, h: b.h + 16 };
    const inkBand = ink(raster, band, 2);
    const sizes = mine.map((i) => i.height);
    const size = sizes.length ? Math.max(...sizes) : 0;
    if (!mine.length) { problems.push(`${layer.id}: nothing drawn for "${name.slice(0, 30)}"`); continue; }
    const lines = new Map<number, { x0: number; x1: number }>();
    for (const it of mine) {
      const key = Math.round(it.y * 2) / 2;
      const cur = lines.get(key) ?? { x0: Infinity, x1: -Infinity };
      cur.x0 = Math.min(cur.x0, it.x); cur.x1 = Math.max(cur.x1, it.x + it.width);
      lines.set(key, cur);
    }
    for (const [y, e] of /[\u0900-\u097f]/.test(name) ? [] : lines) {
      if (e.x0 < b.x - 0.6 || e.x1 > b.x + b.w + 0.6) problems.push(`${layer.id}: line at y=${y} spans ${e.x0.toFixed(1)}..${e.x1.toFixed(1)} outside box ${b.x}..${b.x + b.w}`);
    }
    const ys = [...lines.keys()].sort((a, c) => a - c);
    const lh = layer.style.lineHeight || 1.2;
    if (size < (layer.style.minSize ?? 0) - 0.06) problems.push(`${layer.id}: font ${size.toFixed(2)} below minSize ${layer.style.minSize}`);
    if (ys.length * size * lh > b.h + 0.6) problems.push(`${layer.id}: ${ys.length} lines x ${size.toFixed(1)}pt x ${lh} = ${(ys.length * size * lh).toFixed(1)}pt tall in a ${b.h}pt box`);
    if (ys[0] - size * 0.8 < b.y - 1.5 || ys[ys.length - 1] + size * 0.25 > b.y + b.h + 1.5) problems.push(`${layer.id}: baselines ${ys[0].toFixed(1)}..${ys[ys.length - 1].toFixed(1)} leave the box ${b.y}..${b.y + b.h}`);
    const padX = Math.max(2, size * 0.07), padY = Math.max(2, size * 0.2);
    if (inkBand.count) {
      if (inkBand.x0 / 2 < b.x - padX || (inkBand.x1 + 1) / 2 > b.x + b.w + padX) problems.push(`${layer.id}: ink spans ${(inkBand.x0 / 2).toFixed(1)}..${((inkBand.x1 + 1) / 2).toFixed(1)}pt, box is ${b.x}..${b.x + b.w}`);
      if (inkBand.y0 / 2 < b.y - padY || (inkBand.y1 + 1) / 2 > b.y + b.h + padY) problems.push(`${layer.id}: ink spans y ${(inkBand.y0 / 2).toFixed(1)}..${((inkBand.y1 + 1) / 2).toFixed(1)}pt, box is ${b.y}..${b.y + b.h}`);
    }
    void opts;
  }
  return problems;
}

const letters = (s: string) => s.normalize('NFC').replace(/[\s\-.\u0000-\u001f]+/g, '').toLowerCase();
const sortedChars = (s: string) => [...letters(s)].sort().join('');

async function caseFitUnicodePerf() {
  const { R, K } = await ctx();
  const corpus = buildCorpus();
  check(corpus.length === 200, `corpus has ${corpus.length} names`);
  const bg = null;
  const template = await fitTemplate(false);
  const bgLayers = template.layers.length;
  void bg; void bgLayers;

  let checked = 0, shrunk = 0, wrapped = 0, abbreviated = 0, devanagariExact = 0, overflowFlag = 0;
  const failures: string[] = [];
  for (const [i, { name, kind }] of corpus.entries()) {
    const r = await render(template, { NAME: name });
    const problems = await measureFit(r.pdf, template, name, { checkChars: true });
    const items = (await K.pdfTextItems(r.pdf)).filter((x) => x.str.trim());
    for (const layer of template.layers) {
      const cfg = FIT_CONFIGS.find((c) => c.id === layer.id)!;
      const fit = r.fits[layer.id];
      const mine = items.filter((it) => it.x >= cfg.box.x - 3 && it.x <= cfg.box.x + cfg.box.w + 3 && it.y > cfg.box.y - 4 && it.y < cfg.box.y + cfg.box.h + 40);
      const got = mine.map((m) => m.str).join(' ');
      const want = layer.style.uppercase ? name.toLocaleUpperCase() : name;
      if (fit.overflow) { overflowFlag++; problems.push(`${layer.id}: FitResult.overflow is set (text could not be fitted)`); }
      if (fit.shrunk) shrunk++;
      if (fit.wrapped) wrapped++;
      if (fit.abbreviated) abbreviated++;
      const tokens = name.trim().split(/\s+/);
      const isDev = /[ऀ-ॿ]/.test(name);
      if (!isDev) {
        const gl = letters(got), wl = letters(want);
        if (!fit.abbreviated) {
          if (gl !== wl) problems.push(`${layer.id}: characters lost or changed: got "${got}" for "${want}" (${[...gl].map((c) => c.codePointAt(0)!.toString(16)).join(' ')} vs ${[...wl].map((c) => c.codePointAt(0)!.toString(16)).join(' ')})`);
        } else {
          const first = letters(layer.style.uppercase ? tokens[0].toLocaleUpperCase() : tokens[0]);
          const last = letters(layer.style.uppercase ? tokens[tokens.length - 1].toLocaleUpperCase() : tokens[tokens.length - 1]);
          if (tokens.length < 3) problems.push(`${layer.id}: a ${tokens.length}-word name was abbreviated`);
          if (!gl.startsWith(first)) problems.push(`${layer.id}: first name abbreviated/lost: "${got}" for "${want}"`);
          if (!gl.endsWith(last)) problems.push(`${layer.id}: last name abbreviated/lost: "${got}" for "${want}"`);
          const midWords = tokens.slice(1, -1).map((t) => letters(layer.style.uppercase ? t.toLocaleUpperCase() : t));
          let rest = gl.slice(first.length, gl.length - last.length);
          for (const m of midWords) {
            if (rest.startsWith(m)) rest = rest.slice(m.length); else if (rest.startsWith(m[0])) rest = rest.slice(1); else { problems.push(`${layer.id}: middle word "${m}" is neither whole nor an initial in "${got}"`); break; }
          }
          if (rest) problems.push(`${layer.id}: unexplained extra text "${rest}" in "${got}"`);
        }
      } else if (!fit.abbreviated) {
        if (letters(fit.lines.join('')) === letters(want)) devanagariExact++;
        else problems.push(`${layer.id}: Devanagari characters lost in the layout: ${JSON.stringify(fit.lines)} for "${want}"`);
        if (!mine.length) problems.push(`${layer.id}: nothing drawn`);
      }
    }
    checked++;
    if (problems.length) failures.push(`#${i} [${kind}] "${name.slice(0, 50)}": ${problems.join(' | ')}`);
  }
  if (failures.length) fail(`${failures.length} of ${checked} names failed the fit checks:\n  ${failures.slice(0, 12).join('\n  ')}`);
  log(`${checked} hard names x ${template.layers.length} boxes: all inside their boxes, none below minSize, no lost characters (${devanagariExact} Devanagari layouts verified); ${shrunk} shrunk, ${wrapped} wrapped, ${abbreviated} abbreviated layers, ${overflowFlag} overflow flags`);
  check(abbreviated > 0 && wrapped > 0 && shrunk > 0, 'the corpus did not exercise shrink + wrap + abbreviate');

  const off = await fitTemplate(true);
  let caught = 0;
  for (const { name } of corpus.slice(0, 60)) {
    const r = await render(off, { NAME: name });
    if ((await measureFit(r.pdf, off, name, { checkChars: false })).length) caught++;
  }
  check(caught >= 20, `control FAILED: with fitting disabled only ${caught} of 60 names were seen overflowing`);
  log(`control: with fitting disabled ${caught} of 60 names are caught overflowing`);

  const fixture = path.join(ROOT, 'fixtures', 'render', 'hard-names.json');
  if (!fs.existsSync(fixture)) { fs.mkdirSync(path.dirname(fixture), { recursive: true }); fs.writeFileSync(fixture, JSON.stringify(corpus, null, 1)); }

  const t = R.builtinTemplate('classic');
  const bgPdf = await R.builtinBackground('classic');
  const t0 = Date.now();
  const hashes = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const { name } = corpus[i % corpus.length];
    const r = await render(t, { NAME: `${name} ${i}`, EVENT: 'HackFest 2026', ACHIEVEMENT: 'building the winning project', CERTIFICATE_TYPE: '1st Prize', DATE: '2026-03-14' }, { background: bgPdf });
    hashes.add(r.sha256);
  }
  const secs = (Date.now() - t0) / 1000;
  check(hashes.size === 1000, 'perf run produced duplicate certificates');
  check(secs < 60, `1,000 certificates took ${secs.toFixed(1)} s (budget 60 s)`);
  log(`1,000 certificates in ${secs.toFixed(1)} s (${(secs).toFixed(2)} ms/cert x1000 = ${(secs).toFixed(1)} s)`);
  console.log('RENDER FIT UNICODE PERF OK');
}

interface FsFont { id: string; family: string; category: string; subsets: string[]; weights: number[]; styles: string[] }
function loadFontsourceSnapshot(): FsFont[] {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'render', 'fontsource-google.json'), 'utf8')) as { fonts: FsFont[] };
  return j.fonts;
}

async function caseFonts() {
  const { R } = await ctx();
  const catalog = await import('../../src/lib/fonts/catalog');
  const server = await import('../../src/lib/fonts/server');
  const snapshot = loadFontsourceSnapshot();
  const calls: string[] = [];
  const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ttf = new Uint8Array(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'lora', 'latin-400-normal.ttf')));

  const fontsourceFetch = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://api.fontsource.org/v1/fonts?type=google')) return jsonRes(snapshot);
    return new Response('nope', { status: 404 });
  };
  server.setFontFetch(fontsourceFetch);
  const fsCat = await server.loadCatalog({ refresh: true });
  check((await server.catalogSource()) === 'fontsource', `catalogSource without a key is "${await server.catalogSource()}", expected fontsource`);
  check(fsCat.length >= 1900, `Fontsource catalogue has only ${fsCat.length} families`);
  check(calls.length === 1 && !calls[0].includes('key='), 'Fontsource request must not carry an API key');
  const hit = catalog.searchFonts('playfair', fsCat);
  check(hit[0]?.family === 'Playfair Display', `searchFonts("playfair") first hit is "${hit[0]?.family}" (full list: ${hit.slice(0, 4).map((h) => h.family).join(', ')}); expected Playfair Display`);
  check(hit.some((h) => h.family === 'Playfair') && hit.some((h) => h.family === 'Playfair Display SC'), 'other Playfair families must still be listed');
  check(catalog.searchFonts('roboto', fsCat)[0]?.family === 'Roboto', 'roboto -> Roboto first');
  check(catalog.searchFonts('great vib', fsCat)[0]?.family === 'Great Vibes', '"great vib" -> Great Vibes');
  check(catalog.searchFonts('GREAT-VIBES', fsCat)[0]?.family === 'Great Vibes', 'search ignores case and punctuation');
  check(catalog.searchFonts('zzzzqqq', fsCat).length === 0, 'nonsense query must return nothing');
  check(catalog.searchFonts('', fsCat, 10).length === 10, 'empty query lists fonts');
  log(`Fontsource source: ${fsCat.length} families, "playfair" -> ${hit.map((h) => h.family).slice(0, 3).join(' | ')}`);

  const rank = (f: FsFont) => (f.family === 'Playfair Display' ? 20 : f.family === 'Playfair' ? 400 : 1000 + snapshot.indexOf(f));
  const googleItems = snapshot.map((f) => ({
    family: f.family, category: f.category === 'display' ? 'display' : f.category,
    variants: f.weights.flatMap((w) => f.styles.map((s) => (s === 'italic' ? (w === 400 ? 'italic' : `${w}italic`) : w === 400 ? 'regular' : String(w)))),
    subsets: f.subsets,
    files: Object.fromEntries(f.weights.flatMap((w) => f.styles.map((s) => [s === 'italic' ? (w === 400 ? 'italic' : `${w}italic`) : w === 400 ? 'regular' : String(w), `http://fonts.gstatic.com/s/${f.id}/v1/${f.id}-${w}-${s}.ttf`]))),
    _rank: rank(f),
  })).sort((a, b) => a._rank - b._rank).map(({ _rank, ...rest }) => rest);
  const gcalls: { url: string; auth: string | null }[] = [];
  const googleFetch = async (url: string) => {
    gcalls.push({ url, auth: null });
    const u = new URL(url);
    if (u.origin + u.pathname === 'https://www.googleapis.com/webfonts/v1/webfonts') {
      if (u.searchParams.get('key') !== 'TEST-KEY-123') return jsonRes({ error: { code: 400, message: 'API key not valid.' } }, 400);
      check(u.searchParams.get('sort') === 'popularity', 'Google request should ask for sort=popularity');
      return jsonRes({ kind: 'webfonts#webfontList', items: googleItems });
    }
    if (u.hostname === 'fonts.gstatic.com') return new Response(ttf, { status: 200 });
    return new Response('nope', { status: 404 });
  };
  fs.rmSync(path.join(DATA, 'fonts'), { recursive: true, force: true });
  process.env.GOOGLE_FONTS_API_KEY = 'TEST-KEY-123';
  server.setFontFetch(googleFetch);
  const gCat = await server.loadCatalog({ refresh: true });
  check((await server.catalogSource()) === 'google', `catalogSource with a key is "${await server.catalogSource()}", expected google`);
  check(gcalls.length === 1 && gcalls[0].url.startsWith('https://www.googleapis.com/webfonts/v1/webfonts?key=TEST-KEY-123'), `unexpected Google calls: ${gcalls.map((c) => c.url).join(' ')}`);
  check(gCat.length >= 1900 && gCat[0].source === 'google', `Google catalogue ${gCat.length} fonts, source ${gCat[0]?.source}`);
  const gHit = catalog.searchFonts('playfair', gCat);
  check(gHit[0]?.family === 'Playfair Display', `Google source: "playfair" first hit is "${gHit[0]?.family}"`);
  const pd = gCat.find((f) => f.family === 'Playfair Display')!;
  check(pd.weights.includes(400) && pd.weights.includes(700) && pd.styles.includes('italic'), `Google variants not parsed: ${JSON.stringify(pd)}`);
  check(server.parseGoogleVariant('700italic')?.style === 'italic' && server.parseGoogleVariant('regular')?.weight === 400 && server.parseGoogleVariant('bogus') === null, 'variant parser');
  const before = gcalls.length;
  const provider = new server.ServerFontProvider();
  const faces = await provider.getFaces('abeezee', false, false);
  const fontCalls = gcalls.slice(before).map((c) => c.url);
  check(faces.length >= 1 && faces[0].bytes.length === ttf.length, 'Google font file was not delivered to the renderer');
  check(fontCalls.some((u) => u === 'https://fonts.gstatic.com/s/abeezee/v1/abeezee-400-normal.ttf'), `font file URL not used: ${fontCalls.join(' ')}`);
  const again = gcalls.length;
  await new server.ServerFontProvider().getFaces('abeezee', false, false);
  check(gcalls.length === again, 'a cached font file must not be downloaded again');
  check(fs.readdirSync(path.join(DATA, 'fonts', 'abeezee')).some((f) => f.endsWith('.ttf')), 'font file not cached on disk');
  log(`Google source: ${gCat.length} families via the Developer API with the key, "playfair" -> Playfair Display, file download + disk cache`);

  fs.rmSync(path.join(DATA, 'fonts'), { recursive: true, force: true });
  process.env.GOOGLE_FONTS_API_KEY = 'WRONG-KEY';
  const warn = console.warn; console.warn = () => undefined;
  server.setFontFetch(async (url) => (url.includes('googleapis.com') ? googleFetch(url) : fontsourceFetch(url)));
  await server.loadCatalog({ refresh: true });
  check((await server.catalogSource()) === 'fontsource', `a rejected API key should fall back to fontsource, got ${await server.catalogSource()}`);
  server.setFontFetch(async () => { throw new Error('offline'); });
  fs.rmSync(path.join(DATA, 'fonts'), { recursive: true, force: true });
  delete process.env.GOOGLE_FONTS_API_KEY;
  const offline = await server.loadCatalog({ refresh: true });
  check((await server.catalogSource()) === 'bundled' && offline.length === catalog.BUNDLED_FONTS.length, `offline with no cache: source ${await server.catalogSource()}, ${offline.length} fonts`);
  check(catalog.searchFonts('playfair', offline)[0]?.family === 'Playfair Display', 'bundled list: playfair first hit');
  console.warn = warn;
  log('failure chain verified: bad key -> Fontsource, no network and no cache -> bundled list');
  server.setFontFetch(fontsourceFetch);
  const cat = await server.loadCatalog({ refresh: true });

  fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
  const lobster = path.join(ROOT, 'assets', 'fonts', 'abril-fatface', 'latin-400-normal.ttf');
  fs.copyFileSync(lobster, path.join(DATA, 'uploads', 'up_abril'));
  const t = tpl([
    await L('a', 'Catalogue {{NAME}}', 50, 40, 600, 60, { fontId: 'playfair-display', bold: true, size: 30 }),
    await L('b', 'Uploaded {{NAME}}', 50, 120, 600, 60, { fontId: 'upload:up_abril', size: 30 }),
    await L('c', 'Script {{NAME}}', 50, 200, 600, 60, { fontId: 'great-vibes', size: 30 }),
  ], { pageSize: [700, 300] });
  const r = await render(t, { NAME: 'Fontish' });
  const names = await R.pdfFontNames(r.pdf);
  const has = (re: RegExp) => names.some((n) => re.test(n));
  check(has(/^(?:[A-Z]{6}\+)?PlayfairDisplay/i), `catalogue font missing from the PDF font list: ${names.join(', ')}`);
  check(has(/^(?:[A-Z]{6}\+)?AbrilFatface/i), `uploaded font missing from the PDF font list: ${names.join(', ')}`);
  check(has(/GreatVibes/i), `Great Vibes missing from the PDF font list: ${names.join(', ')}`);
  log(`embedded fonts: ${names.join(', ')}`);

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const tplDoc = await PDFDocument.create();
  tplDoc.registerFontkit(fontkit);
  const page = tplDoc.addPage([842, 595]);
  const montserrat = await tplDoc.embedFont(new Uint8Array(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'montserrat', 'latin-700-normal.ttf'))), { subset: true });
  const eb = await tplDoc.embedFont(new Uint8Array(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'eb-garamond', 'latin-400-italic.ttf'))), { subset: true });
  const helv = await tplDoc.embedFont(StandardFonts.HelveticaBold);
  const times = await tplDoc.embedFont(StandardFonts.TimesRoman);
  page.drawText('Template heading', { x: 50, y: 500, size: 30, font: montserrat, color: rgb(0, 0, 0) });
  page.drawText('Italic line', { x: 50, y: 450, size: 20, font: eb });
  page.drawText('Helvetica line', { x: 50, y: 400, size: 20, font: helv });
  page.drawText('Times line', { x: 50, y: 350, size: 20, font: times });
  const template = await tplDoc.save();
  const tNames = await R.pdfFontNames(template);
  check(tNames.length >= 4, `fonts named in the uploaded template: ${tNames.join(', ')}`);
  const sugg = catalog.suggestFromPdfFontNames(tNames, cat);
  const find = (re: RegExp) => sugg.find((s) => re.test(s.pdfName));
  const mont = find(/Montserrat/i), garamond = find(/Garamond/i), hv = find(/^Helvetica/i), tm = find(/^Times/i);
  check(mont?.match?.family === 'Montserrat' && mont.bold, `Montserrat-Bold suggestion: ${JSON.stringify(mont)}`);
  check(garamond?.match?.family === 'EB Garamond' && garamond.italic, `EBGaramond italic suggestion: ${JSON.stringify(garamond)}`);
  check(hv?.match && hv.bold && /Arimo|Roboto|Open Sans/.test(hv.match.family), `Helvetica-Bold suggestion: ${JSON.stringify(hv)}`);
  check(tm?.match && /Tinos|Noto Serif|Merriweather/.test(tm.match.family), `Times-Roman suggestion: ${JSON.stringify(tm)}`);
  const nested = await R.pdfFontNames((await render(tpl([await L('a', 'x {{NAME}}', 50, 50, 300, 50, { fontId: 'lato' })], { pageSize: [842, 595] }), { NAME: 'n' }, { background: template })).pdf);
  check(nested.some((n) => /Montserrat/i.test(n)) && nested.some((n) => /Lato/i.test(n)), `nested template fonts not found: ${nested.join(', ')}`);
  const direct = catalog.suggestFromPdfFontNames(['ABCDEF+PlayfairDisplay-BoldItalic', 'OpenSans-Regular', 'GreatVibes-Regular', 'Lato-Bold', 'XyzNonexistentFont-Regular', 'NotoSerif-Bold'], cat);
  const ok = (i: number, fam: string, b: boolean, it: boolean) => check(direct[i].match?.family === fam && direct[i].bold === b && direct[i].italic === it, `suggest ${direct[i].pdfName}: ${JSON.stringify(direct[i])}`);
  ok(0, 'Playfair Display', true, true); ok(1, 'Open Sans', false, false); ok(2, 'Great Vibes', false, false); ok(3, 'Lato', true, false); ok(5, 'Noto Serif', true, false);
  check(direct[4].match === null, `an unknown font must not be force-matched: ${JSON.stringify(direct[4])}`);
  log(`template fonts ${tNames.join(', ')} -> ${sugg.map((s) => `${s.family}=>${s.match?.family ?? '-'}`).join(', ')}`);
  server.setFontFetch(null);
  console.log('RENDER FONTS OK');
}

async function caseUniformFit() {
  const { R, K, fonts } = await ctx();
  const names = ['Li Wu', 'Aarav Sharma', 'Diya Patel', 'Venkata Satya Sai Krishna Prasad', 'Maria Fernanda de los Angeles', 'Rohan Mehta', 'Priya Natarajan Venkataraghavan', 'Jo', 'Alexander Cornwallis-Fitzwilliam', 'Ananya Iyer'];
  const mk = async (uniform: boolean) => tpl([
    await L('name', '{{NAME}}', 61, 100, 400, 60, { fontId: 'playfair-display', size: 46, minSize: 14, maxLines: 1, fit: { mode: 'shrink', allowAbbreviate: false, minLetterSpacing: 0, uniformAcrossBatch: uniform } }),
    await L('other', '{{EVENT}}', 61, 200, 400, 40, { fontId: 'lato', size: 20, minSize: 8, maxLines: 1, fit: { mode: 'shrink', allowAbbreviate: false, minLetterSpacing: 0, uniformAcrossBatch: false } }),
  ], { pageSize: [600, 300] });
  const rows = names.map((NAME) => ({ NAME, EVENT: 'HackFest' }));
  const sizeOf = async (pdf: Uint8Array, name: string) => (await K.pdfTextItems(pdf)).find((i) => i.str.includes(name.split(' ')[0]))!.height;

  const plain = await mk(false);
  const plainSizes: number[] = [];
  for (const v of rows) { const r = await render(plain, v); plainSizes.push(r.fits.name.fontSize); }
  check(new Set(plainSizes.map((s) => s.toFixed(2))).size >= 4, `control: without uniform mode sizes should differ, got ${[...new Set(plainSizes)].join(', ')}`);

  const uni = await mk(true);
  const caps = await R.uniformSizeCaps(uni, rows, fonts);
  check(Object.keys(caps).join() === 'name', `only the uniform layer gets a cap, got ${Object.keys(caps)}`);
  const sizes: number[] = [];
  const measured: number[] = [];
  for (const v of rows) {
    const r = await render(uni, v, { sizeCaps: caps });
    sizes.push(r.fits.name.fontSize);
    measured.push(await sizeOf(r.pdf, v.NAME));
    check(!r.fits.name.overflow, `${v.NAME} overflows in uniform mode`);
  }
  check(new Set(sizes.map((s) => s.toFixed(2))).size === 1, `uniform mode produced different sizes: ${sizes.join(', ')}`);
  check(new Set(measured.map((s) => s.toFixed(1))).size === 1, `measured (pdf.js) sizes differ: ${measured.join(', ')}`);
  const widest = Math.min(...plainSizes);
  const longest = names[plainSizes.indexOf(widest)];
  const longestAlone = plainSizes[names.indexOf(longest)];
  check(Math.abs(sizes[0] - widest) < 0.02, `uniform size ${sizes[0]} is not the smallest individual size ${widest}`);
  check(Math.abs(longestAlone - widest) < 0.02, `the longest name (${longest}) should be the binding one: alone ${longestAlone} vs min ${widest}`);
  check(sizes[0] < 46, 'uniform size should be below the designed size for this batch');
  check(Math.abs(measured[0] - sizes[0]) < 0.05, `measured size ${measured[0]} != reported ${sizes[0]}`);
  const probe = await R.layoutTemplate({ ...uni, layers: [{ ...uni.layers[0], style: { ...uni.layers[0].style, size: sizes[0] + 0.5, minSize: sizes[0] + 0.5, fit: { ...uni.layers[0].style.fit, uniformAcrossBatch: false } } }] }, { NAME: longest }, fonts);
  check(probe[0].fit.overflow === true, `a size ${sizes[0] + 0.5} should overflow for the longest name, so ${sizes[0]} would not be the largest fit`);
  const other = await render(uni, rows[0], { sizeCaps: caps });
  check(other.fits.other.fontSize === 20, `non-uniform layer changed size to ${other.fits.other.fontSize}`);
  check((await R.uniformSizeCaps(uni, [], fonts)).name === 46, 'empty batch cap should be the designed size');
  log(`individual sizes ${plainSizes.map((s) => s.toFixed(0)).join('/')}; uniform: all ${sizes.length} certificates at ${sizes[0]}pt (longest "${longest}")`);
  console.log('RENDER UNIFORM FIT OK');
}

async function writeScreens() {
  const { R, K } = await ctx();
  const dir = path.join(ROOT, 'fixtures', 'render', 'screens');
  fs.mkdirSync(dir, { recursive: true });
  for (const def of R.BUILTIN_BACKGROUNDS) {
    const t = R.builtinTemplate(def.id);
    const r = await render(t, { NAME: 'Aarav Sharma', EVENT: 'HackFest 2026', ACHIEVEMENT: 'building the winning project', CERTIFICATE_TYPE: def.name, DATE: '14 March 2026' }, { background: await R.builtinBackground(def.id), verifyCode: 'CF-2026-0042' });
    fs.writeFileSync(path.join(dir, `${def.id}.png`), (await K.rasterizePdf(r.pdf, 1.5)).png());
  }
  const t = R.builtinTemplate('gold');
  const long = await render(t, { NAME: 'María del Rosario Cayetana Paloma Alfonsa Victoria Eugenia Fernanda de Silva y Gurtubay', EVENT: 'Ibero-American Innovation Summit 2026', ACHIEVEMENT: 'winning first place', CERTIFICATE_TYPE: 'Grand Laureate', DATE: '14 March 2026' }, { background: await R.builtinBackground('gold') });
  fs.writeFileSync(path.join(dir, 'gold-long-name.png'), (await K.rasterizePdf(long.pdf, 1.5)).png());
  const dev = await render(R.builtinTemplate('modern'), { NAME: 'अनन्या कृष्णमूर्ति शर्मा', EVENT: 'हैकफेस्ट 2026', ACHIEVEMENT: 'प्रथम स्थान', CERTIFICATE_TYPE: '1st Prize', DATE: '14 March 2026' }, { background: await R.builtinBackground('modern') });
  fs.writeFileSync(path.join(dir, 'modern-devanagari.png'), (await K.rasterizePdf(dev.pdf, 1.5)).png());
  console.log(`wrote ${R.BUILTIN_BACKGROUNDS.length + 2} screenshots to ${dir}`);
}

const CASES: Record<string, () => Promise<void>> = {
  personalize: casePersonalize,
  templates: caseTemplates,
  'overlay-only': caseOverlayOnly,
  styles: caseStyles,
  naming: caseNaming,
  'metadata-qr': caseMetadataQr,
  'fit-unicode-perf': caseFitUnicodePerf,
  fonts: caseFonts,
  'uniform-fit': caseUniformFit,
};

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--screens')) return writeScreens();
  if (args.includes('--write-fixtures')) {
    fs.mkdirSync(path.join(ROOT, 'fixtures', 'render'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'fixtures', 'render', 'hard-names.json'), JSON.stringify(buildCorpus(), null, 1));
    console.log('wrote fixtures/render/hard-names.json');
    return;
  }
  const i = args.indexOf('--case');
  const wanted = i >= 0 ? args[i + 1] : '';
  const names = wanted && wanted !== 'all' ? [wanted] : Object.keys(CASES);
  for (const name of names) {
    const fn = CASES[name];
    if (!fn) fail(`unknown case "${name}" (cases: ${Object.keys(CASES).join(', ')})`);
    if (names.length > 1) console.log(`\n== ${name}`);
    await fn();
  }
  if (names.length > 1) console.log('RENDER ALL OK');
}

main()
  .then(() => { fs.rmSync(DATA, { recursive: true, force: true }); })
  .catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(1); });
