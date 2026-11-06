import type { AwardCategory, ParsedSheet, StudentRecord, ValidationResult } from '@/lib/contracts';
import type { DB } from '@/lib/db/db';
import type { OrganizerRow } from '@/lib/db/repo';
import { validateSheet } from '@/lib/ingest/validate';
import type { BatchConfig } from '@/lib/pipeline/config';
import { assignCertificates, DEFAULT_CATEGORY_ID, resolveCategory, type AssignResult } from '@/lib/routing/assign';
import { buildConfig, loadSheet, type DraftConfig } from './_draft';
import { badRequest } from './_shared';

export interface Plan {
  config: BatchConfig;
  draft: DraftConfig;
  sheet: ParsedSheet;
  validation: ValidationResult;
  routed: AssignResult;
  records: Map<string, StudentRecord>;
}

export function buildPlan(db: DB, org: OrganizerRow, body: { uploadId?: unknown; draft?: unknown }): Plan {
  const { config, draft } = buildConfig(db, org, body.draft);
  const sheet = loadSheet(db, org, body.uploadId, draft.skipRows);
  const validation = validateSheet(sheet, {
    batchId: 'preview', mapping: config.mapping, email: config.email, required: config.required, awardColumns: config.scheme.awardColumns,
  });
  if (!validation.valid.length) throw badRequest('There are no valid students yet. Go back to the Fix step and correct the rows marked in red.');
  const routed = assignCertificates(validation.valid, config.scheme);
  return { config, draft, sheet, validation, routed, records: new Map(validation.valid.map((r) => [r.recordId, r])) };
}

export function categoryLabel(config: BatchConfig, categoryId: string, rec: StudentRecord): { cat: AwardCategory | undefined; label: string } {
  if (categoryId === DEFAULT_CATEGORY_ID) return { cat: resolveCategory(config.scheme, categoryId), label: rec.values.CERTIFICATE_TYPE || 'Certificate' };
  const cat = resolveCategory(config.scheme, categoryId);
  return { cat, label: cat?.label ?? 'Certificate' };
}
