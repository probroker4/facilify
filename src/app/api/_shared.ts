import type { DB } from '@/lib/db/db';
import { HttpError } from '@/lib/auth/session';

import { withApi as baseWithApi, type ApiContext, type AuthedApiContext } from '@/lib/auth/http';
export { readJsonBody } from '@/lib/auth/http';

type Result = Response | Record<string, unknown> | unknown[] | void | null;
type Params = Record<string, string>;
type RouteCtx<P> = { params: Promise<P> };

export function withApi<P extends Params = Params>(
  handler: (ctx: AuthedApiContext<P>) => Promise<Result> | Result,
  opts?: { auth?: true },
): (req: Request, ctx: RouteCtx<P>) => Promise<Response>;
export function withApi<P extends Params = Params>(
  handler: (ctx: ApiContext<P>) => Promise<Result> | Result,
  opts: { auth: false },
): (req: Request, ctx: RouteCtx<P>) => Promise<Response>;
export function withApi<P extends Params = Params>(
  handler: (ctx: AuthedApiContext<P>) => Promise<Result> | Result,
  opts: { auth?: boolean } = {},
): (req: Request, ctx: RouteCtx<P>) => Promise<Response> {
  const run = baseWithApi<P>(handler as never, opts as never);
  return (req, ctx) => run(req, ctx);
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

export type { DB };

export function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`Please provide ${what}.`);
  return value.trim();
}

export function plainText(value: unknown, max = 200): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
