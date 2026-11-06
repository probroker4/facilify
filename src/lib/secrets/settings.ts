import type { DB } from '@/lib/db/db';
import { getSetting, setSetting } from '@/lib/db/repo';

export interface SmtpInput { host: string; port: number; secure: boolean; user?: string; from: string; dailyLimit?: number; pass?: string }
export interface SenderInput { kind: 'capture' | 'smtp' | 'gmail'; smtp?: SmtpInput }

const SECRET_KEY = /pass(word)?|secret|token|refresh|api[_-]?key|authorization|credential/i;
const SAFE_KEYS = new Set(['hasPassword']);

export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) && !SAFE_KEYS.has(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}

export function saveSender(db: DB, organizerId: string, input: SenderInput): void {
  if (input.kind === 'smtp' && input.smtp) {
    const { pass, ...rest } = input.smtp;
    if (typeof pass === 'string' && pass.length > 0) setSetting(db, organizerId, 'smtp.pass', pass, true);
    setSetting(db, organizerId, 'sender', { kind: 'smtp', smtp: rest });
  } else {
    setSetting(db, organizerId, 'sender', { kind: input.kind });
  }
}

export function publicSender(db: DB, organizerId: string): { kind: string; smtp?: Omit<SmtpInput, 'pass'> & { hasPassword: boolean } } {
  const s = getSetting<{ kind: string; smtp?: SmtpInput }>(db, organizerId, 'sender') ?? { kind: 'capture' };
  if (!s.smtp) return { kind: s.kind };
  const { pass: _pass, ...rest } = s.smtp;
  void _pass;
  return { kind: s.kind, smtp: { ...rest, hasPassword: !!getSetting(db, organizerId, 'smtp.pass') } };
}
