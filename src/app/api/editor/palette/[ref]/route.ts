import { createCanvas, loadImage } from '@napi-rs/canvas';
import { rasterizePdf } from '@/lib/render/raster';
import { auth, backgroundByRef, builtinId, jsonError } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function dominantColours(data: ArrayLike<number>, max = 10, minShare = 0.002, mergeDistance = 28): { hex: string; share: number }[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  if (!total) return [];
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const picked: { key: number; count: number }[] = [];
  for (const [key, count] of sorted) {
    const r = key >> 16, g = (key >> 8) & 255, b = key & 255;
    const near = picked.find((p) => Math.hypot(r - (p.key >> 16), g - ((p.key >> 8) & 255), b - (p.key & 255)) <= mergeDistance);
    if (near) { near.count += count; continue; }
    if (picked.length < max * 3) picked.push({ key, count });
  }
  return picked
    .filter((p) => p.count / total >= minShare)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((p) => ({ hex: toHex(p.key >> 16, (p.key >> 8) & 255, p.key & 255), share: Math.round((p.count / total) * 10000) / 10000 }));
}

export async function GET(req: Request, props: { params: Promise<{ ref: string }> }) {
  try {
    const { ref: rawRef } = await props.params;
    const ref = decodeURIComponent(rawRef);
    let db = null as ReturnType<typeof auth>['db'] | null;
    let orgId = '';
    if (!builtinId(ref)) ({ db, org: { id: orgId } } = auth(req));
    const { bytes, type } = await backgroundByRef(db as never, orgId, ref);
    let data: ArrayLike<number>;
    if (type === 'pdf') {
      data = (await rasterizePdf(bytes, 1)).data;
    } else {
      const img = await loadImage(Buffer.from(bytes));
      const k = Math.min(1, 900 / img.width);
      const canvas = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    return Response.json({ colours: dominantColours(data) }, { headers: { 'cache-control': 'private, max-age=600' } });
  } catch (e) {
    return jsonError(e);
  }
}
