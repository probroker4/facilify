import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 32;
const MAX_PASSWORD = 1024;

export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD) {
    throw new Error('Invalid password.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, KEY_LEN, PARAMS);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD) return false;
  const [kind, salt, hash, extra] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash || extra !== undefined) return false;
  const expected = Buffer.from(hash, 'base64url');
  const saltBuf = Buffer.from(salt, 'base64url');
  if (expected.length !== KEY_LEN || saltBuf.length < 16) return false;
  try {
    const actual = crypto.scryptSync(password.normalize('NFKC'), saltBuf, KEY_LEN, PARAMS);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters for the password.';
  if (password.length > MAX_PASSWORD) return 'That password is too long.';
  return null;
}
