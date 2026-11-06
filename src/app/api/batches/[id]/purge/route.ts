import { purgeBatch } from '@/lib/secrets/purge';
import { ownBatch } from '../../../_batch';
import { conflict, readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  const body = await readJsonBody<{ confirm?: boolean }>(req);
  if (body.confirm !== true) throw conflict('Please confirm. Nothing was removed.');
  const result = purgeBatch(db, org.id, batch.id);
  return { ok: true, count: result.certificates, people: result.records, tickets: result.tickets, uploads: result.uploads, failures: result.failures };
});
