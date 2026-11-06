import type { Issue, ParsedSheet, ValidationResult } from '@/lib/contracts';
import { all, get, nowIso, run, tx, type DB } from '@/lib/db/db';
import { validateSheet } from '@/lib/ingest/validate';
import { assignCertificates, categoryById, DEFAULT_CATEGORY_ID } from '@/lib/routing/assign';
import { canonicalAward } from '@/lib/routing/discover';
import { certFileName, uniqueFileNames } from '@/lib/render/naming';
import { verifyCodeFor } from '@/lib/secrets/crypto';
import type { BatchConfig } from './config';
import { isRunning } from './runner';

export interface PrepareResult {
  validation: ValidationResult;
  routingIssues: Issue[];
  unmatchedValues: string[];
  certificates: number;
  people: number;
  alreadySent: { certId: string; personKey: string; category: string; previousBatchId: string }[];
}

export function dupKeyFor(personKey: string, event: string, categoryLabel: string): string {
  return `${personKey}#${event.trim().toLowerCase()}#${canonicalAward(categoryLabel)}`;
}

export function prepareBatch(db: DB, organizerId: string, batchId: string, sheet: ParsedSheet, config: BatchConfig): PrepareResult {
  const owner = get<{ organizer_id: string }>(db, 'SELECT organizer_id FROM batches WHERE id = ?', batchId);
  if (!owner || owner.organizer_id !== organizerId) throw new Error('Batch not found.');
  if (isRunning(batchId)) throw new Error('This batch is running right now. Wait for it to finish before preparing it again.');
  const resend = config.resendAlreadySent;
  if (resend && !String(resend.reason ?? '').trim()) {
    throw new Error('Sending again to people who already received this certificate needs a reason. Type why (it is saved in the history).');
  }
  const resendReason = resend ? resend.reason.trim() : '';
  const validation = validateSheet(sheet, { batchId, mapping: config.mapping, email: config.email, required: config.required, awardColumns: config.scheme.awardColumns });
  const routed = assignCertificates(validation.valid, config.scheme);
  const recordById = new Map(validation.valid.map((r) => [r.recordId, r]));
  const alreadySent: PrepareResult['alreadySent'] = [];
  const labelOf = (a: (typeof routed.assignments)[number]) => {
    const rec = recordById.get(a.recordId)!;
    return a.categoryId === DEFAULT_CATEGORY_ID ? rec.values.CERTIFICATE_TYPE || 'Certificate' : categoryById(config.scheme, a.categoryId)!.label;
  };
  const fileNames = uniqueFileNames(routed.assignments.map((a) => {
    const v = recordById.get(a.recordId)!.values;
    return certFileName({ event: v.EVENT, id: v.ID, name: v.NAME, category: labelOf(a) });
  }));

  tx(db, () => {
    const sent = all<{ n: number }>(db, "SELECT COUNT(*) n FROM certificates WHERE batch_id = ? AND status IN ('SENT','SENDING')", batchId)[0].n;
    if (sent > 0) throw new Error('This batch has already sent certificates. Create a new batch instead of re-preparing it.');
    run(db, 'DELETE FROM certificates WHERE batch_id = ?', batchId);
    run(db, 'DELETE FROM records WHERE batch_id = ?', batchId);
    const at = nowIso();
    for (const r of validation.valid) {
      run(db, 'INSERT INTO records (id, batch_id, row_number, person_key, email, email_source, values_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        r.recordId, batchId, r.rowNumber, r.personKey, r.email, r.emailSource, JSON.stringify(r.values));
    }
    routed.assignments.forEach((a, idx) => {
      const rec = recordById.get(a.recordId)!;
      const cat = { label: labelOf(a) };
      const dupKey = dupKeyFor(a.personKey, rec.values.EVENT ?? '', cat.label);
      const prev = all<{ id: string; batch_id: string }>(db,
        "SELECT id, batch_id FROM certificates WHERE organizer_id = ? AND dup_key = ? AND status = 'SENT' AND batch_id <> ? LIMIT 1",
        organizerId, dupKey, batchId)[0]
        ?? all<{ id: string; batch_id: string; dup_key: string }>(db,
          `SELECT c.id, c.batch_id, c.dup_key FROM certificates c JOIN records r ON r.id = c.record_id
           WHERE c.organizer_id = ? AND c.status = 'SENT' AND c.batch_id <> ? AND r.email = ? COLLATE NOCASE`,
          organizerId, batchId, rec.email).find((x) => x.dup_key.endsWith(dupKeyFor('', rec.values.EVENT ?? '', cat.label)));
      const skip = !!prev && !resendReason;
      if (prev) alreadySent.push({ certId: a.certId, personKey: a.personKey, category: cat.label, previousBatchId: prev.batch_id });
      run(db, `INSERT INTO certificates (id, batch_id, organizer_id, record_id, person_key, category_id, category_label, template_id, dup_key,
        file_name, verify_code, status, held_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.certId, batchId, organizerId, a.recordId, a.personKey, a.categoryId, cat.label, a.templateId, dupKey,
      fileNames[idx], verifyCodeFor(a.certId), skip ? 'SKIPPED' : 'PENDING', skip ? `already-sent:${prev!.batch_id}` : null, at, at);
      run(db, 'INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, ?, ?, ?, ?, ?)',
        a.certId, batchId, null, skip ? 'SKIPPED' : 'PENDING',
        skip ? `Already received in batch ${prev!.batch_id}` : prev ? `Resend approved: ${resendReason}` : 'Created', at);
    });
    run(db, "UPDATE batches SET status = 'READY', config_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(config), at, batchId);
  });

  return {
    validation, routingIssues: routed.issues, unmatchedValues: routed.unmatchedValues, certificates: routed.assignments.length,
    people: new Set(routed.assignments.map((a) => a.personKey)).size, alreadySent,
  };
}
