import { get } from '@/lib/db/db';
import { run } from '@/lib/db/db';
import { deleteSetting } from '@/lib/db/repo';
import { prepareBatch } from '@/lib/pipeline/prepare';
import { buildConfig, loadSheet } from '../../../_draft';
import { buildPlan } from '../../../_plan';
import { ownBatch, testSentKey } from '../../../_batch';
import { conflict, readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  const body = await readJsonBody<{ uploadId?: string; draft?: unknown }>(req);
  const uploadId = body.uploadId || batch.sheet_upload_id || undefined;
  const sent = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM certificates WHERE batch_id = ? AND status IN ('SENT','SENDING')", batch.id)?.n ?? 0;
  if (sent > 0) throw conflict('This batch has already sent certificates. Start a new batch for further changes.');

  buildPlan(db, org, { uploadId, draft: body.draft });
  const { config, draft } = buildConfig(db, org, body.draft);
  const sheet = loadSheet(db, org, uploadId, draft.skipRows);
  const result = prepareBatch(db, org.id, batch.id, sheet, config);
  run(db, 'UPDATE batches SET sheet_upload_id = ? WHERE id = ?', uploadId ?? null, batch.id);
  deleteSetting(db, org.id, testSentKey(batch.id));
  return {
    ok: true,
    batchId: batch.id,
    certificates: result.certificates,
    people: result.people,
    emails: config.scheme.delivery === 'one-email' ? result.people : result.certificates,
    validRows: result.validation.valid.length,
    invalidRows: result.validation.invalid.length,
    unmatchedValues: result.unmatchedValues,
    routingIssues: result.routingIssues,
    alreadySent: result.alreadySent,
    skippedAlreadySent: config.resendAlreadySent ? 0 : result.alreadySent.length,
  };
});
