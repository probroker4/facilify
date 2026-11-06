import { openDb, type DB } from '@/lib/db/db';
import type { OrganizerRow } from '@/lib/db/repo';
import { requireOrganizer } from './session';

const STATUS_BY_NAME: Record<string, number> = {
  BadRequest: 400,
  ValidationError: 400,
  UploadError: 400,
  SyntaxError: 400,
  MappingError: 409,
  TransitionError: 409,
};

function statusOf(e: unknown): number | null {
  if (e && typeof e === 'object') {
    const s = (e as { status?: unknown }).status;
    if (typeof s === 'number' && Number.isInteger(s) && s >= 400 && s <= 599) return s;
    const name = (e as { name?: unknown }).name;
    if (typeof name === 'string' && STATUS_BY_NAME[name]) return STATUS_BY_NAME[name];
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function apiError(e: unknown): Response {
  const status = statusOf(e);
  if (status !== null && status < 500) {
    const message = e instanceof Error && e.message ? e.message : 'The request could not be completed.';
    const retryAfter = (e as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
    return jsonResponse({ error: message }, status, typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : undefined);
  }
  console.error('[api error]', e instanceof Error ? e.stack ?? e.message : e);
  if (status !== null && e instanceof Error && e.name === 'HttpError') return jsonResponse({ error: e.message }, status);
  return jsonResponse({ error: 'Something went wrong on our side. Please try again.' }, status ?? 500);
}

export interface ApiContext<P extends Record<string, string> = Record<string, string>> {
  req: Request;
  db: DB;
  params: P;
}
export interface AuthedApiContext<P extends Record<string, string> = Record<string, string>> extends ApiContext<P> {
  org: OrganizerRow;
}

type Result = Response | Record<string, unknown> | unknown[] | void | null;
type RouteContext<P> = { params?: Promise<P> | P };

export function withApi<P extends Record<string, string> = Record<string, string>>(
  handler: (ctx: AuthedApiContext<P>) => Promise<Result> | Result,
  opts?: { auth?: true },
): (req: Request, ctx?: RouteContext<P>) => Promise<Response>;
export function withApi<P extends Record<string, string> = Record<string, string>>(
  handler: (ctx: ApiContext<P>) => Promise<Result> | Result,
  opts: { auth: false },
): (req: Request, ctx?: RouteContext<P>) => Promise<Response>;
export function withApi<P extends Record<string, string> = Record<string, string>>(
  handler: (ctx: AuthedApiContext<P>) => Promise<Result> | Result,
  opts: { auth?: boolean } = {},
): (req: Request, ctx?: RouteContext<P>) => Promise<Response> {
  return async (req, routeCtx) => {
    try {
      const db = openDb();
      const org = opts.auth === false ? undefined : requireOrganizer(db, req);
      const params = ((await routeCtx?.params) ?? {}) as P;
      const out = await handler({ req, db, org: org as OrganizerRow, params });
      if (out instanceof Response) return out;
      return jsonResponse(out ?? { ok: true });
    } catch (e) {
      return apiError(e);
    }
  };
}

export async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw Object.assign(new Error('The request was not valid JSON.'), { status: 400, name: 'BadRequest' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('The request body must be a JSON object.'), { status: 400, name: 'BadRequest' });
  }
  return body as T;
}
