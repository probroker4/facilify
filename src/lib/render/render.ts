import 'regenerator-runtime/runtime';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDict, PDFName, PDFDocument, PDFHexString, PDFRawStream, PDFRef, type PDFFont, type PDFPage, concatTransformationMatrix, popGraphicsState, pushGraphicsState,
  setCharacterSpacing, setGraphicsState, setLineWidth, setStrokingRgbColor, setTextRenderingMode, TextRenderingMode, degrees, rgb,
} from 'pdf-lib';
import QRCode from 'qrcode';
import type { CertTemplate, FitResult, RenderedCert, TextLayer, TextStyle } from '@/lib/contracts';
import { RenderError } from '@/lib/contracts';
import { sha256 } from '@/lib/hash';
import { fillPlaceholders } from '@/lib/text';
import type { FontFace, FontProvider } from '@/lib/fonts/provider';
import { fitText, type Measure } from './fit';
import { hexToPdf, parseHex } from './color';

type FkFont = ReturnType<typeof fontkit.create>;
const parsedFonts = new WeakMap<Uint8Array, FkFont>();
function parsedFont(bytes: Uint8Array): FkFont {
  let f = parsedFonts.get(bytes);
  if (!f) { f = fontkit.create(bytes as unknown as Buffer); parsedFonts.set(bytes, f); }
  return f;
}
const sharedFontkit = { ...fontkit, create: (bytes: Uint8Array) => parsedFont(bytes) } as unknown as typeof fontkit;

const IGNORABLE = new Set([0x200c, 0x200d, 0xfe0e, 0xfe0f, 0x20]);
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const splitGraphemes = (s: string) => (segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : [...s]);

interface FaceSet { faces: FontFace[]; charsets: Set<number>[]; synthBold: boolean; synthItalic: boolean }
interface Run { text: string; font: PDFFont; bytes: Uint8Array; graphemes: number }
export interface LineExtent { adv: number; left: number; right: number }

const charsetCache = new WeakMap<Uint8Array, Set<number>>();
function charsetOf(face: FontFace): Set<number> {
  let set = charsetCache.get(face.bytes);
  if (!set) {
    set = new Set((parsedFont(face.bytes) as unknown as { characterSet: number[] }).characterSet);
    charsetCache.set(face.bytes, set);
  }
  return set;
}

class TextEngine {
  private sets = new Map<string, Promise<FaceSet>>();
  private embedded = new Map<Uint8Array, Promise<PDFFont>>();
  private ready = new Map<Uint8Array, PDFFont>();
  constructor(private doc: PDFDocument, private provider: FontProvider) {}

  faceSet(style: TextStyle): Promise<FaceSet> {
    const key = `${style.fontId}|${style.bold}|${style.italic}`;
    if (!this.sets.has(key)) {
      this.sets.set(key, (async () => {
        const faces = await this.provider.getFaces(style.fontId, style.bold, style.italic);
        if (!faces.length) throw new RenderError(`Font "${style.fontId}" is not available.`);
        return { faces, charsets: faces.map(charsetOf), synthBold: faces[0].synthBold, synthItalic: faces[0].synthItalic };
      })());
    }
    return this.sets.get(key)!;
  }

  private pickFace(g: string, fs: FaceSet): FontFace {
    const cps = [...g].map((c) => c.codePointAt(0)!).filter((cp) => !IGNORABLE.has(cp));
    const idx = fs.charsets.findIndex((set) => cps.every((cp) => set.has(cp)));
    return fs.faces[idx < 0 ? 0 : idx];
  }

  private facesFor(graphemes: string[], fs: FaceSet): FontFace[] {
    const out: (FontFace | null)[] = graphemes.map((g) => (g === ' ' ? null : this.pickFace(g, fs)));
    const hasSpace = (f: FontFace | null | undefined): f is FontFace => !!f && fs.charsets[fs.faces.indexOf(f)]?.has(0x20);
    for (let i = 0; i < out.length; i++) {
      if (out[i]) continue;
      const next = out.slice(i + 1).find((f) => f);
      out[i] = [next, out[i - 1]].find(hasSpace) ?? fs.faces[0];
    }
    return out as FontFace[];
  }

  async prepare(text: string, fs: FaceSet): Promise<void> {
    const needed = new Set<FontFace>([fs.faces[0], ...this.facesFor(splitGraphemes(text), fs)]);
    for (const face of needed) {
      if (!this.embedded.has(face.bytes)) {
        const p = this.doc.embedFont(face.bytes, { subset: true }).then((f) => { this.ready.set(face.bytes, f); return f; });
        this.embedded.set(face.bytes, p);
      }
      await this.embedded.get(face.bytes);
    }
  }

  runs(text: string, fs: FaceSet): Run[] {
    const out: Run[] = [];
    const gs = splitGraphemes(text);
    const faces = this.facesFor(gs, fs);
    gs.forEach((g, i) => {
      const face = faces[i];
      const font = this.ready.get(face.bytes) ?? this.ready.get(fs.faces[0].bytes);
      if (!font) throw new RenderError('Font not prepared');
      const last = out[out.length - 1];
      if (last && last.font === font) { last.text += g; last.graphemes++; } else out.push({ text: g, font, bytes: face.bytes, graphemes: 1 });
    });
    return out;
  }

  private metrics = new Map<PDFFont, Map<string, { w1: number; glyphs: number; left1: number; right1: number }>>();
  runMetrics(r: Run): { w1: number; glyphs: number; left1: number; right1: number } {
    let per = this.metrics.get(r.font);
    if (!per) { per = new Map(); this.metrics.set(r.font, per); }
    let m = per.get(r.text);
    if (!m) {
      const fk = parsedFont(r.bytes) as unknown as { unitsPerEm: number; layout(t: string): { glyphs: { advanceWidth: number; bbox?: { minX: number; maxX: number } }[] } };
      const glyphs = fk.layout(r.text).glyphs;
      let pen = 0, minX = Infinity, maxX = -Infinity;
      for (const g of glyphs) {
        const b = g.bbox;
        if (b && Number.isFinite(b.minX) && Number.isFinite(b.maxX) && b.maxX > b.minX) { minX = Math.min(minX, pen + b.minX); maxX = Math.max(maxX, pen + b.maxX); }
        pen += g.advanceWidth;
      }
      const u = fk.unitsPerEm || 1000;
      m = {
        w1: r.font.widthOfTextAtSize(r.text, 1), glyphs: glyphs.length,
        left1: Number.isFinite(minX) ? Math.max(0, -minX) / u : 0, right1: Number.isFinite(maxX) ? Math.max(0, maxX - pen) / u : 0,
      };
      per.set(r.text, m);
    }
    return m;
  }

  extent(text: string, fs: FaceSet, size: number, ls: number): LineExtent {
    const runs = this.runs(text, fs);
    if (!runs.length) return { adv: 0, left: 0, right: 0 };
    let adv = 0, glyphs = 0;
    for (const r of runs) { const m = this.runMetrics(r); adv += m.w1 * size; glyphs += m.glyphs; }
    return { adv: adv + ls * Math.max(0, glyphs - 1), left: this.runMetrics(runs[0]).left1 * size, right: this.runMetrics(runs[runs.length - 1]).right1 * size };
  }

  measurer(fs: FaceSet): Measure {
    return (text, size, ls) => { const e = this.extent(text, fs, size, ls); return e.adv + e.left + e.right; };
  }

  first(fs: FaceSet): PDFFont {
    return this.ready.get(fs.faces[0].bytes)!;
  }
}

export interface LayerPlacement { layerId: string; text: string; fit: FitResult }

function resolveLayerText(layer: TextLayer, values: Record<string, string>): string {
  return fillPlaceholders(layer.content, values);
}

function withVerifyCode(values: Record<string, string>, verifyCode?: string): Record<string, string> {
  return verifyCode && !('VERIFY_CODE' in values) ? { VERIFY_CODE: verifyCode, ...values } : values;
}

function withAbbrevChars(text: string, style: TextStyle): string {
  return `${style.uppercase ? text.toLocaleUpperCase() : text}.- `;
}

export async function layoutTemplate(template: CertTemplate, values: Record<string, string>, provider: FontProvider, sizeCaps?: Record<string, number>, verifyCode?: string): Promise<LayerPlacement[]> {
  values = withVerifyCode(values, verifyCode);
  const doc = await PDFDocument.create();
  doc.registerFontkit(sharedFontkit);
  const engine = new TextEngine(doc, provider);
  const out: LayerPlacement[] = [];
  for (const layer of template.layers) {
    const fs = await engine.faceSet(layer.style);
    const text = resolveLayerText(layer, values);
    await engine.prepare(withAbbrevChars(text, layer.style), fs);
    out.push({ layerId: layer.id, text, fit: fitText(text, layer, layer.style, engine.measurer(fs), sizeCaps?.[layer.id]) });
  }
  return out;
}

export async function uniformSizeCaps(template: CertTemplate, allValues: Record<string, string>[], provider: FontProvider): Promise<Record<string, number>> {
  const uniform = template.layers.filter((l) => l.style.fit.uniformAcrossBatch);
  if (!uniform.length) return {};
  const doc = await PDFDocument.create();
  doc.registerFontkit(sharedFontkit);
  const engine = new TextEngine(doc, provider);
  const caps: Record<string, number> = {};
  for (const layer of uniform) {
    const fs = await engine.faceSet(layer.style);
    const measure = engine.measurer(fs);
    let min = layer.style.size;
    for (const v of allValues) {
      const text = resolveLayerText(layer, v);
      await engine.prepare(withAbbrevChars(text, layer.style), fs);
      min = Math.min(min, fitText(text, layer, layer.style, measure).fontSize);
    }
    caps[layer.id] = min;
  }
  return caps;
}

export interface RenderInput {
  template: CertTemplate;
  background: Uint8Array | null;
  backgroundType?: 'pdf' | 'png' | 'jpg';
  values: Record<string, string>;
  certId: string;
  recordId: string;
  personKey: string;
  verifyCode: string;
  verifyUrl: string;
  fileName: string;
  issuedAt?: Date;
  sizeCaps?: Record<string, number>;
}

async function drawBackground(doc: PDFDocument, input: RenderInput): Promise<PDFPage> {
  const [w, h] = input.template.pageSize;
  if (!input.background) return doc.addPage([w, h]);
  let type: 'pdf' | 'png' | 'jpg';
  try { type = sniffType(input.background); } catch (e) { if (!input.backgroundType) throw e; type = input.backgroundType; }
  if (type === 'pdf') {
    const [embedded] = await doc.embedPdf(input.background.slice(), [0]);
    const page = doc.addPage([w, h]);
    page.drawPage(embedded, { x: 0, y: 0, width: w, height: h });
    return page;
  }
  const img = type === 'png' ? await doc.embedPng(input.background.slice()) : await doc.embedJpg(input.background.slice());
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return page;
}

export function sniffType(b: Uint8Array): 'pdf' | 'png' | 'jpg' {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  throw new RenderError('Template must be a PDF, PNG or JPG file.');
}

async function drawLayer(page: PDFPage, engine: TextEngine, layer: TextLayer, text: string, fit: FitResult) {
  const st = layer.style;
  const fs = await engine.faceSet(st);
  const pageH = page.getHeight();
  const color = hexToPdf(st.color);
  const { r, g, b } = parseHex(st.color);
  const size = fit.fontSize;
  const lh = Math.max(0.8, st.lineHeight || 1.2);
  const boxTop = pageH - layer.y;
  const blockH = fit.lines.length * size * lh;
  const firstFont = engine.first(fs);
  const ascent = firstFont.heightAtSize(size, { descender: false });
  const descent = firstFont.heightAtSize(size) - ascent;
  const top = boxTop - (layer.height - blockH) / 2;
  const cx = layer.x + layer.width / 2;
  const cy = boxTop - layer.height / 2;

  page.pushOperators(pushGraphicsState());
  const alpha = Math.min(1, Math.max(0, Number.isFinite(st.opacity) ? st.opacity : 1));
  if (alpha < 1) {
    const gs = page.doc.context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha });
    const key = `GS_cf_${page.node.Resources()?.lookupMaybe(PDFName.of('ExtGState'), PDFDict)?.keys().length ?? 0}`;
    page.node.setExtGState(PDFName.of(key), page.doc.context.register(gs));
    page.pushOperators(setGraphicsState(PDFName.of(key)));
  }
  if (st.rotation) {
    const t = (-st.rotation * Math.PI) / 180;
    const cos = Math.cos(t), sin = Math.sin(t);
    page.pushOperators(concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy));
  }
  page.pushOperators(setCharacterSpacing(fit.letterSpacing));
  if (fs.synthBold) {
    page.pushOperators(setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(size * 0.03), setStrokingRgbColor(r / 255, g / 255, b / 255));
  }
  fit.lines.forEach((line, i) => {
    const ext = engine.extent(line, fs, size, fit.letterSpacing);
    const lineW = ext.adv;
    const x = st.align === 'left' ? layer.x + ext.left : st.align === 'right' ? layer.x + layer.width - lineW - ext.right : layer.x + (layer.width - lineW + ext.left - ext.right) / 2;
    const lineTop = top - i * size * lh;
    const baseline = lineTop - (size * lh - (ascent + descent)) / 2 - ascent;
    let cursor = x;
    for (const run of engine.runs(line, fs)) {
      page.drawText(run.text, {
        x: cursor, y: baseline, size, font: run.font, color,
        ...(fs.synthItalic ? { xSkew: degrees(12) } : {}),
      });
      cursor += engine.runMetrics(run).w1 * size + fit.letterSpacing * engine.runMetrics(run).glyphs;
    }
    if (st.underline) {
      page.drawLine({ start: { x, y: baseline - size * 0.12 }, end: { x: x + lineW, y: baseline - size * 0.12 }, thickness: Math.max(0.5, size * 0.05), color });
    }
  });
  page.pushOperators(popGraphicsState());
}

function drawQr(page: PDFPage, qr: NonNullable<CertTemplate['qr']>, url: string) {
  const code = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = code.modules.size;
  const quiet = 2;
  const cell = qr.size / (n + quiet * 2);
  const pageH = page.getHeight();
  const x0 = qr.x;
  const yTop = pageH - qr.y;
  page.drawRectangle({ x: x0, y: yTop - qr.size, width: qr.size, height: qr.size, color: rgb(1, 1, 1) });
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!code.modules.get(row, col)) { col++; continue; }
      const start = col;
      while (col < n && code.modules.get(row, col)) col++;
      page.drawRectangle({
        x: x0 + (quiet + start) * cell, y: yTop - (quiet + row + 1) * cell,
        width: (col - start) * cell + 0.01, height: cell + 0.01, color: rgb(0, 0, 0),
      });
    }
  }
}

export async function renderCertificate(input: RenderInput, provider: FontProvider): Promise<RenderedCert> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(sharedFontkit);
  const engine = new TextEngine(doc, provider);
  const page = await drawBackground(doc, input);
  const values = withVerifyCode(input.values, input.verifyCode);
  const fits: Record<string, FitResult> = {};
  for (const layer of input.template.layers) {
    const fs = await engine.faceSet(layer.style);
    const text = resolveLayerText(layer, values);
    await engine.prepare(withAbbrevChars(text, layer.style), fs);
    const fit = fitText(text, layer, layer.style, engine.measurer(fs), input.sizeCaps?.[layer.id]);
    fits[layer.id] = fit;
    if (text.trim()) await drawLayer(page, engine, layer, text, fit);
  }
  if (input.template.qr) drawQr(page, input.template.qr, input.verifyUrl);

  const when = input.issuedAt ?? new Date('2026-01-01T00:00:00Z');
  doc.setTitle(`Certificate - ${values.NAME ?? ''}`.trim());
  doc.setSubject(input.certId);
  const enc = encodeURIComponent;
  doc.setKeywords(['certflow', `cert:${enc(input.certId)}`, `record:${enc(input.recordId)}`, `person:${enc(input.personKey)}`, `verify:${enc(input.verifyCode)}`]);
  doc.setProducer('Facilify');
  doc.setCreator('Facilify');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  const pdf = await doc.save({ useObjectStreams: true });
  return { certId: input.certId, recordId: input.recordId, fileName: input.fileName, pdf, sha256: sha256(pdf), verifyCode: input.verifyCode, fits };
}

export async function readCertMeta(pdf: Uint8Array): Promise<{ certId: string; personKey: string; recordId: string; verifyCode: string }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const kw = (doc.getKeywords() ?? '').split(/\s+/);
  const get = (p: string) => {
    const v = kw.find((k) => k.startsWith(`${p}:`))?.slice(p.length + 1) ?? '';
    try { return decodeURIComponent(v); } catch { return v; }
  };
  return { certId: doc.getSubject() ?? '', personKey: get('person'), recordId: get('record'), verifyCode: get('verify') };
}

export async function pdfFontNames(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const names = new Set<string>();
  const seen = new Set<PDFDict>();
  const walk = (res: PDFDict | undefined, depth: number) => {
    if (!res || seen.has(res) || depth > 6) return;
    seen.add(res);
    const fonts = res.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (fonts) {
      for (const [, ref] of fonts.entries()) {
        const fd = doc.context.lookup(ref);
        const base = fd instanceof PDFDict ? fd.get(PDFName.of('BaseFont')) : undefined;
        if (base) names.add(String(base).replace(/^\//, ''));
      }
    }
    const xobjs = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (xobjs) {
      for (const [, ref] of xobjs.entries()) {
        const x = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        const dict = x instanceof PDFRawStream ? x.dict : undefined;
        if (dict && dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) walk(dict.lookupMaybe(PDFName.of('Resources'), PDFDict), depth + 1);
      }
    }
  };
  for (const page of doc.getPages()) walk(page.node.Resources(), 0);
  return [...names];
}

export async function backgroundPageSize(bytes: Uint8Array): Promise<[number, number]> {
  const type = sniffType(bytes);
  if (type === 'pdf') {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    return [Math.round(width * 100) / 100, Math.round(height * 100) / 100];
  }
  const doc = await PDFDocument.create();
  const img = type === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const scale = (img.width >= img.height ? 842 : 595) / img.width;
  return [Math.round(img.width * scale * 100) / 100, Math.round(img.height * scale * 100) / 100];
}
