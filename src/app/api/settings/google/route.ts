import { deleteSetting, getSetting, setSetting } from '@/lib/db/repo';
import { senderSettings } from '@/lib/pipeline/services';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const DELETE = withApi(async ({ db, org }) => {
  for (const k of ['google.refresh_token', 'google.email', 'google.scopes']) deleteSetting(db, org.id, k);
  const sender = senderSettings(db, org.id);
  if (sender.kind === 'gmail') setSetting(db, org.id, 'sender', { ...sender, kind: 'capture' });
  if (getSetting<string>(db, org.id, 'storage') === 'drive') setSetting(db, org.id, 'storage', 'local');
  return { ok: true };
});
