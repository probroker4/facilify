import type { OutboundMail } from '@/lib/contracts';
import { MappingError } from '@/lib/contracts';
import { sha256 } from '@/lib/hash';
import { readCertMeta } from '@/lib/render/render';

export interface ExpectedDelivery {
  to: string;
  personKey: string;
  certs: { certId: string; sha256: string; verifyCode: string; reportToken: string }[];
}

const VERIFY_CODE_RE = /(?<![A-Za-z0-9])[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}(?![A-Za-z0-9])/g;
const TOKEN_PATH_RE = /\/(report|linkedin)\/([^\s"'<>?#&/\\]+)/g;

function decodeForScan(s: string): string {
  let out = s.replace(/&amp;/gi, '&').replace(/&#x2f;|&#47;/gi, '/').replace(/&#x3a;|&#58;/gi, ':');
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(out); i++) {
    out = out.replace(/(?:%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } });
  }
  return out;
}

const SINGLE_ADDRESS = /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/;

export async function guardMail(mail: OutboundMail, expected: ExpectedDelivery): Promise<void> {
  const fail = (msg: string): never => { throw new MappingError(`Blocked: ${msg}`); };
  const to = mail.to.trim();
  if (!SINGLE_ADDRESS.test(to)) fail(`the recipient "${mail.to}" is not a single email address.`);
  if (to.toLowerCase() !== expected.to.trim().toLowerCase()) fail(`recipient ${mail.to} is not the student's address ${expected.to}.`);
  if (mail.personKey !== expected.personKey) fail('email is addressed to a different student record.');
  if (!expected.certs.length) fail('there is no certificate to send to this student.');

  const want = new Map(expected.certs.map((c) => [c.certId, c]));
  const got = mail.attachments.map((a) => a.certId);
  if (new Set(got).size !== got.length) fail('the same certificate is attached twice.');
  for (const id of got) if (!want.has(id)) fail(`certificate ${id} does not belong to this student.`);
  for (const id of want.keys()) if (!got.includes(id)) fail(`certificate ${id} is missing from this email.`);
  const shas = mail.attachments.map((a) => sha256(a.content));
  if (new Set(shas).size !== shas.length) fail('the same PDF is attached twice.');

  for (let i = 0; i < mail.attachments.length; i++) {
    const a = mail.attachments[i];
    const exp = want.get(a.certId)!;
    const actual = shas[i];
    if (actual !== a.sha256 || actual !== exp.sha256) fail(`certificate ${a.fileName} was changed after it was generated (fingerprint mismatch).`);
    let meta: Awaited<ReturnType<typeof readCertMeta>>;
    try {
      meta = await readCertMeta(a.content);
    } catch {
      return fail(`the attachment ${a.fileName} is not a readable certificate PDF.`);
    }
    if (meta.certId !== a.certId) fail(`the PDF ${a.fileName} belongs to certificate ${meta.certId || '(unknown)'}, not ${a.certId}.`);
    if (meta.personKey !== expected.personKey) fail(`the PDF ${a.fileName} belongs to a different student.`);
    if (meta.verifyCode && meta.verifyCode !== exp.verifyCode) fail(`the PDF ${a.fileName} carries a different verify code.`);
    if (!mail.html.includes(exp.verifyCode)) fail(`the email does not carry the verify code for ${a.fileName}.`);
    if (!mail.html.includes(exp.reportToken)) fail(`the email's "Report a problem" link is not for ${a.fileName}.`);
  }

  const codes = new Set(expected.certs.map((c) => c.verifyCode));
  const tokens = new Set(expected.certs.map((c) => c.reportToken));
  for (const body of [mail.html, mail.text, mail.subject]) {
    const scan = decodeForScan(body);
    for (const m of scan.matchAll(VERIFY_CODE_RE)) {
      if (!codes.has(m[0])) fail(`the email mentions verify code ${m[0]}, which is not one of this student's certificates.`);
    }
    for (const m of scan.matchAll(TOKEN_PATH_RE)) {
      if (!tokens.has(m[2])) fail(`the email's ${m[1] === 'report' ? '"Report a problem"' : 'LinkedIn'} link belongs to another certificate.`);
    }
  }
}
