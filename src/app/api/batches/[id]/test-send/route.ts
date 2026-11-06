import { all, get, nowIso } from '@/lib/db/db';
import { getRecord, setSetting, type CertRow } from '@/lib/db/repo';
import { MailError } from '@/lib/contracts';
import { buildRunnerDeps, senderAddress } from '@/lib/pipeline/services';
import { isValidEmail, cleanEmail } from '@/lib/ingest/validate';
import { configFingerprint, ownBatch, testSentKey } from '../../../_batch';
import { badRequest, conflict, readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  let body: { to?: string } = {};
  try { body = await readJsonBody<{ to?: string }>(req); } catch { body = {}; }
  const to = cleanEmail(body.to) || org.email;
  if (!isValidEmail(to)) throw badRequest('Please enter a valid email address to send the test to.');

  const certs = all<CertRow & { row_number: number }>(db,
    `SELECT c.*, r.row_number FROM certificates c JOIN records r ON r.id = c.record_id
     WHERE c.batch_id = ? AND c.status <> 'SKIPPED' ORDER BY r.row_number, c.category_label`, batch.id);
  if (!certs.length) throw conflict('There is nothing to send yet. Go back to Preview so Facilify can prepare your certificates.');
  const deps = buildRunnerDeps(db, org.id, batch);
  const first = certs[0];
  const mine = deps.delivery === 'one-email' ? certs.filter((c) => c.person_key === first.person_key) : [first];
  const items = [];
  for (const c of mine) {
    const record = getRecord(db, c.record_id);
    if (!record) continue;
    const rendered = await deps.renderCert(c, record);
    items.push({ cert: { ...c, file_name: rendered.fileName, sha256: rendered.sha256 }, record, pdf: rendered.pdf });
  }
  if (!items.length) throw conflict('The first student could not be found. Prepare the batch again from the Preview step.');
  const mail = deps.compose(items, `<cf.test.${batch.id.replace(/[^A-Za-z0-9]/g, '')}.${Date.now()}@certflow.local>`);
  try {
    await deps.transport.send({ ...mail, to, subject: `${mail.subject} [TEST]` });
  } catch (e) {
    if (e instanceof MailError) throw conflict(`The test email could not be sent: ${e.message}`);
    throw e;
  }
  setSetting(db, org.id, testSentKey(batch.id), { fingerprint: configFingerprint(batch), at: nowIso(), to });
  const student = get<{ values_json: string }>(db, 'SELECT values_json FROM records WHERE id = ?', first.record_id);
  let studentName = '';
  try { studentName = (JSON.parse(student?.values_json ?? '{}') as Record<string, string>).NAME ?? ''; } catch { studentName = ''; }
  return {
    ok: true, to, transport: deps.transport.name, from: senderAddress(db, org.id, deps.transport), studentName,
    certificates: items.length,
    note: deps.transport.name === 'capture'
      ? 'Test outbox is on, so the email was saved as a file instead of being delivered.'
      : `Check the inbox of ${to}.`,
  };
});
