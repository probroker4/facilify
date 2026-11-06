import { get } from '@/lib/db/db';
import { isRunning, runBatch } from '@/lib/pipeline/runner';
import { buildRunnerDeps } from '@/lib/pipeline/services';
import { ownBatch, readTestSent } from '../../../_batch';
import { conflict, readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  const body = await readJsonBody<{ confirm?: boolean }>(req);
  if (body.confirm !== true) throw conflict('Please confirm before sending. Nothing was sent.');
  if (isRunning(batch.id)) throw conflict('This batch is already running. Open the dashboard to watch it.');
  const open = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM certificates WHERE batch_id = ? AND status IN ('PENDING','GENERATED','SAVED')", batch.id)?.n ?? 0;
  if (!open) throw conflict('There is nothing left to send in this batch.');
  if (!readTestSent(db, org, batch)) {
    throw conflict('Send a test email to yourself first, then start. (If you changed anything after the last test, send a fresh test.)');
  }
  const deps = buildRunnerDeps(db, org.id, batch);
  runBatch(batch.id, deps).catch((e) => console.error(`[batch ${batch.id}] run failed`, e));
  return { ok: true, batchId: batch.id, certificates: open };
});
