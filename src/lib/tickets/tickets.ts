import type { FieldMapping, MailTransport, Ticket } from '@/lib/contracts';
import { all, get, nowIso, run, tx, type DB } from '@/lib/db/db';
import { getBatch, type BatchRow, type CertRow, type RecordRow, type TicketRow } from '@/lib/db/repo';
import { readCertToken, randomId } from '@/lib/secrets/crypto';
import { escapeHtml } from '@/lib/text';
import { htmlToText } from '@/lib/mail/compose';
import type { BatchConfig } from '@/lib/pipeline/config';
import { requestReissue, runBatch, type RunnerDeps } from '@/lib/pipeline/runner';
import { buildRunnerDeps, buildTransport, orgSettings, senderAddress, verifyUrlFor } from '@/lib/pipeline/services';

export class TicketError extends Error {
  constructor(msg: string, public status = 400) { super(msg); this.name = 'TicketError'; }
}

const CATEGORIES: Ticket['category'][] = ['name', 'event', 'achievement', 'date', 'other'];
export const CATEGORY_FIELD: Record<Ticket['category'], string | null> = { name: 'NAME', event: 'EVENT', achievement: 'ACHIEVEMENT', date: 'DATE', other: null };
export const CATEGORY_LABEL: Record<Ticket['category'], string> = { name: 'Name', event: 'Event', achievement: 'Achievement', date: 'Date', other: 'Other detail' };
const STATUSES = ['OPEN', 'RESOLVED', 'REJECTED'] as const;
const RESERVED_FIELDS = new Set(['VERIFY_CODE', 'CATEGORY', 'CERTIFICATE_TYPE', 'EMAIL_SELECTED']);

export const RATE_LIMIT = 5;
const WINDOW_MS = 3600_000;
const recent = new Map<string, number[]>();
function rateLimited(clientKey: string, now = Date.now()): boolean {
  if (recent.size > 10_000) for (const [k, v] of recent) if (!v.some((t) => now - t < WINDOW_MS)) recent.delete(k);
  const list = (recent.get(clientKey) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= RATE_LIMIT) { recent.set(clientKey, list); return true; }
  list.push(now);
  recent.set(clientKey, list);
  return false;
}
export function resetRateLimits() { recent.clear(); }

export function certFromToken(db: DB, token: string): { cert: CertRow; record: RecordRow } {
  const certId = typeof token === 'string' && token.length < 300 ? readCertToken(token) : null;
  if (!certId) throw new TicketError('This link is not valid. Please use the link from your certificate email.', 404);
  const cert = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', certId);
  const record = cert ? get<RecordRow>(db, 'SELECT * FROM records WHERE id = ?', cert.record_id) : undefined;
  if (!cert || !record) throw new TicketError('This certificate no longer exists.', 404);
  return { cert, record };
}

export interface NewTicket { category: string; suggested?: string; note?: string }

export function createTicket(db: DB, token: string, input: NewTicket, clientKey: string): { id: string } {
  const { cert } = certFromToken(db, token);
  const category = input.category as Ticket['category'];
  if (!CATEGORIES.includes(category)) throw new TicketError('Please choose what is wrong.');
  const suggested = String(input.suggested ?? '').trim().slice(0, 300);
  const note = String(input.note ?? '').trim().slice(0, 2000);
  if (!suggested && !note) throw new TicketError('Please type the correct value or a short note.');
  const open = get<{ id: string }>(db, "SELECT id FROM tickets WHERE cert_id = ? AND status = 'OPEN'", cert.id);
  if (open) throw new TicketError('You already reported a problem with this certificate. The organizers will get back to you.', 409);
  if (rateLimited(clientKey || 'unknown')) throw new TicketError('Too many reports. Please try again in an hour.', 429);
  const id = randomId('tkt');
  run(db, `INSERT INTO tickets (id, cert_id, batch_id, organizer_id, category, field, suggested, note, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`, id, cert.id, cert.batch_id, cert.organizer_id, category, CATEGORY_FIELD[category], suggested || null, note || null, nowIso());
  return { id };
}

export interface TicketView extends TicketRow {
  name: string;
  email: string;
  award: string;
  verify_code: string;
  web_link: string | null;
  pdf_url: string;
  cert_status: string | null;
  batch_name: string;
  current: string | null;
  values: Record<string, string>;
  purged: boolean;
}

export function listTickets(db: DB, organizerId: string, status?: string): TicketView[] {
  if (status && !(STATUSES as readonly string[]).includes(status)) throw new TicketError('Unknown ticket status.');
  const rows = all<TicketRow & { values_json: string | null; email: string | null; category_label: string | null; verify_code: string | null; web_link: string | null; cert_status: string | null; batch_name: string | null }>(db,
    `SELECT t.*, r.values_json, r.email, c.category_label, c.verify_code, c.web_link, c.status AS cert_status, b.name AS batch_name
     FROM tickets t LEFT JOIN certificates c ON c.id = t.cert_id AND c.organizer_id = t.organizer_id
     LEFT JOIN records r ON r.id = c.record_id LEFT JOIN batches b ON b.id = t.batch_id AND b.organizer_id = t.organizer_id
     WHERE t.organizer_id = ? ${status ? 'AND t.status = ?' : ''} ORDER BY CASE t.status WHEN 'OPEN' THEN 0 ELSE 1 END, t.created_at DESC`,
    ...(status ? [organizerId, status] : [organizerId]));
  return rows.map(({ values_json, category_label, email, verify_code, batch_name, ...t }) => {
    const values = values_json ? (JSON.parse(values_json) as Record<string, string>) : {};
    return {
      ...t, values, email: email ?? '', verify_code: verify_code ?? '', batch_name: batch_name ?? '',
      name: values.NAME ?? '', award: category_label ?? '', current: t.field ? values[t.field] ?? null : null,
      pdf_url: `/api/certificates/${encodeURIComponent(t.cert_id)}/pdf`,
      purged: !values_json || !batch_name,
    };
  });
}

export function openTicketCount(db: DB, organizerId: string): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) n FROM tickets WHERE organizer_id = ? AND status = 'OPEN'", organizerId)!.n;
}

export function getTicket(db: DB, organizerId: string, id: string): TicketRow {
  const t = get<TicketRow>(db, 'SELECT * FROM tickets WHERE id = ? AND organizer_id = ?', id, organizerId);
  if (!t) throw new TicketError('Ticket not found.', 404);
  return t;
}

export function applyCorrection(db: DB, ticket: TicketRow, field: string, value: string, mapping: { placeholder: string; column: string }[]) {
  const cert = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', ticket.cert_id);
  const record = cert ? get<RecordRow>(db, 'SELECT * FROM records WHERE id = ?', cert.record_id) : undefined;
  if (!cert || !record) throw new TicketError('The certificate data for this ticket was deleted, so it cannot be corrected.', 410);
  const values = JSON.parse(record.values_json) as Record<string, string>;
  values[field] = value;
  const col = mapping.find((m) => m.placeholder === field)?.column;
  if (col) values[col] = value;
  run(db, 'UPDATE records SET values_json = ? WHERE id = ?', JSON.stringify(values), record.id);
}

export function closeTicket(db: DB, ticketId: string, status: 'RESOLVED' | 'REJECTED', note: string) {
  run(db, 'UPDATE tickets SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ?', status, note, nowIso(), ticketId);
}

export async function notifyStudent(transport: MailTransport, input: { to: string; personKey: string; from?: string; name: string; organizationName: string; message: string; messageId: string; subject?: string }) {
  const html = `<!doctype html><html><body style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#111827">
<p>Dear ${escapeHtml(input.name)},</p><p>Thank you for letting us know about your certificate.</p><p>${escapeHtml(input.message)}</p>
<p>Best wishes,<br>${escapeHtml(input.organizationName)}</p></body></html>`;
  await transport.send({ personKey: input.personKey, to: input.to, from: input.from, subject: input.subject ?? 'About your certificate report', html, text: htmlToText(html), attachments: [], messageId: input.messageId });
}

interface TicketContext { ticket: TicketRow; cert: CertRow; record: RecordRow; batch: BatchRow; config: BatchConfig }

function openTicketContext(db: DB, organizerId: string, ticketId: string): { ticket: TicketRow; cert?: CertRow; record?: RecordRow; batch?: BatchRow; config?: BatchConfig } {
  const ticket = getTicket(db, organizerId, ticketId);
  if (ticket.status !== 'OPEN') throw new TicketError(`This ticket is already ${ticket.status.toLowerCase()}.`, 409);
  const cert = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ? AND organizer_id = ?', ticket.cert_id, organizerId);
  const record = cert ? get<RecordRow>(db, 'SELECT * FROM records WHERE id = ?', cert.record_id) : undefined;
  const batch = cert ? getBatch(db, organizerId, cert.batch_id) : undefined;
  let config: BatchConfig | undefined;
  try {
    const c = batch ? (JSON.parse(batch.config_json) as Partial<BatchConfig>) : undefined;
    if (c && c.templates && c.scheme && Array.isArray(c.mapping)) config = c as BatchConfig;
  } catch { config = undefined; }
  return { ticket, cert, record, batch, config };
}

function requireLive(ctx: ReturnType<typeof openTicketContext>): TicketContext {
  const { ticket, cert, record, batch, config } = ctx;
  if (!cert || !record || !batch || !config || !config.templates[cert.template_id]) {
    throw new TicketError('This certificate\'s batch was deleted, so it cannot be reissued. Decline the ticket instead, or send a new batch.', 410);
  }
  return { ticket, cert, record, batch, config };
}

export interface ResolveInput { field?: string; value: string; note?: string }
export interface ResolveResult { ok: true; ticketId: string; certId: string; certStatus: string; sha256: string | null }

export async function resolveTicket(
  db: DB, organizerId: string, ticketId: string, input: ResolveInput,
  opts: { depsOverrides?: Partial<RunnerDeps> } = {},
): Promise<ResolveResult> {
  const ctx = requireLive(openTicketContext(db, organizerId, ticketId));
  const { ticket, cert, batch, config } = ctx;
  const field = String(input.field ?? ticket.field ?? '').trim().toUpperCase();
  const value = String(input.value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
  const note = String(input.note ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
  if (!field || !/^[A-Z0-9_]{1,64}$/.test(field)) throw new TicketError('Choose which detail to correct.');
  if (RESERVED_FIELDS.has(field)) throw new TicketError(`${field} is set by the app and cannot be corrected here.`);
  if (!value) throw new TicketError('Type the correct value.');
  if (cert.status === 'SENDING') throw new TicketError('This certificate is being sent right now. Try again in a moment.', 409);
  if (cert.status === 'SKIPPED') throw new TicketError('This certificate was skipped in its batch, so there is nothing to reissue.', 409);

  const label = CATEGORY_LABEL[(ticket.category as Ticket['category'])] ?? 'Detail';
  const studentNote = note || `Your ${field === 'NAME' ? 'name' : label.toLowerCase()} has been corrected.`;
  const deps = buildRunnerDeps(db, organizerId, batch, opts.depsOverrides ?? {});

  tx(db, () => {
    applyCorrection(db, ticket, field, value, config.mapping as FieldMapping[]);
    requestReissue(db, cert.id, `Ticket ${ticket.id}: ${note || `${field} corrected`}`);
  });

  await runBatch(batch.id, deps, { only: [cert.id], corrected: { note: studentNote } });
  const after = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', cert.id)!;
  if (after.status !== 'SENT') {
    throw new TicketError(`The data was corrected, but the corrected certificate could not be sent: ${after.error ?? after.status}. Use Retry on the batch; the ticket stays open.`, 502);
  }
  closeTicket(db, ticket.id, 'RESOLVED', note || `${field} corrected to "${value}" and the certificate was reissued.`);
  return { ok: true, ticketId: ticket.id, certId: cert.id, certStatus: after.status, sha256: after.sha256 };
}

export async function rejectTicket(db: DB, organizerId: string, ticketId: string, note: string, opts: { transport?: MailTransport } = {}): Promise<{ ok: true; notified: boolean }> {
  const { ticket, cert, record, batch, config } = openTicketContext(db, organizerId, ticketId);
  const message = String(note ?? '').trim().slice(0, 2000) || 'We checked your report and the certificate details are correct as issued.';
  let notified = false;
  if (cert && record) {
    const transport = opts.transport ?? buildTransport(db, organizerId);
    const values = JSON.parse(record.values_json) as Record<string, string>;
    const org = orgSettings(db, organizerId);
    await notifyStudent(transport, {
      to: record.email, personKey: record.person_key, from: senderAddress(db, organizerId, transport),
      name: values.NAME ?? '', organizationName: config?.organizationName || org.name || batch?.name || 'The organizers',
      message, messageId: `<cf.ticket.${ticket.id.replace(/[^A-Za-z0-9_-]/g, '')}@certflow.local>`,
    });
    notified = true;
  }
  closeTicket(db, ticket.id, 'REJECTED', message);
  return { ok: true, notified };
}

export interface PublicCertInfo {
  name: string;
  event: string;
  award: string;
  date: string;
  verifyCode: string;
  verifyUrl: string;
  organizationName: string;
  revoked: boolean;
  openTicket: boolean;
}

export function publicCertInfo(db: DB, token: string): PublicCertInfo {
  const { cert, record } = certFromToken(db, token);
  const values = JSON.parse(record.values_json) as Record<string, string>;
  const batch = get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', cert.batch_id);
  let orgName = '';
  try { orgName = batch ? (JSON.parse(batch.config_json) as Partial<BatchConfig>).organizationName ?? '' : ''; } catch { orgName = ''; }
  const open = get<{ id: string }>(db, "SELECT id FROM tickets WHERE cert_id = ? AND status = 'OPEN'", cert.id);
  return {
    name: values.NAME ?? '', event: values.EVENT ?? '', award: cert.category_label, date: values.DATE ?? '',
    verifyCode: cert.verify_code, verifyUrl: verifyUrlFor(cert.verify_code),
    organizationName: orgName || orgSettings(db, cert.organizer_id).name,
    revoked: !!cert.revoked, openTicket: !!open,
  };
}

export const reissueAfterCorrection = resolveTicket;

