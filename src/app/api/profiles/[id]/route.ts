import { deleteDoc } from '@/lib/db/repo';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const DELETE = withApi<{ id: string }>(async ({ db, org, params }) => {
  deleteDoc(db, 'column_profiles', org.id, params.id);
  return { ok: true };
});
