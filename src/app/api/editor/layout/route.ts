import { layoutTemplate, uniformSizeCaps } from '@/lib/render';
import { auth, checkTemplate, fonts, previewValues, jsonError, readJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    auth(req);
    const body = await readJson<{ template: unknown; values?: unknown; rows?: unknown[] }>(req);
    const template = checkTemplate(body.template);
    let caps: Record<string, number> | undefined;
    if (template.layers.some((l) => l.style.fit?.uniformAcrossBatch) && Array.isArray(body.rows) && body.rows.length) {
      caps = await uniformSizeCaps(template, body.rows.slice(0, 2000).map(previewValues), fonts());
    }
    const placements = await layoutTemplate(template, previewValues(body.values), fonts(), caps);
    return Response.json({ placements });
  } catch (e) {
    return jsonError(e);
  }
}
