import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import type { CertTemplate, TextLayer, TextStyle } from '@/lib/contracts';

export const A4_LANDSCAPE: [number, number] = [842, 595];

type Accent = { r: number; g: number; b: number };
const C = (hex: string): Accent => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

export interface BuiltinDef { id: string; name: string; paper: string; accent: string; ink: string; style: 'classic' | 'modern' | 'elegant' }

export const BUILTIN_BACKGROUNDS: BuiltinDef[] = [
  { id: 'classic', name: 'Classic Navy', paper: '#fbf8f1', accent: '#1f3a5f', ink: '#1f3a5f', style: 'classic' },
  { id: 'modern', name: 'Modern Teal', paper: '#ffffff', accent: '#0f766e', ink: '#0f172a', style: 'modern' },
  { id: 'elegant', name: 'Elegant Ivory', paper: '#fffdf6', accent: '#a07a2c', ink: '#3b2f1e', style: 'elegant' },
  { id: 'gold', name: 'Gold (1st)', paper: '#fffaf0', accent: '#b8860b', ink: '#3b2f1e', style: 'elegant' },
  { id: 'silver', name: 'Silver (2nd)', paper: '#fbfbfd', accent: '#7c8794', ink: '#1f2937', style: 'elegant' },
  { id: 'bronze', name: 'Bronze (3rd)', paper: '#fff8f2', accent: '#a0522d', ink: '#3b2414', style: 'elegant' },
  { id: 'mention', name: 'Honourable Mention', paper: '#f7fbff', accent: '#4f46e5', ink: '#1e1b4b', style: 'classic' },
  { id: 'participation', name: 'Participation', paper: '#ffffff', accent: '#2563eb', ink: '#0f172a', style: 'modern' },
];

function frame(page: PDFPage, d: BuiltinDef) {
  const [w, h] = A4_LANDSCAPE;
  const a = C(d.accent);
  const paper = C(d.paper);
  page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(paper.r, paper.g, paper.b) });
  if (d.style === 'classic') {
    page.drawRectangle({ x: 18, y: 18, width: w - 36, height: h - 36, borderColor: rgb(a.r, a.g, a.b), borderWidth: 6 });
    page.drawRectangle({ x: 32, y: 32, width: w - 64, height: h - 64, borderColor: rgb(a.r, a.g, a.b), borderWidth: 1.2 });
  } else if (d.style === 'modern') {
    page.drawRectangle({ x: 0, y: 0, width: 26, height: h, color: rgb(a.r, a.g, a.b) });
    page.drawRectangle({ x: 26, y: 0, width: 8, height: h, color: rgb(a.r * 0.6 + 0.4, a.g * 0.6 + 0.4, a.b * 0.6 + 0.4) });
    page.drawRectangle({ x: 34, y: h - 10, width: w - 34, height: 10, color: rgb(a.r, a.g, a.b) });
    page.drawCircle({ x: w - 70, y: 70, size: 120, color: rgb(a.r, a.g, a.b), opacity: 0.08 });
  } else {
    page.drawRectangle({ x: 24, y: 24, width: w - 48, height: h - 48, borderColor: rgb(a.r, a.g, a.b), borderWidth: 2.5 });
    page.drawRectangle({ x: 34, y: 34, width: w - 68, height: h - 68, borderColor: rgb(a.r, a.g, a.b), borderWidth: 0.8 });
    for (const [cx, cy] of [[24, 24], [w - 24, 24], [24, h - 24], [w - 24, h - 24]]) {
      page.drawCircle({ x: cx, y: cy, size: 16, color: rgb(a.r, a.g, a.b) });
      page.drawCircle({ x: cx, y: cy, size: 9, color: rgb(paper.r, paper.g, paper.b) });
    }
    page.drawLine({ start: { x: w / 2 - 120, y: h - 150 }, end: { x: w / 2 + 120, y: h - 150 }, thickness: 1, color: rgb(a.r, a.g, a.b) });
  }
}

const cache = new Map<string, Promise<Uint8Array>>();
export function builtinBackground(id: string): Promise<Uint8Array> {
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      const d = BUILTIN_BACKGROUNDS.find((b) => b.id === id);
      if (!d) throw new Error(`Unknown built-in template "${id}"`);
      const doc = await PDFDocument.create();
      const page = doc.addPage(A4_LANDSCAPE);
      frame(page, d);
      doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
      doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
      doc.setProducer('Facilify');
      return doc.save();
    })());
  }
  return cache.get(id)!;
}

export function defaultStyle(over: Partial<TextStyle> = {}): TextStyle {
  const fit = { mode: 'shrink-then-wrap' as const, allowAbbreviate: true, minLetterSpacing: -0.5, uniformAcrossBatch: false, ...(over.fit ?? {}) };
  return {
    fontId: 'noto-serif', size: 18, minSize: 9, color: '#1f2937', bold: false, italic: false, underline: false, align: 'center',
    letterSpacing: 0, lineHeight: 1.2, uppercase: false, opacity: 1, rotation: 0, maxLines: 2,
    ...over,
    fit,
  };
}

export function builtinTemplate(id: string, title = 'CERTIFICATE OF ACHIEVEMENT'): CertTemplate {
  const d = BUILTIN_BACKGROUNDS.find((b) => b.id === id) ?? BUILTIN_BACKGROUNDS[0];
  const [w] = A4_LANDSCAPE;
  const left = d.style === 'modern' ? 70 : 60;
  const width = w - left - 60;
  const layer = (lid: string, content: string, y: number, height: number, style: Partial<TextStyle>): TextLayer => ({
    id: lid, content, x: left, y, width, height, style: defaultStyle({ color: d.ink, ...style }),
  });
  return {
    id: `builtin:${id}`, name: d.name, kind: 'builtin', pageSize: A4_LANDSCAPE, backgroundRef: id,
    layers: [
      layer('title', title, 70, 50, { fontId: 'cinzel', size: 34, minSize: 18, bold: true, color: d.accent, letterSpacing: 2, maxLines: 1 }),
      layer('subtitle', 'This certificate is proudly presented to', 165, 28, { fontId: 'noto-serif', size: 15, italic: true, maxLines: 1 }),
      layer('name', '{{NAME}}', 200, 80, { fontId: 'great-vibes', size: 56, minSize: 22, color: d.accent, maxLines: 2 }),
      layer('body', '{{ACHIEVEMENT}}', 292, 40, { fontId: 'noto-serif', size: 17, minSize: 10, maxLines: 2 }),
      layer('event', 'at {{EVENT}}', 334, 28, { fontId: 'noto-serif', size: 17, minSize: 10, maxLines: 1 }),
      layer('award', '{{CERTIFICATE_TYPE}}', 370, 30, { fontId: 'montserrat', size: 15, bold: true, uppercase: true, letterSpacing: 1.5, color: d.accent, maxLines: 1 }),
      { id: 'date', content: 'Date: {{DATE}}', x: left + 20, y: 470, width: 260, height: 26, style: defaultStyle({ fontId: 'noto-sans', size: 12, align: 'left', color: d.ink, maxLines: 1 }) },
      { id: 'certid', content: 'Verify: {{VERIFY_CODE}}', x: left + 20, y: 496, width: 260, height: 22, style: defaultStyle({ fontId: 'noto-sans', size: 9, align: 'left', color: '#6b7280', maxLines: 1 }) },
    ],
  };
}

export function listBuiltinTemplates(): CertTemplate[] {
  return BUILTIN_BACKGROUNDS.map((b) => builtinTemplate(b.id));
}
