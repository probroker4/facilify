import type { RecordStatus } from '@/lib/contracts';
import { all, get, nowIso, run, tx, type DB } from './db';
import { decryptSecret, encryptSecret } from '@/lib/secrets/crypto';

export interface OrganizerRow { id: string; email: string; name: string | null; password_hash: string | null; google_sub: string | null; active: number; created_at: string }
export interface BatchRow { id: string; organizer_id: string; name: string; status: string; sheet_upload_id: string | null; config_json: string; message: string | null; created_at: string; updated_at: string }
export interface RecordRow { id: string; batch_id: string; row_number: number; person_key: string; email: string; email_source: string; values_json: string }
export interface CertRow {
  id: string; batch_id: string; organizer_id: string; record_id: string; person_key: string; category_id: string; category_label: string;
  template_id: string; dup_key: string; file_name: string | null; sha256: string | null; verify_code: string; status: RecordStatus;
  held_reason: string | null; error: string | null; error_transient: number | null; attempts: number; storage_id: string | null;
  web_link: string | null; folder_path: string | null; message_id: string | null; revoked: number; sent_at: string | null; created_at: string; updated_at: string;
}
export interface TicketRow {
  id: string; cert_id: string; batch_id: string; organizer_id: string; category: string; field: string | null; suggested: string | null;
  note: string | null; status: string; resolution_note: string | null; created_at: string; resolved_at: string | null;
}

export function setSetting(db: DB, organizerId: string, key: string, value: unknown, secret = false) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  run(db, `INSERT INTO settings (organizer_id, key, value, encrypted) VALUES (?, ?, ?, ?)
    ON CONFLICT(organizer_id, key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted`,
  organizerId, key, secret ? encryptSecret(raw) : raw, secret ? 1 : 0);
}

export function getSetting<T = string>(db: DB, organizerId: string, key: string): T | undefined {
  const row = get<{ value: string; encrypted: number }>(db, 'SELECT value, encrypted FROM settings WHERE organizer_id = ? AND key = ?', organizerId, key);
  if (!row) return undefined;
  const raw = row.encrypted ? decryptSecret(row.value) : row.value;
  try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
}

export function deleteSetting(db: DB, organizerId: string, key: string) {
  run(db, 'DELETE FROM settings WHERE organizer_id = ? AND key = ?', organizerId, key);
}

type DocTable = 'templates' | 'email_templates' | 'schemes' | 'column_profiles';
export function saveDoc(db: DB, table: DocTable, organizerId: string, id: string, name: string, doc: unknown) {
  run(db, `INSERT INTO ${table} (id, organizer_id, name, json, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at
    WHERE ${table}.organizer_id = excluded.organizer_id`, id, organizerId, name, JSON.stringify(doc), nowIso());
}
export function getDoc<T>(db: DB, table: DocTable, organizerId: string, id: string): T | undefined {
  const row = get<{ json: string }>(db, `SELECT json FROM ${table} WHERE id = ? AND organizer_id = ?`, id, organizerId);
  return row ? (JSON.parse(row.json) as T) : undefined;
}
export function listDocs<T>(db: DB, table: DocTable, organizerId: string): { id: string; name: string; doc: T; updated_at: string }[] {
  return all<{ id: string; name: string; json: string; updated_at: string }>(db, `SELECT id, name, json, updated_at FROM ${table} WHERE organizer_id = ? ORDER BY updated_at DESC`, organizerId)
    .map((r) => ({ id: r.id, name: r.name, doc: JSON.parse(r.json) as T, updated_at: r.updated_at }));
}
export function deleteDoc(db: DB, table: DocTable, organizerId: string, id: string) {
  run(db, `DELETE FROM ${table} WHERE id = ? AND organizer_id = ?`, id, organizerId);
}

export function getBatch(db: DB, organizerId: string, batchId: string): BatchRow | undefined {
  return get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ? AND organizer_id = ?', batchId, organizerId);
}
export function listBatches(db: DB, organizerId: string): BatchRow[] {
  return all<BatchRow>(db, 'SELECT * FROM batches WHERE organizer_id = ? ORDER BY created_at DESC', organizerId);
}
export function setBatchStatus(db: DB, batchId: string, status: string, message: string | null = null) {
  run(db, 'UPDATE batches SET status = ?, message = ?, updated_at = ? WHERE id = ?', status, message, nowIso(), batchId);
}
export function certsOfBatch(db: DB, batchId: string): CertRow[] {
  return all<CertRow>(db, 'SELECT * FROM certificates WHERE batch_id = ? ORDER BY person_key, category_label', batchId);
}
export function getCert(db: DB, certId: string): CertRow | undefined {
  return get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', certId);
}
export function getCertByVerifyCode(db: DB, code: string): CertRow | undefined {
  return get<CertRow>(db, 'SELECT * FROM certificates WHERE verify_code = ?', code.toUpperCase());
}
export function getRecord(db: DB, recordId: string): RecordRow | undefined {
  return get<RecordRow>(db, 'SELECT * FROM records WHERE id = ?', recordId);
}
export function statusCounts(db: DB, batchId: string): Record<RecordStatus, number> {
  const base: Record<RecordStatus, number> = { PENDING: 0, GENERATED: 0, SAVED: 0, SENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 };
  for (const r of all<{ status: RecordStatus; n: number }>(db, 'SELECT status, COUNT(*) n FROM certificates WHERE batch_id = ? GROUP BY status', batchId)) base[r.status] = r.n;
  return base;
}
export function eventsOf(db: DB, certId: string) {
  return all<{ from_status: string | null; to_status: string | null; note: string | null; at: string }>(db, 'SELECT from_status, to_status, note, at FROM events WHERE cert_id = ? ORDER BY id', certId);
}

export function sentToday(db: DB, organizerId: string, transport: string, day = nowIso().slice(0, 10)): number {
  return get<{ count: number }>(db, 'SELECT count FROM send_counts WHERE organizer_id = ? AND transport = ? AND day = ?', organizerId, transport, day)?.count ?? 0;
}
export function bumpSent(db: DB, organizerId: string, transport: string, n = 1, day = nowIso().slice(0, 10)) {
  run(db, `INSERT INTO send_counts (organizer_id, transport, day, count) VALUES (?, ?, ?, ?)
    ON CONFLICT(organizer_id, transport, day) DO UPDATE SET count = count + excluded.count`, organizerId, transport, day, n);
}

export function reserveSend(db: DB, organizerId: string, transport: string, limit: number | undefined, day = nowIso().slice(0, 10)): boolean {
  if (limit === undefined) { bumpSent(db, organizerId, transport, 1, day); return true; }
  return tx(db, () => {
    run(db, 'INSERT OR IGNORE INTO send_counts (organizer_id, transport, day, count) VALUES (?, ?, ?, 0)', organizerId, transport, day);
    const r = run(db, 'UPDATE send_counts SET count = count + 1 WHERE organizer_id = ? AND transport = ? AND day = ? AND count < ?', organizerId, transport, day, limit);
    return Number(r.changes) === 1;
  });
}
export function releaseSend(db: DB, organizerId: string, transport: string, day = nowIso().slice(0, 10)) {
  run(db, 'UPDATE send_counts SET count = MAX(count - 1, 0) WHERE organizer_id = ? AND transport = ? AND day = ?', organizerId, transport, day);
}
export function markQuotaExhausted(db: DB, organizerId: string, transport: string, limit: number | undefined, day = nowIso().slice(0, 10)) {
  if (limit === undefined) return;
  run(db, `INSERT INTO send_counts (organizer_id, transport, day, count) VALUES (?, ?, ?, ?)
    ON CONFLICT(organizer_id, transport, day) DO UPDATE SET count = MAX(count, excluded.count)`, organizerId, transport, day, limit);
}

const LOCK_STALE_MS = 30_000;
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
export function acquireBatchLock(db: DB, batchId: string, owner: string): boolean {
  return tx(db, () => {
    const cur = get<{ owner: string; pid: number; heartbeat: number }>(db, 'SELECT owner, pid, heartbeat FROM batch_locks WHERE batch_id = ?', batchId);
    if (cur && cur.owner !== owner && cur.pid !== process.pid && pidAlive(cur.pid) && Date.now() - cur.heartbeat < LOCK_STALE_MS) return false;
    run(db, 'INSERT INTO batch_locks (batch_id, owner, pid, heartbeat) VALUES (?, ?, ?, ?) ON CONFLICT(batch_id) DO UPDATE SET owner = excluded.owner, pid = excluded.pid, heartbeat = excluded.heartbeat',
      batchId, owner, process.pid, Date.now());
    return true;
  });
}
export function touchBatchLock(db: DB, batchId: string, owner: string) {
  run(db, 'UPDATE batch_locks SET heartbeat = ? WHERE batch_id = ? AND owner = ?', Date.now(), batchId, owner);
}
export function releaseBatchLock(db: DB, batchId: string, owner: string) {
  run(db, 'DELETE FROM batch_locks WHERE batch_id = ? AND owner = ?', batchId, owner);
}
