import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-core-'));
process.env.CERTFLOW_DATA_DIR = tmp;
process.env.CERTFLOW_SECRET = 'core-integration-secret-0123456789abcdef';

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

const CLEAN = [
  'Participant,Roll No,College Email,Personal Email,Event,Award,Achievement,Date',
  ...Array.from({ length: 25 }, (_, i) => {
    const awards = ['1st Prize', 'Second Prize', 'Hon. Mention', 'Best UI', 'Participation'];
    const name = i === 3 ? 'Venkata Satya Sai Krishna Prasad Subrahmanyam' : i === 7 ? 'अनन्या शर्मा' : i === 9 ? 'José Núñez' : `Student ${String(i + 1).padStart(2, '0')}`;
    return `${name},S${1000 + i},s${i}@college.edu,p${i}@mail.com,HackFest 2026,${awards[i % awards.length]},building a project,2026-11-04`;
  }),
  'Student 02,S1001,s1@college.edu,p1@mail.com,HackFest 2026,Best Pitch,great pitch,2026-11-04',
].join('\n');

async function main() {
  const { parseSheet, suggestMappings, matchTypedHeading, validateSheet } = await import('../../src/lib/ingest');
  const { discoverCategories, schemeFromDiscovery, assignCertificates } = await import('../../src/lib/routing');
  const { renderCertificate, builtinTemplate, builtinBackground, readCertMeta, certFileName } = await import('../../src/lib/render');
  const { pdfTextItems } = await import('../../src/lib/render/raster');
  const { ServerFontProvider } = await import('../../src/lib/fonts/server');
  const { composeEmail, guardMail } = await import('../../src/lib/mail');
  const { buildShareLinks } = await import('../../src/lib/share');
  const { certToken, verifyCodeFor } = await import('../../src/lib/secrets/crypto');

  const sheet = parseSheet(new TextEncoder().encode(CLEAN), 'clean.csv');
  const sugg = suggestMappings(sheet.headers);
  const col = (ph: string) => sugg.find((m) => m.placeholder === ph)?.column ?? null;
  if (col('EMAIL') !== 'College Email') fail(`EMAIL mapped to ${col('EMAIL')}`);
  if (col('ID') !== 'Roll No') fail(`ID mapped to ${col('ID')}`);
  const typedName = matchTypedHeading('participant', sheet.headers, 'NAME');
  if (typedName.column !== 'Participant') fail(`typed "participant" -> ${typedName.column}`);
  const mapping = [
    { placeholder: 'NAME', column: 'Participant' }, { placeholder: 'ID', column: 'Roll No' }, { placeholder: 'EVENT', column: 'Event' },
    { placeholder: 'CERTIFICATE_TYPE', column: 'Award' }, { placeholder: 'ACHIEVEMENT', column: 'Achievement' }, { placeholder: 'DATE', column: 'Date' },
  ];
  const v = validateSheet(sheet, { batchId: 'b1', mapping, email: { primary: 'College Email', fallback: 'Personal Email' }, required: ['EVENT'], awardColumns: ['Award'] });
  if (v.invalid.length) fail(`clean sheet had invalid rows: ${JSON.stringify(v.invalid.slice(0, 3))}`);
  if (v.valid.length !== 26) fail(`expected 26 valid rows, got ${v.valid.length}`);

  const groups = discoverCategories(sheet.rows, ['Award']);
  if (groups.length !== 6) fail(`expected 6 award categories, got ${groups.map((g) => g.label).join(' | ')}`);
  const tplFor: Record<string, string> = { '1st': 'gold', '2nd': 'silver', 'honorable mention': 'mention' };
  const scheme = schemeFromDiscovery('s1', 'Hack', ['Award'], groups, (g) => `builtin:${tplFor[g.key] ?? 'participation'}`, { multiAward: 'all-matches', delivery: 'one-email' });
  const routed = assignCertificates(v.valid, scheme);
  if (routed.issues.length) fail(`routing issues: ${JSON.stringify(routed.issues)}`);
  if (routed.assignments.length !== 26) fail(`expected 26 certificates, got ${routed.assignments.length}`);

  const fonts = new ServerFontProvider();
  const recById = new Map(v.valid.map((r) => [r.recordId, r]));
  const rendered = new Map<string, { pdf: Uint8Array; sha256: string; fileName: string; verifyCode: string; label: string; templateId: string }>();
  for (const a of routed.assignments) {
    const rec = recById.get(a.recordId)!;
    const cat = scheme.categories.find((c) => c.id === a.categoryId)!;
    const t = builtinTemplate(a.templateId.replace('builtin:', ''));
    const verifyCode = verifyCodeFor(a.certId);
    const values: Record<string, string> = { ...rec.values, CERTIFICATE_TYPE: cat.label, VERIFY_CODE: verifyCode };
    const r = await renderCertificate({
      template: t, background: await builtinBackground(t.backgroundRef!), values, certId: a.certId, recordId: a.recordId, personKey: a.personKey,
      verifyCode, verifyUrl: `http://x/verify/${verifyCode}`, fileName: certFileName({ event: values.EVENT, id: values.ID, name: values.NAME, category: cat.label }),
    }, fonts);
    for (const [lid, fit] of Object.entries(r.fits)) if (fit.overflow) fail(`overflow in ${lid} for ${values.NAME}`);
    const text = (await pdfTextItems(r.pdf)).map((i) => i.str).join(' ').replace(/\s+/g, ' ');
    const firstName = values.NAME.split(' ')[0];
    if (!/[ऀ-ॿ]/.test(values.NAME) && !text.includes(firstName)) fail(`PDF for ${values.NAME} does not contain the name; text="${text.slice(0, 120)}"`);
    if (text.includes('{{')) fail(`unfilled placeholder in ${values.NAME}`);
    const meta = await readCertMeta(r.pdf);
    if (meta.certId !== a.certId || meta.personKey !== a.personKey) fail(`PDF identity mismatch for ${values.NAME}`);
    if (a.templateId !== `builtin:${tplFor[groups.find((g) => g.values.includes(rec.values.CERTIFICATE_TYPE) || g.values.includes(rec.values.Award))?.key ?? ''] ?? 'participation'}`
      && !(rec.values.Award === 'Best Pitch' || rec.values.Award === 'Best UI' || rec.values.Award === 'Participation')) fail(`wrong template for ${values.NAME}: ${a.templateId}`);
    rendered.set(a.certId, { pdf: r.pdf, sha256: r.sha256, fileName: r.fileName, verifyCode, label: cat.label, templateId: a.templateId });
  }

  const byPerson = new Map<string, typeof routed.assignments>();
  for (const a of routed.assignments) byPerson.set(a.personKey, [...(byPerson.get(a.personKey) ?? []), a]);
  if (byPerson.size !== 25) fail(`expected 25 people, got ${byPerson.size}`);
  const mails: { mail: Awaited<ReturnType<typeof composeEmail>>; expected: Parameters<typeof guardMail>[1] }[] = [];
  for (const [personKey, list] of byPerson) {
    const rec = recById.get(list[0].recordId)!;
    const certs = list.map((a) => {
      const r = rendered.get(a.certId)!;
      const links = buildShareLinks({ title: r.label, organizationName: 'Tech Club', dateText: rec.values.DATE, issuedAt: new Date(), verifyUrl: `http://x/verify/${r.verifyCode}`, verifyCode: r.verifyCode, customizeUrl: `http://x/linkedin/${certToken(a.certId)}` });
      return { certId: a.certId, fileName: r.fileName, pdf: r.pdf, sha256: r.sha256, verifyCode: r.verifyCode, verifyUrl: `http://x/verify/${r.verifyCode}`, categoryLabel: r.label,
        linkedInAddUrl: links.addToProfile, linkedInShareUrl: links.share, linkedInCustomizeUrl: links.customize, reportUrl: `http://x/report/${certToken(a.certId)}` };
    });
    const mail = composeEmail({ template: { id: 'e', subject: 'Your certificate for {{EVENT}}', html: '<p>Dear {{NAME}}</p>', includeDriveLink: false, includeLinkedIn: true },
      values: rec.values, to: rec.email, personKey, certs, organizationName: 'Tech Club', messageId: `<m-${personKey}@x>` });
    const expected = { to: rec.email, personKey, certs: list.map((a) => ({ certId: a.certId, sha256: rendered.get(a.certId)!.sha256, verifyCode: rendered.get(a.certId)!.verifyCode, reportToken: certToken(a.certId) })) };
    await guardMail(mail, expected);
    if (mail.to !== rec.email) fail('recipient mismatch');
    if (!mail.html.includes(`Dear ${rec.values.NAME.replace(/&/g, '&amp;')}`) && !/[ऀ-ॿ]/.test(rec.values.NAME)) fail(`email not personalized for ${rec.values.NAME}`);
    const addUrl = new URL(certs[0].linkedInAddUrl!.replace(/&amp;/g, '&'));
    if (addUrl.searchParams.get('certId') !== certs[0].verifyCode) fail('LinkedIn certId does not equal the PDF verify code');
    mails.push({ mail, expected });
  }
  const multi = mails.find((m) => m.mail.attachments.length === 2);
  if (!multi) fail('the person with two awards did not get one email with both certificates');
  const [a, b] = mails.filter((m) => m.mail.attachments.length === 1);
  const swapped = { ...a.mail, attachments: b.mail.attachments };
  let blocked = false;
  try { await guardMail(swapped, a.expected); } catch { blocked = true; }
  if (!blocked) fail('guard allowed a swapped attachment');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`checked ${mails.length} emails, ${rendered.size} certificates`);
  console.log('CORE INTEGRATION OK');
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
