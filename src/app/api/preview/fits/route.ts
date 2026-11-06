import type { FitResult } from '@/lib/contracts';
import { layoutTemplate, uniformSizeCaps } from '@/lib/render';
import { fonts } from '@/lib/pipeline/services';
import { buildPlan, categoryLabel } from '../../_plan';
import { readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

const MAX_CHECKED = 3000;
const MAX_LISTED = 300;

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; draft?: unknown; templateId?: string }>(req);
  const plan = buildPlan(db, org, body);
  const provider = fonts();
  const items: { rowNumber: number; name: string; award: string; templateId: string; layerId: string; text: string; fit: FitResult }[] = [];
  const caps = new Map<string, Record<string, number>>();
  let checked = 0;
  let changed = 0;
  for (const a of plan.routed.assignments) {
    if (body.templateId && a.templateId !== body.templateId) continue;
    if (checked >= MAX_CHECKED) break;
    checked++;
    const rec = plan.records.get(a.recordId)!;
    const template = plan.config.templates[a.templateId];
    if (!caps.has(a.templateId)) {
      const all = plan.routed.assignments.filter((x) => x.templateId === a.templateId).map((x) => {
        const r = plan.records.get(x.recordId)!;
        const { label } = categoryLabel(plan.config, x.categoryId, r);
        return { ...r.values, CERTIFICATE_TYPE: label, CATEGORY: label };
      });
      caps.set(a.templateId, await uniformSizeCaps(template, all, provider));
    }
    const { label } = categoryLabel(plan.config, a.categoryId, rec);
    const placements = await layoutTemplate(template, { ...rec.values, CERTIFICATE_TYPE: label, CATEGORY: label }, provider, caps.get(a.templateId));
    let hit = false;
    for (const p of placements) {
      if (!(p.fit.shrunk || p.fit.wrapped || p.fit.abbreviated || p.fit.overflow)) continue;
      hit = true;
      if (items.length < MAX_LISTED) items.push({ rowNumber: rec.rowNumber, name: rec.values.NAME ?? '', award: label, templateId: a.templateId, layerId: p.layerId, text: p.text, fit: p.fit });
    }
    if (hit) changed++;
  }
  return { items, checked, changed, truncated: changed > items.length };
});
