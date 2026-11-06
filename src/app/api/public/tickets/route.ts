import { clientKey } from '@/lib/auth/ratelimit';
import { createTicket } from '@/lib/tickets/tickets';
import { readJsonBody, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ req, db }) => {
  const body = await readJsonBody<{ token?: string; category?: string; suggested?: string; note?: string }>(req);
  const { id } = createTicket(db, String(body.token ?? ''), { category: String(body.category ?? ''), suggested: body.suggested, note: body.note }, clientKey(req.headers));
  return { ok: true, id };
}, { auth: false });
