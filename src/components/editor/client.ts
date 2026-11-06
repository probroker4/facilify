import type { CertTemplate } from '@/lib/contracts';
import { cssFamilyFor, normalizeHex, rgbToHex } from './logic';

export interface CatalogFontLite { id: string; family: string; category: string; weights?: number[]; styles?: string[]; bundled?: boolean }
export interface FontSearchResult { fonts: CatalogFontLite[]; total: number; source?: string; fuzzy?: boolean }
export interface FitInfo { layerId: string; text: string; fit: { lines: string[]; fontSize: number; letterSpacing: number; shrunk: boolean; wrapped: boolean; abbreviated: boolean; overflow?: boolean } }
export interface TemplateFontSuggestion { pdfName: string; family: string; match: CatalogFontLite | null; bold: boolean; italic: boolean }

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const j = await res.json().catch(() => null) as { error?: string } | null;
  return new Error(j?.error || fallback);
}

export async function searchFontsApi(opts: { q?: string; category?: string; ids?: string[]; limit?: number }, signal?: AbortSignal): Promise<FontSearchResult> {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.category) p.set('category', opts.category);
  if (opts.ids?.length) p.set('ids', opts.ids.join(','));
  p.set('limit', String(opts.limit ?? 40));
  const res = await fetch(`/api/editor/fonts?${p}`, { signal });
  if (!res.ok) throw await errorOf(res, 'The font list could not be loaded.');
  return res.json();
}

export async function renderPreviewApi(template: CertTemplate, values: Record<string, string>, rows: Record<string, string>[] | undefined, scale: number, signal?: AbortSignal): Promise<Blob> {
  const needRows = template.layers.some((l) => l.style.fit?.uniformAcrossBatch);
  const res = await fetch('/api/editor/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ template, values, scale, rows: needRows ? rows : undefined }),
  });
  if (!res.ok) throw await errorOf(res, 'The preview could not be drawn.');
  return res.blob();
}

export async function layoutApi(template: CertTemplate, values: Record<string, string>, rows: Record<string, string>[] | undefined, signal?: AbortSignal): Promise<FitInfo[]> {
  const needRows = template.layers.some((l) => l.style.fit?.uniformAcrossBatch);
  const res = await fetch('/api/editor/layout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ template, values, rows: needRows ? rows : undefined }),
  });
  if (!res.ok) throw await errorOf(res, 'The text fit could not be checked.');
  return ((await res.json()) as { placements: FitInfo[] }).placements;
}

export async function uploadFontApi(file: File): Promise<{ fontId: string; family: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/editor/font-upload', { method: 'POST', body: form });
  if (!res.ok) throw await errorOf(res, 'The font could not be uploaded.');
  return res.json();
}

export async function uploadBackgroundApi(file: File): Promise<{ uploadId: string; mime: string; pageSize: [number, number]; name: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/editor/background', { method: 'POST', body: form });
  if (!res.ok) throw await errorOf(res, 'The template could not be uploaded.');
  return res.json();
}

export async function paletteApi(ref: string, signal?: AbortSignal): Promise<{ hex: string; share: number }[]> {
  const res = await fetch(`/api/editor/palette/${encodeURIComponent(ref)}`, { signal });
  if (!res.ok) throw await errorOf(res, 'The template colours could not be read.');
  return ((await res.json()) as { colours: { hex: string; share: number }[] }).colours;
}

export async function templateFontsApi(uploadId: string, signal?: AbortSignal): Promise<TemplateFontSuggestion[]> {
  const res = await fetch('/api/editor/template-fonts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId }), signal });
  if (!res.ok) throw await errorOf(res, 'The fonts in this template could not be read.');
  return ((await res.json()) as { suggestions: TemplateFontSuggestion[] }).suggestions;
}

const loadedCss = new Set<string>();

export function ensureFontCss(fontId: string): string {
  const family = cssFamilyFor(fontId);
  if (typeof document === 'undefined' || loadedCss.has(fontId)) return family;
  loadedCss.add(fontId);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `/api/editor/font-css?id=${encodeURIComponent(fontId)}`;
  link.dataset.cfFont = fontId;
  document.head.appendChild(link);
  return family;
}

export interface Sampler { width: number; height: number; hexAt(fx: number, fy: number): string }

const samplers = new Map<string, Promise<Sampler>>();

export function loadSampler(ref: string): Promise<Sampler> {
  const key = ref;
  if (!samplers.has(key)) {
    const p = new Promise<Sampler>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { reject(new Error('Your browser cannot read pixels from the template.')); return; }
        ctx.drawImage(img, 0, 0);
        resolve({
          width: canvas.width, height: canvas.height,
          hexAt(fx, fy) {
            const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(fx * canvas.width)));
            const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(fy * canvas.height)));
            const d = ctx.getImageData(x, y, 1, 1).data;
            return rgbToHex(d[0], d[1], d[2]);
          },
        });
      };
      img.onerror = () => reject(new Error('The template picture could not be loaded.'));
      img.src = `/api/editor/background/${encodeURIComponent(ref)}?scale=2`;
    });
    p.catch(() => samplers.delete(key));
    samplers.set(key, p);
  }
  return samplers.get(key)!;
}

export function forgetSampler(ref: string): void { samplers.delete(ref); }

function readList(key: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!normalizeHex(x)) : [];
  } catch { return []; }
}

function writeList(key: string, list: string[]): void {
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch {  }
}

export const colourStore = {
  recent: () => readList('certflow.colours.recent'),
  saved: () => readList('certflow.colours.saved'),
  addRecent(hex: string): string[] {
    const list = [hex, ...readList('certflow.colours.recent').filter((c) => c !== hex)].slice(0, 12);
    writeList('certflow.colours.recent', list);
    return list;
  },
  toggleSaved(hex: string): string[] {
    const cur = readList('certflow.colours.saved');
    const list = cur.includes(hex) ? cur.filter((c) => c !== hex) : [...cur, hex].slice(0, 24);
    writeList('certflow.colours.saved', list);
    return list;
  },
};

export const fontStore = {
  mine(): { fontId: string; family: string }[] {
    try {
      const v = JSON.parse(window.localStorage.getItem('certflow.fonts.mine') ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is { fontId: string; family: string } => !!x && typeof (x as { fontId?: unknown }).fontId === 'string') : [];
    } catch { return []; }
  },
  add(f: { fontId: string; family: string }): void {
    const list = [f, ...this.mine().filter((x) => x.fontId !== f.fontId)].slice(0, 20);
    try { window.localStorage.setItem('certflow.fonts.mine', JSON.stringify(list)); } catch {  }
  },
};

export interface FontMatchLite { id: string; family: string; category: string; bold: boolean; score: number }
export interface IdentifyResult { matches: FontMatchLite[]; searched: number; total: number; catalogSize: number; seen: string }

export async function identifyFontApi(
  body: { ref: string; box: { x: number; y: number; w: number; h: number }; text: string; scope?: 'popular' | 'more'; category?: string },
  signal?: AbortSignal,
): Promise<IdentifyResult> {
  const res = await fetch('/api/editor/identify-font', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await errorOf(res, 'The font could not be identified.');
  return res.json();
}
