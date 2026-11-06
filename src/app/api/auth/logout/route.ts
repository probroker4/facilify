import { clearSession } from '@/lib/auth/session';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async () => {
  const res = Response.json({ ok: true });
  for (const h of clearSession()) res.headers.append('Set-Cookie', h);
  return res;
}, { auth: false });
