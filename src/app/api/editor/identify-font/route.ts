import { loadCatalog, ownLatinFace } from '@/lib/fonts/server';
import { rankFonts, shapeFromRegion, shapePng, templatePixels, type Box, type Candidate } from '@/lib/fonts/identify';
import { auth, backgroundByRef, BadRequest, jsonError, readJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN);

export async function POST(req: Request) {
  try {
    const { db, org } = auth(req);
    const body = await readJson<{ ref?: string; box?: Partial<Box>; text?: string; scope?: string; category?: string }>(req);
    const ref = String(body.ref ?? '').replace(/^custom:/, '').trim();
    const text = String(body.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) throw new BadRequest('Type the words you boxed, exactly as they appear on the template.');
    const box: Box = { x: num(body.box?.x), y: num(body.box?.y), w: num(body.box?.w), h: num(body.box?.h) };
    if ([box.x, box.y, box.w, box.h].some(Number.isNaN) || box.w < 0.01 || box.h < 0.005) throw new BadRequest('Draw a box around some text on the template first.');

    const { bytes, type } = await backgroundByRef(db, org.id, ref);
    const px = await templatePixels(bytes, type);
    const sample = shapeFromRegion(px, box);
    if (!sample) throw new BadRequest('I could not see any text inside that box. Draw it tighter around one line of text.');
    if (sample.w / sample.h < 1.2) throw new BadRequest('Box one line of text with at least a couple of letters in it.');

    const catalog = (await loadCatalog()).filter((f) => f.subsets.includes('latin') && (!body.category || f.category === body.category));
    const ranked = [...catalog].sort((a, b) => (Number(!!b.bundled) - Number(!!a.bundled)) || ((a.popularity ?? 1e6) - (b.popularity ?? 1e6)));
    const limit = body.scope === 'more' ? 600 : 160;
    const candidates: Candidate[] = ranked.slice(0, limit).map((f) => ({ id: f.id, family: f.family, category: f.category }));

    const { matches, searched } = await rankFonts(sample, text, candidates, async (id, bold) => {
      const face = await ownLatinFace(id, bold);
      return face && face.label.startsWith(`${id}/`) ? { bytes: face.bytes, label: face.label } : null;
    });
    return Response.json({
      matches: matches.slice(0, 12).map((m) => ({ id: m.id, family: m.family, category: m.category, bold: m.bold, score: Math.round(m.score * 100) })),
      searched, total: candidates.length, catalogSize: catalog.length,
      seen: `data:image/png;base64,${shapePng(sample).toString('base64')}`,
    });
  } catch (e) {
    return jsonError(e);
  }
}
