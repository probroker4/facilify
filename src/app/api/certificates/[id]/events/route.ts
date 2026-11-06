import { eventsOf, getCert } from '@/lib/db/repo';
import { notFound, withApi } from '../../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi<{ id: string }>(async ({ db, org, params }) => {
  const cert = getCert(db, params.id);
  if (!cert || cert.organizer_id !== org.id) throw notFound('That certificate was not found.');
  return { events: eventsOf(db, cert.id) };
});
