'use client';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  noRedirect?: boolean;
}

export async function api<T = Record<string, unknown>>(url: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.json !== undefined || opts.form ? 'POST' : 'GET'),
      headers: opts.json !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Could not reach Facilify. Check that it is still running, then try again.', 0);
  }
  if (res.status === 401 && !opts.noRedirect && typeof window !== 'undefined') {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.assign(`/login?next=${next}`);
    throw new ApiError('Please sign in again.', 401);
  }
  const type = res.headers.get('content-type') ?? '';
  const body: unknown = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new ApiError(msg || `Something went wrong (error ${res.status}). Please try again.`, res.status);
  }
  return body as T;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export async function uploadFile(file: File, kind: 'sheet' | 'template' | 'font'): Promise<{ id: string; mime: string; name: string }> {
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', file);
  return api<{ id: string; mime: string; name: string }>('/api/uploads', { form });
}
