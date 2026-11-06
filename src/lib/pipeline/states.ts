import type { RecordStatus } from '@/lib/contracts';
import { get, nowIso, run, tx, type DB } from '@/lib/db/db';

export const TRANSITIONS: Record<RecordStatus, RecordStatus[]> = {
  PENDING: ['GENERATED', 'FAILED', 'SKIPPED'],
  GENERATED: ['SAVED', 'FAILED'],
  SAVED: ['SENDING', 'FAILED', 'SKIPPED'],
  SENDING: ['SENT', 'FAILED', 'SAVED'],
  SENT: ['SENDING', 'PENDING'],
  FAILED: ['PENDING', 'SENDING'],
  SKIPPED: ['PENDING'],
};

const NEEDS_REASON: [RecordStatus, RecordStatus][] = [['SENT', 'SENDING'], ['SENT', 'PENDING'], ['SKIPPED', 'PENDING']];

export class TransitionError extends Error {
  constructor(message: string) { super(message); this.name = 'TransitionError'; }
}

export function canTransition(from: RecordStatus, to: RecordStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const FIELD_COLUMNS = new Set(['file_name', 'sha256', 'storage_id', 'web_link', 'folder_path', 'message_id', 'sent_at']);

export interface TransitionExtra {
  note?: string;
  error?: string | null;
  errorTransient?: boolean | null;
  heldReason?: string | null;
  fields?: Partial<Record<'file_name' | 'sha256' | 'storage_id' | 'web_link' | 'folder_path' | 'message_id' | 'sent_at', string | null>>;
  incrementAttempts?: boolean;
}

export function transition(db: DB, certId: string, to: RecordStatus, extra: TransitionExtra = {}): void {
  tx(db, () => {
    const row = get<{ status: RecordStatus; batch_id: string }>(db, 'SELECT status, batch_id FROM certificates WHERE id = ?', certId);
    if (!row) throw new TransitionError(`Unknown certificate ${certId}`);
    if (!canTransition(row.status, to)) throw new TransitionError(`Illegal status change ${row.status} -> ${to} for ${certId}`);
    if (NEEDS_REASON.some(([f, t]) => f === row.status && t === to) && !extra.note?.trim()) {
      throw new TransitionError(`A reason is required for this change (${row.status} -> ${to}).`);
    }
    const at = nowIso();
    const sets = ['status = ?', 'updated_at = ?', 'error = ?', 'error_transient = ?', 'held_reason = ?'];
    const params: (string | number | null)[] = [to, at, extra.error ?? null, extra.errorTransient == null ? null : extra.errorTransient ? 1 : 0, extra.heldReason ?? null];
    for (const [k, v] of Object.entries(extra.fields ?? {})) {
      if (!FIELD_COLUMNS.has(k)) throw new TransitionError(`Cannot set ${k}`);
      sets.push(`${k} = ?`);
      params.push(v ?? null);
    }
    if (extra.incrementAttempts) sets.push('attempts = attempts + 1');
    const res = run(db, `UPDATE certificates SET ${sets.join(', ')} WHERE id = ? AND status = ?`, ...params, certId, row.status);
    if (Number(res.changes) !== 1) throw new TransitionError(`Certificate ${certId} was changed by someone else (expected ${row.status}).`);
    run(db, 'INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, ?, ?, ?, ?, ?)',
      certId, row.batch_id, row.status, to, extra.note ?? extra.error ?? null, at);
  });
}

export function setHeld(db: DB, certId: string, heldReason: string | null, note?: string) {
  tx(db, () => {
    const row = get<{ status: RecordStatus; batch_id: string; held_reason: string | null }>(db, 'SELECT status, batch_id, held_reason FROM certificates WHERE id = ?', certId);
    if (!row || row.held_reason === heldReason) return;
    const at = nowIso();
    run(db, 'UPDATE certificates SET held_reason = ?, updated_at = ? WHERE id = ?', heldReason, at, certId);
    run(db, 'INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, ?, ?, ?, ?, ?)',
      certId, row.batch_id, row.status, row.status, note ?? (heldReason ? `Hold: ${heldReason}` : 'Hold released'), at);
  });
}
