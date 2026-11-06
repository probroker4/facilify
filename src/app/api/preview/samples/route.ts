import { DEFAULT_CATEGORY_ID } from '@/lib/routing/assign';
import { buildPlan, categoryLabel } from '../../_plan';
import { readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ uploadId?: string; draft?: unknown }>(req);
  const plan = buildPlan(db, org, body);
  const order = [...plan.config.scheme.categories].sort((a, b) => a.priority - b.priority).map((c) => c.id);
  const groups = new Map<string, { categoryId: string; templateId: string; label: string; count: number; sample: { index: number; rowNumber: number; name: string; email: string; values: Record<string, string> } }>();
  plan.routed.assignments.forEach((a, index) => {
    const rec = plan.records.get(a.recordId)!;
    const { label } = categoryLabel(plan.config, a.categoryId, rec);
    const key = a.categoryId === DEFAULT_CATEGORY_ID ? `${a.categoryId}:${label}` : a.categoryId;
    const g = groups.get(key);
    if (g) { g.count++; return; }
    groups.set(key, { categoryId: a.categoryId, templateId: a.templateId, label, count: 1, sample: { index, rowNumber: rec.rowNumber, name: rec.values.NAME ?? '', email: rec.email, values: rec.values } });
  });
  const categories = [...groups.values()].sort((a, b) => {
    const ia = order.indexOf(a.categoryId), ib = order.indexOf(b.categoryId);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const people = new Set(plan.routed.assignments.map((a) => a.personKey)).size;
  const certificates = plan.routed.assignments.length;
  return {
    categories,
    people,
    certificates,
    emails: plan.config.scheme.delivery === 'one-email' ? people : certificates,
    delivery: plan.config.scheme.delivery,
    unmatchedValues: plan.routed.unmatchedValues,
    routingIssues: plan.routed.issues,
    rowsChecked: plan.sheet.rows.length,
    rowsInvalid: plan.validation.invalid.length,
  };
});
