import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { BUNDLED_FONTS, fontIdFromFamily, type CatalogFont, type CatalogSource } from './catalog';
import { FALLBACK_FONT_IDS, FALLBACK_SUBSETS, PRIMARY_SUBSETS, type FontFace, type FontProvider } from './provider';
import { dataDir } from '@/lib/paths';

const ASSET_DIR = path.join(process.cwd(), 'assets', 'fonts');
const FONTSOURCE_API = 'https://api.fontsource.org/v1/fonts';
const GOOGLE_API = 'https://www.googleapis.com/webfonts/v1/webfonts';
const CATALOG_TTL_MS = 7 * 86400_000;

type Fetch = (url: string) => Promise<Response>;
let fetcher: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(15_000) });

export function setFontFetch(f: Fetch | null): void {
  fetcher = f ?? ((url) => fetch(url, { signal: AbortSignal.timeout(15_000) }));
  resetFontCaches();
}

type Variants = Record<string, Record<string, Record<string, { url: { ttf?: string } }>>>;

const metaCache = new Map<string, Promise<{ subsets: string[]; variants: Variants } | null>>();
const bytesCache = new Map<string, Promise<Uint8Array | null>>();

export function resetFontCaches(): void {
  metaCache.clear();
  bytesCache.clear();
  catalogPromise = null;
  googleFiles = new Map();
  currentSource = null;
}

function cacheDir(): string {
  const d = path.join(dataDir(), 'fonts');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function safeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function readIfExists(p: string): Uint8Array | null {
  try { return new Uint8Array(fs.readFileSync(p)); } catch { return null; }
}

function writeCache(file: string, bytes: Uint8Array | string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch {  }
}

function isFontBytes(b: Uint8Array): boolean {
  const sig = (...s: number[]) => s.every((v, i) => b[i] === v);
  return b.length > 12 && (sig(0x00, 0x01, 0x00, 0x00) || sig(0x74, 0x72, 0x75, 0x65) || sig(0x4f, 0x54, 0x54, 0x4f));
}

async function download(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(url.replace(/^http:\/\//, 'https://'));
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return isFontBytes(buf) ? buf : null;
      }
      if (res.status !== 429 && res.status < 500) return null;
    } catch {  }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

export function parseGoogleVariant(v: string): { weight: number; style: 'normal' | 'italic' } | null {
  if (v === 'regular') return { weight: 400, style: 'normal' };
  if (v === 'italic') return { weight: 400, style: 'italic' };
  const m = /^(\d{3})(italic)?$/.exec(v);
  return m ? { weight: Number(m[1]), style: m[2] ? 'italic' : 'normal' } : null;
}

interface GoogleItem { family: string; category?: string; variants?: string[]; subsets?: string[]; files?: Record<string, string> }

export function fromGoogleItems(items: GoogleItem[]): { fonts: CatalogFont[]; files: Record<string, Record<string, string>> } {
  const fonts: CatalogFont[] = [];
  const files: Record<string, Record<string, string>> = {};
  items.forEach((it, rank) => {
    if (!it?.family) return;
    const id = fontIdFromFamily(it.family);
    const weights = new Set<number>();
    const styles = new Set<string>();
    const urls: Record<string, string> = {};
    for (const v of it.variants ?? Object.keys(it.files ?? {})) {
      const p = parseGoogleVariant(v);
      if (!p) continue;
      weights.add(p.weight);
      styles.add(p.style);
      const url = it.files?.[v];
      if (url) urls[`${p.weight}-${p.style}`] = url;
    }
    files[id] = urls;
    fonts.push({
      id, family: it.family, category: it.category ?? 'sans-serif', subsets: it.subsets ?? ['latin'],
      weights: [...weights].sort((a, b) => a - b), styles: [...styles].sort(), popularity: rank + 1, source: 'google',
    });
  });
  return { fonts, files };
}

interface CatalogFile { source: CatalogSource; savedAt: number; fonts: CatalogFont[]; files?: Record<string, Record<string, string>> }

let catalogPromise: Promise<CatalogFont[]> | null = null;
let googleFiles = new Map<string, Record<string, string>>();
let currentSource: CatalogSource | null = null;

function sourceChain(): Exclude<CatalogSource, 'bundled'>[] {
  return process.env.GOOGLE_FONTS_API_KEY?.trim() ? ['google', 'fontsource'] : ['fontsource'];
}

function readCatalogCache(file: string): CatalogFile | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as CatalogFile;
    return Array.isArray(j?.fonts) && j.fonts.length ? j : null;
  } catch { return null; }
}

function useCatalog(c: CatalogFile): CatalogFont[] {
  currentSource = c.source;
  googleFiles = new Map(Object.entries(c.files ?? {}));
  const byId = new Map(c.fonts.map((f) => [f.id, f]));
  const fonts = c.fonts.slice();
  for (const b of BUNDLED_FONTS) if (!byId.has(b.id)) fonts.push({ ...b });
  const bundledIds = new Map(BUNDLED_FONTS.map((b) => [b.id, b]));
  return fonts.map((f) => (bundledIds.has(f.id) ? { ...f, bundled: true, popularity: f.popularity ?? bundledIds.get(f.id)!.popularity } : f));
}

async function fetchCatalog(source: Exclude<CatalogSource, 'bundled'>): Promise<CatalogFile> {
  if (source === 'google') {
    const key = encodeURIComponent(process.env.GOOGLE_FONTS_API_KEY ?? '');
    const res = await fetcher(`${GOOGLE_API}?key=${key}&sort=popularity`);
    if (!res.ok) throw new Error(`Google Fonts API ${res.status}`);
    const j = (await res.json()) as { items?: GoogleItem[] };
    const { fonts, files } = fromGoogleItems(j.items ?? []);
    if (!fonts.length) throw new Error('Google Fonts API returned no fonts');
    return { source, savedAt: Date.now(), fonts, files };
  }
  const res = await fetcher(`${FONTSOURCE_API}?type=google`);
  if (!res.ok) throw new Error(`Fontsource API ${res.status}`);
  const list = (await res.json()) as { id: string; family: string; category: string; subsets: string[]; weights: number[]; styles: string[] }[];
  const fonts: CatalogFont[] = list.filter((f) => f?.id && f.family).map((f) => ({
    id: safeId(f.id), family: f.family, category: f.category, subsets: f.subsets ?? [], weights: f.weights ?? [400], styles: f.styles ?? ['normal'], source: 'fontsource' as const,
  }));
  if (!fonts.length) throw new Error('Fontsource returned no fonts');
  return { source, savedAt: Date.now(), fonts };
}

export function loadCatalog(opts: { refresh?: boolean } = {}): Promise<CatalogFont[]> {
  if (opts.refresh) catalogPromise = null;
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const chain = sourceChain();
      const files = chain.map((source) => path.join(cacheDir(), `catalog-${source}.json`));
      const cached = chain.map((_, i) => readCatalogCache(files[i]));
      if (!opts.refresh && cached[0] && Date.now() - cached[0].savedAt < CATALOG_TTL_MS) return useCatalog(cached[0]);
      for (let i = 0; i < chain.length; i++) {
        try {
          const fresh = await fetchCatalog(chain[i]);
          writeCache(files[i], JSON.stringify(fresh));
          return useCatalog(fresh);
        } catch (e) {
          console.warn(`[fonts] ${chain[i]} catalogue unavailable: ${(e as Error).message}`);
        }
      }
      const stale = cached.find((c) => !!c);
      if (stale) return useCatalog(stale);
      currentSource = 'bundled';
      googleFiles = new Map();
      return BUNDLED_FONTS.map((f) => ({ ...f }));
    })();
  }
  return catalogPromise;
}

export async function catalogSource(): Promise<CatalogSource> {
  await loadCatalog();
  return currentSource ?? 'bundled';
}

async function fetchMeta(id: string): Promise<{ subsets: string[]; variants: Variants } | null> {
  if (!metaCache.has(id)) {
    metaCache.set(id, (async () => {
      const cacheFile = path.join(cacheDir(), `${id}.meta.json`);
      try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {  }
      try {
        const res = await fetcher(`${FONTSOURCE_API}/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const j = await res.json() as { subsets: string[]; variants: Variants };
        if (!j?.variants) return null;
        const meta = { subsets: j.subsets ?? [], variants: j.variants };
        writeCache(cacheFile, JSON.stringify(meta));
        return meta;
      } catch { return null; }
    })());
  }
  const p = metaCache.get(id)!;
  void p.then((m) => { if (!m && metaCache.get(id) === p) metaCache.delete(id); });
  return p;
}

export async function fontFile(id: string, subset: string, weight: number, style: string): Promise<Uint8Array | null> {
  id = safeId(id);
  const name = `${subset.replace(/[^a-z0-9-]/gi, '')}-${Number(weight) || 400}-${style === 'italic' ? 'italic' : 'normal'}.ttf`;
  const key = `${id}/${name}`;
  if (!bytesCache.has(key)) {
    bytesCache.set(key, (async () => {
      const local = readIfExists(path.join(ASSET_DIR, id, name)) ?? readIfExists(path.join(cacheDir(), id, name));
      if (local) return local;
      const meta = await fetchMeta(id);
      const url = meta?.variants?.[String(weight)]?.[style]?.[subset]?.url?.ttf
        ?? `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${name}`;
      const buf = await download(url);
      if (buf) writeCache(path.join(cacheDir(), id, name), buf);
      return buf;
    })());
  }
  return forgetMisses(key);
}

function forgetMisses(key: string): Promise<Uint8Array | null> {
  const p = bytesCache.get(key)!;
  void p.then((b) => { if (!b && bytesCache.get(key) === p) bytesCache.delete(key); });
  return p;
}

async function googleFile(id: string, weight: number, style: string, url: string): Promise<Uint8Array | null> {
  const name = `google-${weight}-${style}.ttf`;
  const key = `${id}/${name}`;
  if (!bytesCache.has(key)) {
    bytesCache.set(key, (async () => {
      const file = path.join(cacheDir(), id, name);
      const local = readIfExists(file);
      if (local) return local;
      const buf = await download(url);
      if (buf) writeCache(file, buf);
      return buf;
    })());
  }
  return forgetMisses(key);
}

interface Availability { subsets: string[]; has: (w: number, s: string) => boolean; weights: number[]; google?: Record<string, string> }

async function availability(id: string): Promise<Availability> {
  const dir = path.join(ASSET_DIR, id);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ttf'));
    const subsets = [...new Set(files.map((f) => f.replace(/-\d+-(normal|italic)\.ttf$/, '')))];
    const weights = [...new Set(files.map((f) => Number(/-(\d+)-(?:normal|italic)\.ttf$/.exec(f)?.[1])).filter(Boolean))];
    return { subsets, weights, has: (w, s) => files.some((f) => f.endsWith(`-${w}-${s}.ttf`)) };
  }
  {
    await loadCatalog();
    const g = googleFiles.get(id);
    if (g && Object.keys(g).length) {
      return { subsets: ['all'], has: (w, s) => !!g[`${w}-${s}`], google: g, weights: [...new Set(Object.keys(g).map((k) => Number(k.split('-')[0])))] };
    }
  }
  const meta = await fetchMeta(id);
  if (!meta) return { subsets: [], weights: [], has: () => false };
  return { subsets: meta.subsets, weights: Object.keys(meta.variants ?? {}).map(Number), has: (w, s) => !!meta.variants?.[String(w)]?.[s] };
}

async function facesForCatalogFont(rawId: string, bold: boolean, italic: boolean, subsetList: string[] = PRIMARY_SUBSETS): Promise<FontFace[]> {
  const id = safeId(rawId);
  if (!id) return [];
  const avail = await availability(id);
  const wantW = bold ? 700 : 400;
  const wantS = italic ? 'italic' : 'normal';
  const candidates = bold ? [700, 800, 600, 900, 500] : [400, 500, 300];
  const has = (w: number) => avail.has(w, wantS) || avail.has(w, 'normal');
  const weight = candidates.find(has) ?? [...avail.weights].filter(has).sort((a, b) => Math.abs(a - wantW) - Math.abs(b - wantW))[0] ?? 400;
  const style = avail.has(weight, wantS) ? wantS : 'normal';
  const synthBold = bold && weight < 600;
  const synthItalic = italic && style !== 'italic';
  const faces: FontFace[] = [];
  if (avail.google) {
    const url = avail.google[`${weight}-${style}`] ?? avail.google['400-normal'];
    const bytes = url ? await googleFile(id, weight, style, url) : null;
    if (bytes) faces.push({ bytes, synthBold, synthItalic, label: `${id}/google-${weight}-${style}` });
    return faces;
  }
  const subsets = subsetList.filter((s) => avail.subsets.includes(s));
  for (const subset of subsets) {
    const bytes = await fontFile(id, subset, weight, style);
    if (bytes) faces.push({ bytes, synthBold, synthItalic, label: `${id}/${subset}-${weight}-${style}` });
  }
  return faces;
}

export function uploadedFontPath(uploadId: string): string {
  return path.join(dataDir(), 'uploads', uploadId.replace(/[^a-zA-Z0-9_-]/g, ''));
}

function realStyle(bytes: Uint8Array): { weight: number; italic: boolean } | null {
  try {
    const f = fontkit.create(bytes as unknown as Buffer) as unknown as { 'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean } }; italicAngle?: number; head?: { macStyle?: { italic?: boolean } } };
    return {
      weight: f['OS/2']?.usWeightClass ?? 400,
      italic: !!(f['OS/2']?.fsSelection?.italic || f.head?.macStyle?.italic || (f.italicAngle ?? 0) !== 0),
    };
  } catch { return null; }
}

const MISS_TTL_MS = 60_000;

export async function ownLatinFace(rawId: string, bold: boolean): Promise<FontFace | null> {
  try {
    const faces = await facesForCatalogFont(rawId, bold, false, ['latin']);
    return faces[0] ?? null;
  } catch { return null; }
}

export class ServerFontProvider implements FontProvider {
  private cache = new Map<string, Promise<FontFace[]>>();
  readonly fallbacks = new Set<string>();

  async getFaces(fontId: string, bold: boolean, italic: boolean): Promise<FontFace[]> {
    const key = `${fontId}|${bold}|${italic}`;
    if (!this.cache.has(key)) {
      let ownFound = true;
      const p = (async () => {
        let own: FontFace[] = [];
        if (fontId.startsWith('upload:')) {
          const bytes = readIfExists(uploadedFontPath(fontId.slice(7)));
          if (bytes && isFontBytes(bytes)) {
            const real = realStyle(bytes);
            own = [{ bytes, synthBold: bold && (real?.weight ?? 400) < 600, synthItalic: italic && !real?.italic, label: fontId }];
          }
        } else {
          own = await facesForCatalogFont(fontId, bold, italic);
        }
        if (!own.length) {
          ownFound = false;
          this.fallbacks.add(fontId);
          console.warn(`[fonts] "${fontId}" is not available; using the fallback font instead.`);
        }
        const fallbacks: FontFace[] = [];
        for (const fb of FALLBACK_FONT_IDS) {
          if (fb === fontId) continue;
          fallbacks.push(...(await facesForCatalogFont(fb, bold, italic, FALLBACK_SUBSETS)));
        }
        const all = [...own, ...fallbacks];
        if (!all.length) throw new Error(`Font "${fontId}" is not available and no fallback font is installed (run npx tsx scripts/fetch-fonts.ts).`);
        return all;
      })();
      p.then(() => { if (!ownFound) setTimeout(() => { if (this.cache.get(key) === p) this.cache.delete(key); }, MISS_TTL_MS).unref?.(); }, () => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return this.cache.get(key)!;
  }
}
