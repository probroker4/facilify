import crypto from 'node:crypto';
import { derivedKey } from '@/lib/secrets/crypto';

export interface ReceiptFacts { code: string; issuedAt: string; sha256: string; name: string; award: string; event: string; issuer: string }
export interface SignedReceipt { algorithm: 'Ed25519'; message: string; signature: string; publicKey: string }

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function keyPair() {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, derivedKey('issue-signing-ed25519')]), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function receiptMessage(f: ReceiptFacts): string {
  return JSON.stringify({ v: 1, code: f.code, issuedAt: f.issuedAt, sha256: f.sha256, name: f.name, award: f.award, event: f.event, issuer: f.issuer });
}

export function publicKeyRaw(): string {
  const der = keyPair().publicKey.export({ format: 'der', type: 'spki' });
  return Buffer.from(der).subarray(-32).toString('base64url');
}

export function signReceipt(f: ReceiptFacts): SignedReceipt {
  const message = receiptMessage(f);
  const signature = crypto.sign(null, Buffer.from(message), keyPair().privateKey).toString('base64url');
  return { algorithm: 'Ed25519', message, signature, publicKey: publicKeyRaw() };
}

export function verifyReceipt(r: Pick<SignedReceipt, 'message' | 'signature'>): boolean {
  try { return crypto.verify(null, Buffer.from(r.message), keyPair().publicKey, Buffer.from(r.signature, 'base64url')); } catch { return false; }
}
