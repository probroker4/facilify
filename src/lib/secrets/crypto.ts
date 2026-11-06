import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/paths';

let cached: Buffer | null = null;
export function masterSecret(): Buffer {
  if (cached) return cached;
  const env = process.env.CERTFLOW_SECRET;
  if (env !== undefined && env !== '') {
    if (env.length < 32) throw new Error('CERTFLOW_SECRET must be at least 32 characters long.');
    return (cached = crypto.createHash('sha256').update(env).digest());
  }
  const file = path.join(dataDir(), 'secret.key');
  const fromFile = readKeyFile(file);
  if (fromFile) return (cached = fromFile);
  const fresh = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, fresh.toString('base64'), { mode: 0o600, flag: 'wx' });
    return (cached = fresh);
  } catch (e) {
    const other = readKeyFile(file);
    if (other) return (cached = other);
    throw e;
  }
}

function readKeyFile(file: string): Buffer | null {
  try {
    const b = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

function subKey(purpose: string): Buffer {
  return crypto.createHmac('sha256', masterSecret()).update(`certflow:${purpose}`).digest();
}

export function derivedKey(purpose: string): Buffer {
  return subKey(purpose);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', subKey('enc'), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':');
  const [v, iv, tag, ct] = parts;
  if (parts.length !== 4 || v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unrecognized secret format');
  const ivBuf = Buffer.from(iv, 'base64url');
  const tagBuf = Buffer.from(tag, 'base64url');
  if (ivBuf.length !== 12 || tagBuf.length !== 16) throw new Error('Unrecognized secret format');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', subKey('enc'), ivBuf, { authTagLength: 16 });
    decipher.setAuthTag(tagBuf);
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('A stored secret could not be decrypted (wrong CERTFLOW_SECRET or tampered data).');
  }
}

export function hmac(purpose: string, data: string): string {
  return crypto.createHmac('sha256', subKey(purpose)).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function verifyCodeFor(certId: string): string {
  const bytes = crypto.createHmac('sha256', subKey('verify')).update(certId).digest();
  let out = '';
  for (let i = 0; i < 12; i++) out += B32[bytes[i] % B32.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function certToken(certId: string): string {
  return `${certId}.${hmac('cert-link', certId).slice(0, 22)}`;
}

export function readCertToken(token: string | null | undefined): string | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const certId = token.slice(0, dot);
  return safeEqual(token, certToken(certId)) ? certId : null;
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}
