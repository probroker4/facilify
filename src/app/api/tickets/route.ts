import { listTickets, openTicketCount } from '@/lib/tickets/tickets';
import { withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ req, db, org }) => {
  const status = new URL(req.url).searchParams.get('status') || undefined;
  const tickets = listTickets(db, org.id, status?.toUpperCase());
  return { tickets, openCount: openTicketCount(db, org.id) };
});
