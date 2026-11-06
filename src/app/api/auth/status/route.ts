import { get, openDb } from '@/lib/db/db';
import { googleConfigured } from '@/lib/auth/google';
import { passwordLoginEnabled } from '@/lib/auth/session';
import { withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const n = get<{ n: number }>(openDb(), 'SELECT COUNT(*) AS n FROM organizers')?.n ?? 0;
  return { hasOrganizer: n > 0, googleConfigured: googleConfigured(), passwordLogin: passwordLoginEnabled() };
}, { auth: false });
