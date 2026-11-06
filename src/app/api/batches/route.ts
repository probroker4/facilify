import { all, nowIso, run } from '@/lib/db/db';
import { listBatches, statusCounts } from '@/lib/db/repo';
import { randomId } from '@/lib/secrets/crypto';
import { isRunning } from '@/lib/pipeline/runner';
import { plainText, readJsonBody, withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ db, org }) => {
  const peopleByBatch = new Map(all<{ batch_id: string; n: number }>(db,
    'SELECT batch_id, COUNT(DISTINCT person_key) AS n FROM certificates WHERE organizer_id = ? GROUP BY batch_id', org.id).map((r) => [r.batch_id, r.n]));
  const batches = listBatches(db, org.id).map((b) => {
    const counts = statusCounts(db, b.id);
    const total = Object.values(counts).reduce((a, n) => a + n, 0);
    return {
      id: b.id, name: b.name, status: b.status, message: b.message, created_at: b.created_at, updated_at: b.updated_at,
      counts, total, people: peopleByBatch.get(b.id) ?? 0, running: isRunning(b.id),
    };
  });
  return { batches };
});

export const POST = withApi(async ({ req, db, org }) => {
  const body = await readJsonBody<{ name?: string }>(req);
  const id = randomId('batch');
  const name = plainText(body.name, 100) || 'New batch';
  const at = nowIso();
  run(db, "INSERT INTO batches (id, organizer_id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', '{}', ?, ?)", id, org.id, name, at, at);
  return { ok: true, id, name };
});
