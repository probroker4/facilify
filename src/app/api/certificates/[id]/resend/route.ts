import { getBatch, getCert } from '@/lib/db/repo';
import { isRunning, requestResend, runBatch } from '@/lib/pipeline/runner';
import { buildRunnerDeps } from '@/lib/pipeline/services';
import { badRequest, conflict, notFound, plainText, readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const cert = getCert(db, params.id);
  const batch = cert && cert.organizer_id === org.id ? getBatch(db, org.id, cert.batch_id) : undefined;
  if (!cert || !batch) throw notFound('That certificate was not found.');
  const body = await readJsonBody<{ reason?: string }>(req);
  const reason = plainText(body.reason, 300);
  if (reason.length < 3) throw badRequest('Please say why you are sending this again (for example "student lost the email").');
  if (cert.status !== 'SENT') throw conflict('Only certificates that were already sent can be sent again. Use Retry for failed ones.');
  if (isRunning(batch.id)) throw conflict('This batch is still running. Try again in a moment.');
  requestResend(db, cert.id, reason);
  runBatch(batch.id, buildRunnerDeps(db, org.id, batch), { only: [cert.id] }).catch((e) => console.error(`[batch ${batch.id}] resend failed`, e));
  return { ok: true };
});
