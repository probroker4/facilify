import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CertStorage, MailTransport, OutboundMail, RecordStatus, RenderedCert } from '@/lib/contracts';
import { MailError, MappingError, StorageError } from '@/lib/contracts';
import { all, get, nowIso, tx, type DB } from '@/lib/db/db';
import {
  acquireBatchLock, markQuotaExhausted, releaseBatchLock, releaseSend, reserveSend, setBatchStatus, statusCounts, touchBatchLock,
  type CertRow, type RecordRow,
} from '@/lib/db/repo';
import { sha256 } from '@/lib/hash';
import { guardMail, type ExpectedDelivery } from '@/lib/mail/guard';
import { deterministicMessageId } from '@/lib/mail/compose';
import { certToken } from '@/lib/secrets/crypto';
import { saveBatchReport } from './report';
import { setHeld, transition, TransitionError, type TransitionExtra } from './states';

export interface PdfStore {
  write(batchId: string, certId: string, pdf: Uint8Array): void;
  read(batchId: string, certId: string): Uint8Array | null;
}

export function diskPdfStore(root: string): PdfStore {
  return {
    write(batchId, certId, pdf) {
      const dir = path.join(root, batchId);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${certId}.pdf`);
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, pdf);
      fs.renameSync(tmp, file);
    },
    read(batchId, certId) {
      try { return new Uint8Array(fs.readFileSync(path.join(root, batchId, `${certId}.pdf`))); } catch { return null; }
    },
  };
}

export interface SendItem { cert: CertRow; record: RecordRow; pdf: Uint8Array }

export interface RunnerDeps {
  db: DB;
  organizerId: string;
  renderCert: (cert: CertRow, record: RecordRow) => Promise<RenderedCert>;
  storage: CertStorage | null;
  folderFor: (cert: CertRow, record: RecordRow) => string[];
  transport: MailTransport;
  compose: (items: SendItem[], messageId: string, corrected?: { note: string }) => OutboundMail;
  delivery: 'one-email' | 'email-per-certificate';
  pdfs: PdfStore;
  concurrency?: number;
  maxSendAttempts?: number;
  maxStorageAttempts?: number;
  uploadReport?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunOptions {
  only?: string[];
  corrected?: { note: string };
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>, onError: (e: unknown) => void) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(Math.floor(n) || 1, items.length)) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try { await fn(item); } catch (e) { onError(e); }
    }
  });
  await Promise.all(workers);
}

const running = new Map<string, Promise<RunSummary>>();

export interface RunSummary { counts: ReturnType<typeof statusCounts>; heldForQuota: number; status: string; message?: string | null }

export function runBatch(batchId: string, deps: RunnerDeps, opts: RunOptions = {}): Promise<RunSummary> {
  const existing = running.get(batchId);
  if (existing) return existing.catch(() => undefined).then(() => runBatch(batchId, deps, opts));
  const p = runBatchInner(batchId, deps, opts).finally(() => { if (running.get(batchId) === p) running.delete(batchId); });
  running.set(batchId, p);
  return p;
}

export function isRunning(batchId: string) { return running.has(batchId); }

function heldCount(db: DB, batchId: string): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) n FROM certificates WHERE batch_id = ? AND status = 'SAVED' AND held_reason = 'daily-limit'", batchId)!.n;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runBatchInner(batchId: string, deps: RunnerDeps, opts: RunOptions): Promise<RunSummary> {
  const { db } = deps;
  const owner = `${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
  if (!acquireBatchLock(db, batchId, owner)) {
    throw new Error('This batch is already running in another window or process. Wait for it to finish, then press Start again.');
  }
  const beat = setInterval(() => { try { touchBatchLock(db, batchId, owner); } catch {  } }, 5000);
  beat.unref?.();
  try {
    return await execute(batchId, deps, opts);
  } catch (e) {
    try { setBatchStatus(db, batchId, 'READY', `The run stopped unexpectedly (${errText(e)}). Nothing was lost: press Start to continue where it stopped.`); } catch {  }
    throw e;
  } finally {
    clearInterval(beat);
    try { releaseBatchLock(db, batchId, owner); } catch {  }
  }
}

async function execute(batchId: string, deps: RunnerDeps, opts: RunOptions): Promise<RunSummary> {
  const { db } = deps;
  const only = opts.only ? new Set(opts.only) : null;
  const pick = (rows: CertRow[]) => (only ? rows.filter((r) => only.has(r.id)) : rows);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const record = (id: string) => get<RecordRow>(db, 'SELECT * FROM records WHERE id = ?', id);
  const concurrency = deps.concurrency && deps.concurrency > 0 ? deps.concurrency : 4;
  const unexpected: string[] = [];
  const onError = (e: unknown) => { unexpected.push(errText(e)); };
  const move = (certId: string, to: RecordStatus, extra: TransitionExtra = {}): boolean => {
    try { transition(db, certId, to, extra); return true; } catch (e) {
      if (e instanceof TransitionError) return false;
      throw e;
    }
  };
  setBatchStatus(db, batchId, 'RUNNING', null);

  const stuck = all<CertRow>(db, "SELECT * FROM certificates WHERE batch_id = ? AND status = 'SENDING'", batchId);
  const byMessage = new Map<string, CertRow[]>();
  for (const c of stuck) byMessage.set(c.message_id ?? `none:${c.id}`, [...(byMessage.get(c.message_id ?? `none:${c.id}`) ?? []), c]);
  for (const [messageId, certs] of byMessage) {
    let sent: boolean | 'unknown' = 'unknown';
    if (!messageId.startsWith('none:') && deps.transport.wasSent) {
      try { sent = await deps.transport.wasSent(messageId); } catch { sent = 'unknown'; }
    }
    for (const c of certs) {
      if (sent === true) move(c.id, 'SENT', { note: 'Confirmed delivered after restart', fields: { sent_at: nowIso() } });
      else if (sent === false) move(c.id, 'SAVED', { note: 'Not delivered before the restart; will send again' });
      else move(c.id, 'FAILED', { error: 'The app stopped while this email was being sent, so it may or may not have arrived. Check with the student, then use Retry or Resend.', errorTransient: false });
    }
  }

  for (const c of pick(all<CertRow>(db, "SELECT * FROM certificates WHERE batch_id = ? AND status = 'FAILED' AND held_reason = 'retry'", batchId))) {
    const pdf = c.sha256 ? deps.pdfs.read(batchId, c.id) : null;
    if (!pdf || sha256(pdf) !== c.sha256 || (deps.storage && !c.storage_id)) move(c.id, 'PENDING', { note: 'Retry requested' });
  }

  const maxStore = Math.max(1, deps.maxStorageAttempts ?? 3);
  const toMake = pick(all<CertRow>(db, "SELECT * FROM certificates WHERE batch_id = ? AND status IN ('PENDING','GENERATED') ORDER BY person_key, category_label, id", batchId));
  await pool(toMake, concurrency, async (c) => {
    try {
      const rec = record(c.record_id);
      if (!rec) throw new Error("the student's row is no longer stored (was the batch removed?)");
      let current = c;
      if (current.status === 'PENDING') {
        const r = await deps.renderCert(current, rec);
        deps.pdfs.write(batchId, c.id, r.pdf);
        transition(db, c.id, 'GENERATED', { fields: { file_name: r.fileName, sha256: sha256(r.pdf) } });
        current = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', c.id)!;
      }
      const pdf = deps.pdfs.read(batchId, c.id);
      if (!pdf || sha256(pdf) !== current.sha256) throw new Error('the generated file is missing or damaged');
      if (deps.storage) {
        let stored;
        for (let i = 1; ; i++) {
          try {
            stored = await deps.storage.save({ certId: c.id, fileName: current.file_name!, pdf }, deps.folderFor(current, rec));
            break;
          } catch (e) {
            if (e instanceof StorageError && e.transient && i < maxStore) { await sleep(500 * 2 ** (i - 1)); continue; }
            throw e;
          }
        }
        transition(db, c.id, 'SAVED', { fields: { storage_id: stored.driveFileId, web_link: stored.webViewLink, folder_path: stored.folderPath } });
      } else transition(db, c.id, 'SAVED');
    } catch (e) {
      if (e instanceof TransitionError) return;
      const transient = e instanceof StorageError ? e.transient : false;
      const msg = e instanceof StorageError && e.userMessage ? e.userMessage : `Could not create or save the certificate: ${errText(e)}`;
      move(c.id, 'FAILED', { error: msg, errorTransient: transient, incrementAttempts: true });
    }
  }, onError);

  const ready = pick(all<CertRow>(db,
    "SELECT * FROM certificates WHERE batch_id = ? AND ((status = 'SAVED' AND (held_reason IS NULL OR held_reason = 'daily-limit')) OR (status = 'FAILED' AND held_reason = 'retry')) ORDER BY person_key, category_label, id", batchId));
  const groups = new Map<string, CertRow[]>();
  for (const c of ready) {
    const key = deps.delivery === 'one-email' ? `${c.person_key}\u0000${(record(c.record_id)?.email ?? '').trim().toLowerCase()}` : c.id;
    const list = groups.get(key);
    if (list) list.push(c); else groups.set(key, [c]);
  }
  let quotaHit = false;
  const limit = deps.transport.dailyLimit;
  const sender = deps.transport.name;
  const maxAttempts = Math.max(1, deps.maxSendAttempts ?? 3);

  const hold = (group: CertRow[], why: string) => {
    for (const c of group) {
      if (c.status === 'SAVED') setHeld(db, c.id, 'daily-limit', why);
      else if (move(c.id, 'SENDING', { note: 'Retry' })) move(c.id, 'SAVED', { heldReason: 'daily-limit', note: why });
    }
  };

  await pool([...groups.values()], concurrency, async (group) => {
    const items: SendItem[] = [];
    for (const c of group) {
      const pdf = deps.pdfs.read(batchId, c.id);
      if (!pdf || !c.sha256 || sha256(pdf) !== c.sha256) {
        move(c.id, 'FAILED', { error: 'The certificate file is missing or was changed. Press Retry failed to rebuild it.', errorTransient: false });
        continue;
      }
      const rec = record(c.record_id);
      if (!rec) { move(c.id, 'FAILED', { error: "The student's row is no longer stored, so nothing was sent.", errorTransient: false }); continue; }
      items.push({ cert: c, record: rec, pdf });
    }
    if (!items.length) return;
    const certs = items.map((i) => i.cert);

    if (quotaHit) { hold(certs, "Waiting for today's sending limit to reset"); return; }
    if (!reserveSend(db, deps.organizerId, sender, limit)) { quotaHit = true; hold(certs, "Waiting for today's sending limit to reset"); return; }

    const attempt = Math.max(...certs.map((c) => c.attempts)) + 1;
    const messageId = deterministicMessageId(certs.map((c) => c.id), attempt);
    const claimed: CertRow[] = [];
    for (const c of certs) {
      if (move(c.id, 'SENDING', { fields: { message_id: messageId }, incrementAttempts: true, note: c.status === 'FAILED' ? 'Retry' : undefined })) claimed.push(c);
    }
    if (claimed.length !== certs.length) {
      for (const c of claimed) move(c.id, 'SAVED', { note: 'Released: another run took over' });
      releaseSend(db, deps.organizerId, sender);
      return;
    }

    const first = items[0].record;
    const expected: ExpectedDelivery = {
      to: first.email, personKey: first.person_key,
      certs: certs.map((c) => ({ certId: c.id, sha256: c.sha256!, verifyCode: c.verify_code, reportToken: certToken(c.id) })),
    };
    const markSent = (note?: string) => {
      for (const c of certs) {
        try { transition(db, c.id, 'SENT', { note, fields: { sent_at: nowIso() } }); } catch (e) { onError(e); }
      }
    };

    for (let i = 1; ; i++) {
      try {
        const mail = deps.compose(items, messageId, opts.corrected);
        await guardMail(mail, expected);
        await deps.transport.send(mail);
        markSent();
        return;
      } catch (e) {
        const quota = e instanceof MailError && e.quota;
        const transient = e instanceof MailError && e.transient;
        if (quota) {
          quotaHit = true;
          releaseSend(db, deps.organizerId, sender);
          markQuotaExhausted(db, deps.organizerId, sender, limit);
          for (const c of certs) move(c.id, 'SAVED', { heldReason: 'daily-limit', note: errText(e) });
          return;
        }
        if (transient) {
          let delivered: boolean | 'unknown' = 'unknown';
          try { delivered = deps.transport.wasSent ? await deps.transport.wasSent(messageId) : 'unknown'; } catch { delivered = 'unknown'; }
          if (delivered === true) { markSent('Delivered (confirmed after a connection error)'); return; }
          if (i < maxAttempts) { await sleep(500 * 2 ** (i - 1)); continue; }
        }
        releaseSend(db, deps.organizerId, sender);
        const msg = e instanceof MappingError ? errText(e) : `Email not sent: ${errText(e)}`;
        for (const c of certs) move(c.id, 'FAILED', { error: msg, errorTransient: transient });
        return;
      }
    }
  }, onError);

  const counts = statusCounts(db, batchId);
  const held = heldCount(db, batchId);
  const open = counts.PENDING + counts.GENERATED + counts.SENDING + (counts.SAVED - held);
  const status = held > 0 ? 'PAUSED' : open > 0 ? 'READY' : 'DONE';
  const parts: string[] = [];
  if (held > 0) {
    parts.push(`${held} certificate(s) are waiting because today's sending limit${limit !== undefined ? ` (${limit} emails)` : ''} was reached. They continue tomorrow, or press Continue after you switch the sender in Settings.`);
  }
  if (counts.FAILED > 0) parts.push(`${counts.FAILED} certificate(s) failed. Check the reasons, then press Retry failed.`);
  if (unexpected.length) parts.push(`${unexpected.length} unexpected problem(s): ${unexpected[0]}`);
  const message = parts.length ? parts.join(' ') : null;
  setBatchStatus(db, batchId, status, message);

  if (deps.uploadReport !== false && deps.storage) {
    try { await saveBatchReport(db, batchId, deps.storage); } catch {  }
  }
  return { counts, heldForQuota: held, status, message };
}

export function requestRetry(db: DB, batchId: string, certIds?: string[]): number {
  const rows = all<CertRow>(db, "SELECT * FROM certificates WHERE batch_id = ? AND status = 'FAILED'", batchId).filter((r) => !certIds || certIds.includes(r.id));
  for (const r of rows) setHeld(db, r.id, 'retry', 'Retry requested');
  return rows.length;
}

function needReason(reason: string | undefined | null, what: string): string {
  const r = String(reason ?? '').trim();
  if (!r) throw new TransitionError(`${what} needs a reason. Type why it is being done; it is saved in the history.`);
  return r;
}

export function requestResend(db: DB, certId: string, reason: string) {
  const why = needReason(reason, 'Sending a certificate again');
  tx(db, () => {
    const row = get<{ status: RecordStatus }>(db, 'SELECT status FROM certificates WHERE id = ?', certId);
    if (!row) throw new TransitionError(`Unknown certificate ${certId}`);
    if (row.status !== 'SENT') throw new TransitionError(`Only a certificate that was already sent can be sent again (this one is ${row.status}).`);
    transition(db, certId, 'SENDING', { note: `Resend: ${why}` });
    transition(db, certId, 'SAVED', { note: 'Queued for resend' });
  });
}

export function requestInclude(db: DB, certId: string, reason: string) {
  const why = needReason(reason, 'Including a skipped certificate');
  transition(db, certId, 'PENDING', { note: `Included again: ${why}` });
}

export function requestReissue(db: DB, certId: string, reason: string) {
  const why = needReason(reason, 'Reissuing a certificate');
  tx(db, () => {
    const row = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', certId);
    if (!row) throw new Error('Unknown certificate');
    if (row.status === 'PENDING') return;
    if (row.status === 'SENT' || row.status === 'FAILED') transition(db, certId, 'PENDING', { note: `Reissue: ${why}` });
    else if (row.status === 'SAVED' || row.status === 'GENERATED') {
      transition(db, certId, 'FAILED', { error: 'Replaced by a corrected version' });
      transition(db, certId, 'PENDING', { note: `Reissue: ${why}` });
    } else throw new TransitionError(`This certificate is ${row.status} right now and cannot be reissued.`);
  });
}

export function releaseQuotaHold(db: DB, batchId: string): number {
  const rows = all<{ id: string }>(db, "SELECT id FROM certificates WHERE batch_id = ? AND held_reason = 'daily-limit'", batchId);
  for (const r of rows) setHeld(db, r.id, null, 'Hold released');
  if (rows.length) {
    const b = get<{ status: string }>(db, 'SELECT status FROM batches WHERE id = ?', batchId);
    if (b?.status === 'PAUSED') setBatchStatus(db, batchId, 'READY', null);
  }
  return rows.length;
}
