import { get } from '@/lib/db/db';
import { isRunning, releaseQuotaHold, runBatch } from '@/lib/pipeline/runner';
import { buildRunnerDeps } from '@/lib/pipeline/services';
import { ownBatch } from '../../../_batch';
import { conflict, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  if (isRunning(batch.id)) throw conflict('This batch is still running.');
  const count = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM certificates WHERE batch_id = ? AND held_reason = 'daily-limit'", batch.id)?.n ?? 0;
  releaseQuotaHold(db, batch.id);
  runBatch(batch.id, buildRunnerDeps(db, org.id, batch)).catch((e) => console.error(`[batch ${batch.id}] continue failed`, e));
  return { ok: true, count };
});
