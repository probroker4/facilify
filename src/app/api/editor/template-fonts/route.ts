import { suggestFromPdfFontNames, type CatalogFont } from '@/lib/fonts/catalog';
import { loadCatalog } from '@/lib/fonts/server';
import { pdfFontNames } from '@/lib/render';
import { readUpload } from '@/lib/secrets/uploads';
import { auth, BadRequest, jsonError, readJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOOKALIKES: [RegExp, string][] = [
  [/^(times|timesnewroman|tinos)/i, 'tinos'], [/^(helvetica|arial|arimo)/i, 'arimo'], [/^(courier|couriernew)/i, 'cousine'],
  [/^georgia/i, 'gelasio'], [/^(garamond|adobegaramond)/i, 'eb-garamond'], [/^(calibri|carlito)/i, 'carlito'], [/^(cambria|caladea)/i, 'caladea'],
  [/^(palatino|bookantiqua)/i, 'lora'], [/^(verdana|tahoma|segoe)/i, 'open-sans'], [/^(trebuchet)/i, 'fira-sans'],
];

export async function POST(req: Request) {
  try {
    const { db, org } = auth(req);
    const { uploadId } = await readJson<{ uploadId?: string }>(req);
    const cleanId = (uploadId || '').replace(/^custom:/, '').trim();
    if (!/^up_[A-Za-z0-9_-]+$/.test(cleanId)) throw new BadRequest('Missing valid uploadId.');
    const up = readUpload(db, org.id, cleanId);
    const catalog = await loadCatalog();
    const names = new Set<string>();
    if (up.mime === 'application/pdf') {
      try { for (const n of await pdfFontNames(up.bytes)) names.add(n); } catch {  }
      try {
        const text = new TextDecoder('latin1').decode(up.bytes);
        for (const m of text.matchAll(/\/(?:BaseFont|FontName)\s*\/([A-Za-z0-9_\-+,]+)/g)) if (m[1]) names.add(m[1]);
      } catch {  }
    }
    const byId = new Map<string, CatalogFont>(catalog.map((f) => [f.id, f]));
    const suggestions = suggestFromPdfFontNames([...names], catalog).map((s) => {
      if (s.match) return s;
      const base = s.pdfName.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0];
      const hit = LOOKALIKES.find(([re]) => re.test(base));
      return hit ? { ...s, match: byId.get(hit[1]) ?? null } : s;
    });
    return Response.json({ suggestions, extractedCount: names.size });
  } catch (e) {
    return jsonError(e);
  }
}
