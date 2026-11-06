import { BUNDLED_FONTS, searchFonts, type CatalogFont } from '@/lib/fonts/catalog';
import { catalogSource, loadCatalog } from '@/lib/fonts/server';
import { normKey } from '@/lib/text';
import { editDistance } from '../_fonts';
import { auth, jsonError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POPULAR_FIRST = ['cinzel', 'great-vibes', 'playfair-display', 'cormorant-garamond', 'pinyon-script', 'alex-brush', 'dancing-script', 'montserrat', 'lora', 'eb-garamond', 'libre-baskerville', 'parisienne', 'sacramento', 'merriweather', 'raleway', 'poppins', 'lato', 'open-sans', 'roboto', 'noto-serif', 'noto-sans'];

export async function GET(req: Request) {
  try {
    auth(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') ?? '').slice(0, 80);
    const category = (url.searchParams.get('category') ?? '').toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
    const catalog = await loadCatalog();
    const source = await catalogSource();
    const base = { total: catalog.length, source };

    const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (ids.length) {
      const byId = new Map(catalog.map((f) => [f.id, f]));
      return Response.json({ ...base, fonts: ids.map((i) => byId.get(i)).filter((f): f is CatalogFont => !!f) });
    }

    const pool = category ? catalog.filter((f) => f.category === category) : catalog;
    if (!q.trim()) {
      const byId = new Map(pool.map((f) => [f.id, f]));
      const popular = POPULAR_FIRST.map((i) => byId.get(i)).filter((f): f is CatalogFont => !!f);
      const rest = pool.filter((f) => !POPULAR_FIRST.includes(f.id));
      return Response.json({ ...base, fonts: [...popular, ...(category ? rest : [])].slice(0, limit), bundledCount: BUNDLED_FONTS.length });
    }
    let fonts = searchFonts(q, pool, limit);
    let fuzzy = false;
    if (!fonts.length) {
      const key = normKey(q);
      fonts = pool
        .map((f) => ({ f, d: editDistance(key, normKey(f.family).slice(0, key.length + 2)) }))
        .filter((x) => x.d <= Math.max(1, Math.floor(key.length / 4)))
        .sort((a, b) => a.d - b.d)
        .slice(0, limit)
        .map((x) => x.f);
      fuzzy = fonts.length > 0;
    }
    return Response.json({ ...base, fonts, fuzzy });
  } catch (e) {
    return jsonError(e);
  }
}
