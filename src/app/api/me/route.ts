import { getSetting } from '@/lib/db/repo';
import { googleConfigured } from '@/lib/auth/google';
import { orgSettings, senderSettings } from '@/lib/pipeline/services';
import { openTicketCount } from '@/lib/tickets/tickets';
import { withApi } from '../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async ({ db, org }) => {
  const email = getSetting<string>(db, org.id, 'google.email');
  const connected = !!getSetting(db, org.id, 'google.refresh_token');
  const o = orgSettings(db, org.id);
  return {
    organizer: { id: org.id, email: org.email, name: org.name || 'Organizer' },
    organization: o.name,
    google: { configured: googleConfigured(), connected, email: email ?? null },
    openTickets: openTicketCount(db, org.id),
    sender: senderSettings(db, org.id).kind,
    storage: getSetting<string>(db, org.id, 'storage') ?? 'local',
  };
});
