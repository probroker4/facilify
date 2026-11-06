import { openDb, type DB } from '@/lib/db';
import { HttpError, requireOrganizer } from '@/lib/auth/session';
import { readUpload, UploadError } from '@/lib/secrets/uploads';
import type { OrganizerRow } from '@/lib/db/repo';
import type { CertTemplate, TextLayer } from '@/lib/contracts';
import { builtinBackground, BUILTIN_BACKGROUNDS } from '@/lib/render';
import { ServerFontProvider } from '@/lib/fonts/server';
import { baseUrl } from '@/lib/paths';

export const PREVIEW_VERIFY_CODE = 'PREVIEW';
export function previewVerifyUrl(): string {
  return `${baseUrl()}/verify/${PREVIEW_VERIFY_CODE}`;
}

let provider: ServerFontProvider | null = null;
export function fonts(): ServerFontProvider {
  if (!provider) provider = new ServerFontProvider();
  return provider;
}

export function auth(req: Request): { db: DB; org: OrganizerRow } {
  const db = openDb();
  return { db, org: requireOrganizer(db, req) };
}

export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400 });
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[editor api]', e);
  return Response.json({ error: `Something went wrong while drawing the certificate: ${msg}` }, { status: 500 });
}

export class BadRequest extends Error {}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new BadRequest('The request was not valid JSON.');
  }
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function checkTemplate(t: unknown): CertTemplate {
  const tpl = t as CertTemplate;
  if (!tpl || typeof tpl !== 'object') throw new BadRequest('Missing template.');
  if (!Array.isArray(tpl.pageSize) || tpl.pageSize.length !== 2 || !tpl.pageSize.every(num) || tpl.pageSize.some((n) => n < 10 || n > 5000)) {
    throw new BadRequest('The template page size is not valid.');
  }
  if (!Array.isArray(tpl.layers) || tpl.layers.length > 100) throw new BadRequest('The template has too many text boxes (max 100).');
  for (const l of tpl.layers as TextLayer[]) {
    if (!l || typeof l.content !== 'string' || ![l.x, l.y, l.width, l.height].every(num) || !l.style || typeof l.style.fontId !== 'string') {
      throw new BadRequest('One of the text boxes is not valid.');
    }
    if (l.content.length > 5000) throw new BadRequest('A text box has too much text.');
    if (l.width <= 0 || l.height <= 0) throw new BadRequest('A text box must have a width and a height.');
    const st = l.style;
    if (![st.size, st.minSize, st.letterSpacing, st.lineHeight, st.opacity, st.rotation, st.maxLines].every(num) || st.size < 1 || st.size > 1000) {
      throw new BadRequest('A text style has a number that is not valid.');
    }
    if (typeof st.color !== 'string' || !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(st.color)) throw new BadRequest('A text colour must look like #1f3a5f.');
    if (!['left', 'center', 'right'].includes(st.align)) throw new BadRequest('A text alignment is not valid.');
    if (!st.fit || typeof st.fit !== 'object' || !num(st.fit.minLetterSpacing) || !['shrink', 'wrap', 'shrink-then-wrap'].includes(st.fit.mode)) {
      throw new BadRequest('A text box is missing its auto-fit settings.');
    }
  }
  if (tpl.qr !== undefined) {
    const q = tpl.qr as { x?: unknown; y?: unknown; size?: unknown };
    if (!q || typeof q !== 'object' || ![q.x, q.y, q.size].every(num) || (q.size as number) < 20 || (q.size as number) > 600) {
      throw new BadRequest('The QR code placement is not valid.');
    }
  }
  if (!['builtin', 'pdf', 'image'].includes(tpl.kind)) throw new BadRequest('Unknown template type.');
  return tpl;
}

export function checkValues(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val == null) continue;
      out[k] = String(val).slice(0, 2000);
    }
  }
  return out;
}

export function previewValues(v: unknown): Record<string, string> {
  return { VERIFY_CODE: PREVIEW_VERIFY_CODE, ...checkValues(v) };
}

export function builtinId(ref: string): string | null {
  const id = ref.replace(/^builtin:/, '');
  return BUILTIN_BACKGROUNDS.some((b) => b.id === id) ? id : null;
}

export type BgType = 'pdf' | 'png' | 'jpg';

export async function templateBackground(db: DB, organizerId: string, t: CertTemplate): Promise<{ bytes: Uint8Array | null; type?: BgType }> {
  if (t.kind === 'builtin') return { bytes: await builtinBackground(t.backgroundRef ?? 'classic'), type: 'pdf' };
  if (!t.backgroundRef) return { bytes: null };
  const up = readUpload(db, organizerId, t.backgroundRef);
  return { bytes: up.bytes, type: up.mime === 'application/pdf' ? 'pdf' : up.mime === 'image/png' ? 'png' : 'jpg' };
}

export async function backgroundByRef(db: DB, organizerId: string, ref: string): Promise<{ bytes: Uint8Array; type: BgType }> {
  const b = builtinId(ref);
  if (b) return { bytes: await builtinBackground(b), type: 'pdf' };
  if (!/^up_[A-Za-z0-9_-]+$/.test(ref)) throw new BadRequest('Unknown template background.');
  const up = readUpload(db, organizerId, ref);
  if (up.kind !== 'template') throw new BadRequest('That file is not a certificate template.');
  return { bytes: up.bytes, type: up.mime === 'application/pdf' ? 'pdf' : up.mime === 'image/png' ? 'png' : 'jpg' };
}

export function pngResponse(png: Uint8Array | Buffer, extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', ...extra },
  });
}

export function clampScale(v: unknown, def = 1.5): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(3, Math.max(0.25, n));
}
