import { rejectTicket } from '@/lib/tickets/tickets';
import { readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const body = await readJsonBody<{ note?: string }>(req);
  return { ...(await rejectTicket(db, org.id, params.id, String(body.note ?? ''))) };
});
