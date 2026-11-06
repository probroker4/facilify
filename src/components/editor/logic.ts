import type { CertTemplate, TextLayer, TextStyle } from '@/lib/contracts';
import { fillPlaceholders } from '@/lib/text';

export interface Rgb { r: number; g: number; b: number }
export interface Hsl { h: number; s: number; l: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex) ?? '#000000';
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round((h / 6) * 360) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

export function parseColour(input: string): string | null {
  const text = (input ?? '').trim();
  const hex = normalizeHex(text);
  if (hex) return hex;
  const nums = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (nums.length !== 3) return null;
  if (/^hsla?\b/i.test(text)) {
    const [h, s, l] = nums;
    if (s < 0 || s > 100 || l < 0 || l > 100) return null;
    return hslToHex(h, s, l);
  }
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return rgbToHex(nums[0], nums[1], nums[2]);
}

export function contrastInk(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0f172a' : '#ffffff';
}

export function cssFamilyFor(fontId: string): string {
  return `cf-${fontId.replace(/^upload:/, 'upload-').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function backgroundRefOf(t: Pick<CertTemplate, 'backgroundRef'>): string {
  return (t.backgroundRef || 'classic').replace(/^builtin:/, '').replace(/^custom:/, '');
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const MIN_BOX_W = 20;
export const MIN_BOX_H = 10;

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function newLayerId(existing: TextLayer[]): string {
  const ids = new Set(existing.map((l) => l.id));
  let n = existing.length + 1;
  while (ids.has(`layer-${n}`)) n++;
  return `layer-${n}`;
}

export function defaultLayerStyle(over: Partial<TextStyle> = {}): TextStyle {
  return {
    fontId: 'noto-serif', size: 24, minSize: 10, color: '#1f2937', bold: false, italic: false, underline: false, align: 'center',
    letterSpacing: 0, lineHeight: 1.2, uppercase: false, opacity: 1, rotation: 0, maxLines: 2,
    ...over,
    fit: { mode: 'shrink-then-wrap', allowAbbreviate: false, minLetterSpacing: -0.5, uniformAcrossBatch: false, ...(over.fit ?? {}) },
  };
}

export function makeLayer(template: CertTemplate, over: Partial<TextLayer> = {}): TextLayer {
  const [pw, ph] = template.pageSize;
  const width = Math.min(360, Math.round(pw * 0.6));
  const height = 48;
  let y = Math.round(ph / 2 - height / 2);
  while (template.layers.some((l) => Math.abs(l.x - Math.round((pw - width) / 2)) < 2 && Math.abs(l.y - y) < 4)) y += 24;
  return {
    id: newLayerId(template.layers), content: 'New text', x: Math.round((pw - width) / 2), y: Math.min(y, ph - height), width, height,
    style: defaultLayerStyle(), ...over,
  };
}

export function duplicateLayer(template: CertTemplate, id: string): TextLayer | null {
  const src = template.layers.find((l) => l.id === id);
  if (!src) return null;
  const [pw, ph] = template.pageSize;
  return {
    ...src, id: newLayerId(template.layers),
    x: round1(Math.min(src.x + 16, pw - src.width)), y: round1(Math.min(src.y + 16, ph - src.height)),
    style: { ...src.style, fit: { ...src.style.fit } },
  };
}

export function replaceLayer(template: CertTemplate, layer: TextLayer): CertTemplate {
  return { ...template, layers: template.layers.map((l) => (l.id === layer.id ? layer : l)) };
}

export interface SnapResult { x: number; y: number; guideX: number | null; guideY: number | null }

export function snapToGuides(layer: Pick<TextLayer, 'width' | 'height'>, x: number, y: number, page: [number, number], others: TextLayer[], threshold: number): SnapResult {
  const cx = x + layer.width / 2, cy = y + layer.height / 2;
  const targetsX = [page[0] / 2, ...others.map((o) => o.x + o.width / 2)];
  const targetsY = [page[1] / 2, ...others.map((o) => o.y + o.height / 2)];
  const bestX = targetsX.map((t) => ({ t, d: Math.abs(t - cx) })).filter((c) => c.d <= threshold).sort((a, b) => a.d - b.d)[0];
  const bestY = targetsY.map((t) => ({ t, d: Math.abs(t - cy) })).filter((c) => c.d <= threshold).sort((a, b) => a.d - b.d)[0];
  return {
    x: bestX ? bestX.t - layer.width / 2 : x, y: bestY ? bestY.t - layer.height / 2 : y,
    guideX: bestX ? bestX.t : null, guideY: bestY ? bestY.t : null,
  };
}

export function resizeBox(start: Pick<TextLayer, 'x' | 'y' | 'width' | 'height'>, handle: Handle, dx: number, dy: number, rotationDeg: number): Pick<TextLayer, 'x' | 'y' | 'width' | 'height'> {
  const th = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const width = Math.max(MIN_BOX_W, start.width + sx * lx);
  const height = Math.max(MIN_BOX_H, start.height + sy * ly);
  const ddw = width - start.width, ddh = height - start.height;
  const lcx = (sx * ddw) / 2, lcy = (sy * ddh) / 2;
  const cx = start.x + start.width / 2 + lcx * cos - lcy * sin;
  const cy = start.y + start.height / 2 + lcx * sin + lcy * cos;
  return { x: round1(cx - width / 2), y: round1(cy - height / 2), width: round1(width), height: round1(height) };
}

export const SAMPLE_DEFAULTS: Record<string, string> = {
  NAME: 'Ada Lovelace', ID: 'STU-0001', EMAIL: 'ada@example.com', PERSONAL_EMAIL: 'ada.personal@example.com', EVENT: 'Hack the Future 2026',
  CERTIFICATE_TYPE: 'Winner', ACHIEVEMENT: 'First Prize', DATE: '12 March 2026', VERIFY_CODE: 'PREVIEW', CATEGORY: 'Winner',
};

export function sampleValuesFor(placeholders: string[], rows: Record<string, string>[], index: number): Record<string, string> {
  if (rows.length) return { ...rows[Math.min(Math.max(0, index), rows.length - 1)] };
  const out: Record<string, string> = {};
  for (const p of placeholders) out[p] = SAMPLE_DEFAULTS[p] ?? `Sample ${p.toLowerCase()}`;
  return { ...SAMPLE_DEFAULTS, ...out };
}

export function longestRowIndex(rows: Record<string, string>[], template: CertTemplate): number {
  let best = 0, bestScore = -1;
  rows.forEach((row, i) => {
    const score = Math.max(0, ...template.layers.map((l) => fillPlaceholders(l.content, row).length / Math.max(1, l.width / Math.max(1, l.style.size))));
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

export function insertAtCaret(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length)), e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + insert + text.slice(e), caret: s + insert.length };
}

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  constructor(private limit = 200, private windowMs = 700) {}

  record(before: T, key: string | null, now = Date.now()): void {
    const merge = key !== null && key === this.lastKey && now - this.lastAt < this.windowMs;
    this.lastKey = key;
    this.lastAt = now;
    if (!merge) {
      this.past.push(before);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
  }

  touch(now = Date.now()): void { this.lastAt = now; }

  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    this.lastKey = null;
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastKey = null;
    return next;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  clear(): void { this.past = []; this.future = []; this.lastKey = null; }
}
