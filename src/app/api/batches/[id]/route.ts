import { all } from '@/lib/db/db';
import { statusCounts, type CertRow } from '@/lib/db/repo';
import { isRunning } from '@/lib/pipeline/runner';
import type { BatchConfig } from '@/lib/pipeline/config';
import { ownBatch, readTestSent } from '../../_batch';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

const PAGE = 100;
const STATUSES = ['PENDING', 'GENERATED', 'SAVED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'];

export const GET = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') ?? '').toUpperCase();
  const q = (url.searchParams.get('q') ?? '').trim();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const where = ['c.batch_id = ?'];
  const args: (string | number)[] = [batch.id];
  if (STATUSES.includes(status)) { where.push('c.status = ?'); args.push(status); }
  if (q) {
    where.push('(r.values_json LIKE ? OR r.email LIKE ? OR c.category_label LIKE ? OR c.verify_code LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like, like);
  }
  const rows = all<CertRow & { email: string; values_json: string; row_number: number }>(db,
    `SELECT c.*, r.email, r.values_json, r.row_number FROM certificates c JOIN records r ON r.id = c.record_id
     WHERE ${where.join(' AND ')} ORDER BY r.row_number, c.category_label LIMIT ? OFFSET ?`, ...args, PAGE, (page - 1) * PAGE);
  const matching = all<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM certificates c JOIN records r ON r.id = c.record_id WHERE ${where.join(' AND ')}`, ...args)[0].n;

  const certificates = rows.map((c) => {
    let values: Record<string, string> = {};
    try { values = JSON.parse(c.values_json); } catch { values = {}; }
    return {
      id: c.id, name: values.NAME ?? '', email: c.email, award: c.category_label, status: c.status, error: c.error, held_reason: c.held_reason,
      attempts: c.attempts, sent_at: c.sent_at, updated_at: c.updated_at, file_name: c.file_name, verify_code: c.verify_code,
      web_link: c.web_link, folder_path: c.folder_path, row_number: c.row_number, pdf_url: `/api/certificates/${encodeURIComponent(c.id)}/pdf`,
      verify_url: `/verify/${encodeURIComponent(c.verify_code)}`,
    };
  });
  const counts = statusCounts(db, batch.id);
  let cfg: Partial<BatchConfig> = {};
  try { cfg = JSON.parse(batch.config_json) as Partial<BatchConfig>; } catch { cfg = {}; }
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  return {
    batch: { id: batch.id, name: batch.name, status: batch.status, message: batch.message, created_at: batch.created_at, updated_at: batch.updated_at, sheet_upload_id: batch.sheet_upload_id },
    counts, total, running: isRunning(batch.id), certificates, page, pageSize: PAGE, matching,
    testSent: readTestSent(db, org, batch),
    config: {
      delivery: cfg.scheme?.delivery ?? null, multiAward: cfg.scheme?.multiAward ?? null, organizationName: cfg.organizationName ?? null,
      folderPattern: cfg.folderPattern ?? null, linkedIn: cfg.linkedIn ?? null,
      categories: (cfg.scheme?.categories ?? []).map((c) => ({ id: c.id, label: c.label, templateId: c.templateId })),
    },
  };
});
