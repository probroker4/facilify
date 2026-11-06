import { buildShareLinks } from '@/lib/share';
import { certFromToken, publicCertInfo } from '@/lib/tickets/tickets';
import type { BatchConfig } from '@/lib/pipeline/config';
import { get } from '@/lib/db/db';
import type { BatchRow } from '@/lib/db/repo';
import { orgSettings } from '@/lib/pipeline/services';
import { baseUrl } from '@/lib/paths';
import { withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ token: string }>(async ({ db, params }) => {
  const token = decodeURIComponent(params.token);
  const info = publicCertInfo(db, token);
  const { cert } = certFromToken(db, token);
  const batch = get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', cert.batch_id);
  let cfg: Partial<BatchConfig> = {};
  try { cfg = batch ? (JSON.parse(batch.config_json) as Partial<BatchConfig>) : {}; } catch { cfg = {}; }
  const cat = cfg.scheme?.categories.find((c) => c.id === cert.category_id);
  const o = orgSettings(db, cert.organizer_id);
  const title = cat?.linkedInTitle || `${info.award}${info.event ? ` - ${info.event}` : ''}`;
  const links = buildShareLinks({
    title, organizationName: info.organizationName, organizationId: cfg.organizationId || o.linkedInOrgId, dateText: info.date,
    issuedAt: cfg.issuedAt ? new Date(cfg.issuedAt) : new Date(), verifyUrl: info.verifyUrl, verifyCode: info.verifyCode,
    customizeUrl: `${baseUrl()}/linkedin/${token}`,
  });
  return {
    ...info,
    event: info.event, issuedAt: cfg.issuedAt ?? null,
    linkedInEnabled: cfg.linkedIn ?? o.linkedInEnabled,
    organizationId: cfg.organizationId || o.linkedInOrgId || null,
    linkedIn: { title, addToProfile: links.addToProfile, share: links.share, post: links.post },
  };
}, { auth: false });
