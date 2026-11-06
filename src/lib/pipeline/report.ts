import type { CertStorage } from '@/lib/contracts';
import { all, get, type DB } from '@/lib/db/db';
import { reportFolderPathFor, safeFileName } from '@/lib/storage/folders';

const FORMULA_START = /^[\s\u0000-\u001f\u007f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]*[=+\-@|]/;
const CONTROL_START = /^[\t\r]/;

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (FORMULA_START.test(s) || CONTROL_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const REPORT_HEADERS = ['Row', 'Name', 'Student ID', 'Email', 'Award', 'File name', 'Status', 'Waiting for', 'Error', 'Link', 'Folder', 'Verify code', 'Attempts', 'Sent at', 'Last update'];

export function heldText(held: string | null): string {
  if (!held) return '';
  if (held === 'daily-limit') return "Today's sending limit was reached; continues tomorrow or after switching the sender";
  if (held === 'retry') return 'Retry requested';
  if (held.startsWith('already-sent:')) return 'Already sent in an earlier batch';
  return held;
}

export function batchReportCsv(db: DB, batchId: string): string {
  const rows = all<{
    row_number: number; values_json: string; email: string; category_label: string; file_name: string | null; status: string; held_reason: string | null;
    error: string | null; web_link: string | null; folder_path: string | null; verify_code: string; attempts: number; sent_at: string | null; updated_at: string;
  }>(db, `SELECT r.row_number, r.values_json, r.email, c.category_label, c.file_name, c.status, c.held_reason, c.error, c.web_link, c.folder_path,
      c.verify_code, c.attempts, c.sent_at, c.updated_at
    FROM certificates c JOIN records r ON r.id = c.record_id WHERE c.batch_id = ? ORDER BY r.row_number, c.category_label, c.id`, batchId);
  const lines = [REPORT_HEADERS.join(',')];
  for (const r of rows) {
    const v = JSON.parse(r.values_json) as Record<string, string>;
    lines.push([r.row_number, v.NAME, v.ID, r.email, r.category_label, r.file_name, r.status, heldText(r.held_reason), r.error, r.web_link, r.folder_path,
      r.verify_code, r.attempts, r.sent_at, r.updated_at].map(csvCell).join(','));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

export async function saveBatchReport(db: DB, batchId: string, storage: CertStorage | null, folderPattern?: string) {
  if (!storage) return null;
  const batch = get<{ name: string; config_json: string }>(db, 'SELECT name, config_json FROM batches WHERE id = ?', batchId);
  if (!batch) return null;
  const pattern = folderPattern ?? (JSON.parse(batch.config_json || '{}') as { folderPattern?: string }).folderPattern ?? '';
  const first = get<{ values_json: string }>(db, 'SELECT r.values_json FROM certificates c JOIN records r ON r.id = c.record_id WHERE c.batch_id = ? ORDER BY r.row_number LIMIT 1', batchId);
  const values = first ? (JSON.parse(first.values_json) as Record<string, string>) : {};
  const folder = reportFolderPathFor(pattern, values);
  const fileName = safeFileName(`${batch.name || 'batch'} - status report.csv`, 'status report.csv');
  const bytes = new TextEncoder().encode(batchReportCsv(db, batchId));
  const reportId = `report:${batchId}`;
  const s = storage as CertStorage & {
    saveReport?: (csv: Uint8Array, folderPath: string[], fileName: string, reportId?: string) => Promise<unknown>;
    saveFile?: (id: string, fileName: string, content: Uint8Array, folderPath: string[]) => Promise<unknown>;
  };
  if (typeof s.saveReport === 'function') return s.saveReport(bytes, folder, fileName, reportId);
  if (s.name === 'local' && typeof s.saveFile === 'function') return s.saveFile(reportId, fileName, bytes, folder);
  return storage.save({ certId: reportId, fileName, pdf: bytes }, folder);
}
