import { batchReportCsv } from '@/lib/pipeline/report';
import { ownBatch } from '../../../_batch';
import { withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const batch = ownBatch(db, org, params.id);
  const safe = batch.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'batch';
  return new Response(batchReportCsv(db, batch.id), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${safe}-report.csv"`, 'cache-control': 'no-store' },
  });
});
