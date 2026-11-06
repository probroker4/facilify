import { resolveTicket } from '@/lib/tickets/tickets';
import { readJsonBody, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi<{ id: string }>(async ({ req, db, org, params }) => {
  const body = await readJsonBody<{ field?: string; value?: string; note?: string }>(req);
  return { ...(await resolveTicket(db, org.id, params.id, { field: body.field, value: String(body.value ?? ''), note: body.note })) };
});
