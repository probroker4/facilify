import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, type DB } from '@/lib/db/db';
import { dataDir } from '@/lib/paths';
import { uploadPath } from './uploads';

export interface PurgeResult {
  batchId: string;
  records: number;
  certificates: number;
  events: number;
  tickets: number;
  uploads: number;
  pdfFiles: number;
  keptUploads: number;
  failures: string[];
}

export class PurgeError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'PurgeError'; }
}

const UPLOAD_ID_RE = /\bup_[A-Za-z0-9_-]{8,}/g;
const SAFE_BATCH_ID = /^[A-Za-z0-9_.-]{1,120}$/;

function uploadIdsIn(text: string | null | undefined): string[] {
  return text ? [...new Set(text.match(UPLOAD_ID_RE) ?? [])] : [];
}

function looksActive(db: DB, batchId: string, status: string, updatedAt: string): boolean {
  if (status !== 'RUNNING') return false;
  const last = get<{ t: string | null }>(db, 'SELECT MAX(updated_at) AS t FROM certificates WHERE batch_id = ?', batchId)?.t;
  const newest = Math.max(Date.parse(updatedAt) || 0, last ? Date.parse(last) || 0 : 0);
  return Date.now() - newest < 120_000;
}

export function purgeBatch(db: DB, organizerId: string, batchId: string): PurgeResult {
  const batch = get<{ id: string; status: string; sheet_upload_id: string | null; config_json: string; updated_at: string }>(
    db, 'SELECT id, status, sheet_upload_id, config_json, updated_at FROM batches WHERE id = ? AND organizer_id = ?', batchId, organizerId);
  if (!batch) throw new PurgeError('Batch not found.', 404);
  if (looksActive(db, batchId, batch.status, batch.updated_at)) {
    throw new PurgeError('This batch is still sending. Wait until it finishes, then delete it.', 409);
  }

  const candidates = new Set<string>(uploadIdsIn(batch.config_json));
  if (batch.sheet_upload_id) candidates.add(batch.sheet_upload_id);

  const stillUsed = new Set<string>();
  for (const r of all<{ sheet_upload_id: string | null; config_json: string }>(db, 'SELECT sheet_upload_id, config_json FROM batches WHERE id <> ? AND organizer_id = ?', batchId, organizerId)) {
    if (r.sheet_upload_id) stillUsed.add(r.sheet_upload_id);
    uploadIdsIn(r.config_json).forEach((u) => stillUsed.add(u));
  }
  for (const table of ['templates', 'email_templates', 'schemes', 'column_profiles']) {
    for (const r of all<{ json: string }>(db, `SELECT json FROM ${table} WHERE organizer_id = ?`, organizerId)) uploadIdsIn(r.json).forEach((u) => stillUsed.add(u));
  }

  const owned = new Set(all<{ id: string }>(db, 'SELECT id FROM uploads WHERE organizer_id = ?', organizerId).map((r) => r.id));
  const failures: string[] = [];
  const removable: string[] = [];
  let kept = 0;
  for (const id of candidates) {
    if (!owned.has(id)) continue;
    if (stillUsed.has(id)) { kept++; continue; }
    try {
      fs.rmSync(uploadPath(id), { force: true });
      removable.push(id);
    } catch (e) {
      failures.push(`upload ${id}: ${(e as Error).message}`);
    }
  }

  let pdfFiles = 0;
  if (SAFE_BATCH_ID.test(batchId) && batchId !== '.' && batchId !== '..') {
    const root = path.resolve(dataDir(), 'pdfs');
    const dir = path.resolve(root, batchId);
    if (dir.startsWith(root + path.sep) && fs.existsSync(dir)) {
      try {
        pdfFiles = fs.readdirSync(dir).length;
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        failures.push(`pdf cache: ${(e as Error).message}`);
      }
    }
  } else {
    failures.push('pdf cache: unsafe batch id, not touched');
  }

  const counts = tx(db, () => {
    const n = (sql: string) => Number(get<{ n: number }>(db, sql, batchId)?.n ?? 0);
    const out = {
      records: n('SELECT COUNT(*) n FROM records WHERE batch_id = ?'),
      certificates: n('SELECT COUNT(*) n FROM certificates WHERE batch_id = ?'),
      events: n('SELECT COUNT(*) n FROM events WHERE batch_id = ?'),
      tickets: n('SELECT COUNT(*) n FROM tickets WHERE batch_id = ?'),
    };
    run(db, 'DELETE FROM tickets WHERE batch_id = ?', batchId);
    run(db, 'DELETE FROM events WHERE batch_id = ?', batchId);
    run(db, 'DELETE FROM events WHERE cert_id IN (SELECT id FROM certificates WHERE batch_id = ?)', batchId);
    run(db, 'DELETE FROM certificates WHERE batch_id = ?', batchId);
    run(db, 'DELETE FROM records WHERE batch_id = ?', batchId);
    for (const id of removable) run(db, 'DELETE FROM uploads WHERE id = ? AND organizer_id = ?', id, organizerId);
    if (failures.length === 0) run(db, 'DELETE FROM batches WHERE id = ? AND organizer_id = ?', batchId, organizerId);
    else run(db, "UPDATE batches SET status = 'PURGING', sheet_upload_id = NULL WHERE id = ? AND organizer_id = ?", batchId, organizerId);
    return out;
  });

  return { batchId, ...counts, uploads: removable.length, pdfFiles, keptUploads: kept, failures };
}
