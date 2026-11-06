import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { rasterizePdf } from '@/lib/render/raster';

export interface Box { x: number; y: number; w: number; h: number }
export interface Shape { w: number; h: number; ink: Float32Array }

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

const GRID_W = 192;
const GRID_H = 48;

export async function templatePixels(bytes: Uint8Array, type: 'pdf' | 'png' | 'jpg', maxSide = 2800): Promise<Pixels> {
  if (type === 'pdf') {
    const first = await rasterizePdf(bytes, 2);
    return { width: first.width, height: first.height, data: first.data };
  }
  const img = await loadImage(Buffer.from(bytes));
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data as unknown as Uint8ClampedArray };
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

function otsu(values: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 32;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

export function shapeFromRegion(px: Pixels, box: Box): Shape | null {
  const x0 = Math.max(0, Math.floor(box.x * px.width)), y0 = Math.max(0, Math.floor(box.y * px.height));
  const x1 = Math.min(px.width, Math.ceil((box.x + box.w) * px.width)), y1 = Math.min(px.height, Math.ceil((box.y + box.h) * px.height));
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 6) return null;
  const at = (x: number, y: number) => (y * px.width + x) * 4;
  const border: [number[], number[], number[]] = [[], [], []];
  const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
  for (let x = x0; x < x1; x += step) for (const y of [y0, y1 - 1]) { const i = at(x, y); border[0].push(px.data[i]); border[1].push(px.data[i + 1]); border[2].push(px.data[i + 2]); }
  for (let y = y0; y < y1; y += step) for (const x of [x0, x1 - 1]) { const i = at(x, y); border[0].push(px.data[i]); border[1].push(px.data[i + 1]); border[2].push(px.data[i + 2]); }
  const bg = [median(border[0]), median(border[1]), median(border[2])];
  const dist = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x0 + x, y0 + y);
    const d = Math.hypot(px.data[i] - bg[0], px.data[i + 1] - bg[1], px.data[i + 2] - bg[2]);
    dist[y * w + x] = Math.min(255, Math.round(d * 255 / 441.7));
  }
  const thr = Math.max(14, otsu(dist));
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (dist[y * w + x] > thr) { ink[y * w + x] = 1; count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0 || count < 12 || count > w * h * 0.7) return null;
  const sw = maxX - minX + 1, sh = maxY - minY + 1;
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) out[y * sw + x] = ink[(minY + y) * w + minX + x];
  return { w: sw, h: sh, ink: out };
}

export function shapeFromText(text: string, family: string): Shape | null {
  const size = 120;
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = `${size}px "${family}"`;
  const width = Math.ceil(probe.measureText(text).width) + 100;
  const height = Math.round(size * 2);
  const c = createCanvas(Math.min(width, 6000), height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.font = `${size}px "${family}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 50, size * 1.35);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4] < 140) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return null;
  const sw = maxX - minX + 1, sh = maxY - minY + 1;
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) out[y * sw + x] = d[((minY + y) * c.width + minX + x) * 4] < 140 ? 1 : 0;
  return { w: sw, h: sh, ink: out };
}

function toGrid(s: Shape): Float32Array {
  const g = new Float32Array(GRID_W * GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    const ya = Math.floor(gy * s.h / GRID_H), yb = Math.max(ya + 1, Math.floor((gy + 1) * s.h / GRID_H));
    for (let gx = 0; gx < GRID_W; gx++) {
      const xa = Math.floor(gx * s.w / GRID_W), xb = Math.max(xa + 1, Math.floor((gx + 1) * s.w / GRID_W));
      let sum = 0, n = 0;
      for (let y = ya; y < yb && y < s.h; y++) for (let x = xa; x < xb && x < s.w; x++) { sum += s.ink[y * s.w + x]; n++; }
      g[gy * GRID_W + gx] = n ? sum / n : 0;
    }
  }
  return blur(blur(g));
}

function blur(g: Float32Array): Float32Array {
  const tmp = new Float32Array(g.length), out = new Float32Array(g.length);
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    let a = 0, n = 0;
    for (let k = -1; k <= 1; k++) { const xx = x + k; if (xx >= 0 && xx < GRID_W) { a += g[y * GRID_W + xx]; n++; } }
    tmp[y * GRID_W + x] = a / n;
  }
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    let a = 0, n = 0;
    for (let k = -1; k <= 1; k++) { const yy = y + k; if (yy >= 0 && yy < GRID_H) { a += tmp[yy * GRID_W + x]; n++; } }
    out[y * GRID_W + x] = a / n;
  }
  return out;
}

export function similarity(sample: Shape, candidate: Shape, sampleGrid = toGrid(sample)): number {
  const b = toGrid(candidate);
  let inter = 0, union = 0;
  for (let i = 0; i < sampleGrid.length; i++) { inter += Math.min(sampleGrid[i], b[i]); union += Math.max(sampleGrid[i], b[i]); }
  if (!union) return 0;
  const ratio = (sample.w / sample.h) / (candidate.w / candidate.h);
  return (inter / union) * Math.exp(-2 * Math.abs(Math.log(ratio)));
}

export function shapePng(s: Shape, maxW = 480): Buffer {
  const k = Math.min(1, maxW / s.w);
  const w = Math.max(1, Math.round(s.w * k)), h = Math.max(1, Math.round(s.h * k));
  const pad = 8;
  const c = createCanvas(w + pad * 2, h + pad * 2);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sv = s.ink[Math.min(s.h - 1, Math.floor(y / k)) * s.w + Math.min(s.w - 1, Math.floor(x / k))];
    const o = ((y + pad) * c.width + x + pad) * 4;
    const v = Math.round(255 * (1 - sv));
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toBuffer('image/png');
}

export interface Candidate { id: string; family: string; category: string }
export interface FontMatch extends Candidate { score: number; bold: boolean }
export type FaceLoader = (id: string, bold: boolean) => Promise<{ bytes: Uint8Array; label: string } | null>;

let aliasCounter = 0;
export async function scoreFont(sample: Shape, grid: Float32Array, text: string, c: Candidate, load: FaceLoader): Promise<FontMatch | null> {
  let best: FontMatch | null = null;
  let regularLabel = '';
  for (const bold of [false, true]) {
    const face = await load(c.id, bold);
    if (!face || (bold && face.label === regularLabel)) continue;
    if (!bold) regularLabel = face.label;
    const alias = `idf_${++aliasCounter}`;
    const key = GlobalFonts.register(Buffer.from(face.bytes), alias);
    if (!key) continue;
    try {
      const shape = shapeFromText(text, alias);
      if (!shape) continue;
      const score = similarity(sample, shape, grid);
      if (!best || score > best.score + 0.01) best = { ...c, score, bold };
    } finally {
      try { (GlobalFonts as unknown as { remove?: (n: string) => boolean }).remove?.(alias); } catch {  }
    }
  }
  return best;
}

export async function rankFonts(sample: Shape, text: string, candidates: Candidate[], load: FaceLoader, opts: { deadlineMs?: number; concurrency?: number } = {}): Promise<{ matches: FontMatch[]; searched: number }> {
  const grid = toGrid(sample);
  const end = Date.now() + (opts.deadlineMs ?? 45_000);
  const matches: FontMatch[] = [];
  let next = 0, searched = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() > end) return;
      const i = next++;
      if (i >= candidates.length) return;
      const m = await scoreFont(sample, grid, text, candidates[i], load).catch(() => null);
      searched++;
      if (m) matches.push(m);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, worker));
  matches.sort((a, b) => b.score - a.score);
  return { matches, searched };
}
