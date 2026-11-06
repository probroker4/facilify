import { isRunning, requestRetry, runBatch } from '@/lib/pipeline/runner';
import { buildRunnerDeps } from '@/lib/pipeline/services';
import { ownBatch } from '../../../_batch';
import { conflict, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  if (isRunning(batch.id)) throw conflict('This batch is still running. Wait for it to finish, then retry the failed ones.');
  const count = requestRetry(db, batch.id);
  if (count > 0) runBatch(batch.id, buildRunnerDeps(db, org.id, batch)).catch((e) => console.error(`[batch ${batch.id}] retry failed`, e));
  return { ok: true, count };
});
