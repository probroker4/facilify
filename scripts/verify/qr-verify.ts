import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CERTFLOW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'facilify-qr-'));
process.env.CERTFLOW_SECRET = crypto.randomBytes(24).toString('hex');

let checks = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } checks++; console.log(`  ok ${m}`); };

async function main() {
  const { signReceipt, verifyReceipt, receiptMessage, publicKeyRaw } = await import('../../src/lib/attest');
  const facts = { code: 'ABCD-1234', issuedAt: '2026-03-12T10:00:00.000Z', sha256: 'a'.repeat(64), name: 'Ada Lovelace', award: 'Winner', event: 'Hack the Future 2026', issuer: 'Tech Club' };
  const r = signReceipt(facts);
  ok(verifyReceipt(r), 'a signed receipt verifies');
  ok(signReceipt(facts).signature === r.signature, 'the signature is deterministic (same facts, same signature)');
  ok(r.message === receiptMessage(facts) && JSON.parse(r.message).issuedAt === facts.issuedAt, 'the signed text carries the issue time');
  for (const k of Object.keys(facts) as (keyof typeof facts)[]) {
    const bad = signReceipt({ ...facts, [k]: `${facts[k]}x` });
    ok(!verifyReceipt({ message: bad.message, signature: r.signature }), `changing "${k}" breaks the signature`);
  }
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyRaw(), 'base64url')]);
  const pub = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  ok(crypto.verify(null, Buffer.from(r.message), pub, Buffer.from(r.signature, 'base64url')), 'the published public key alone verifies the signature');

  const { renderCertificate, builtinTemplate, builtinBackground } = await import('../../src/lib/render');
  const { fonts } = await import('../../src/lib/pipeline/services');
  const { rasterizePdf } = await import('../../src/lib/render/raster');
  const bg = await builtinBackground('classic');
  const make = async (qr?: { x: number; y: number; size: number }) => {
    const template = { ...builtinTemplate('classic'), ...(qr ? { qr } : {}) };
    const out = await renderCertificate({
      template, background: bg, backgroundType: 'pdf', values: { NAME: 'Ada Lovelace', EVENT: 'Hack the Future', CERTIFICATE_TYPE: 'Winner', ACHIEVEMENT: 'First', DATE: '12 March 2026' },
      certId: 'c1', recordId: 'r1', personKey: 'id:1', verifyCode: 'ABCD-1234', verifyUrl: 'http://localhost:3000/verify/ABCD-1234', fileName: 'a.pdf', issuedAt: new Date('2026-03-12T10:00:00Z'),
    }, fonts());
    return rasterizePdf(out.pdf, 2);
  };
  const dark = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number, s: number) => {
    let n = 0, t = 0;
    for (let yy = Math.round(y * 2); yy < Math.round((y + s) * 2); yy++) for (let xx = Math.round(x * 2); xx < Math.round((x + s) * 2); xx++) { const i = (yy * img.width + xx) * 4; t++; if (img.data[i] < 80 && img.data[i + 1] < 80 && img.data[i + 2] < 80) n++; }
    return n / t;
  };
  const place = { x: 690, y: 450, size: 100 };
  const without = await make();
  const withQr = await make(place);
  ok(dark(without, place.x, place.y, place.size) < 0.01, 'no QR on a template that did not ask for one');
  const d = dark(withQr, place.x, place.y, place.size);
  ok(d > 0.25 && d < 0.65, `a QR pattern is stamped where placed (${Math.round(d * 100)}% dark)`);
  console.log(`${checks} checks passed`);
  console.log('QR VERIFY OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
