import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-public-verify-'));
process.env.CERTFLOW_DATA_DIR = tmp;
process.env.CERTFLOW_SECRET = 'public-pages-secret-key-0123456789abcdef';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  console.log('--- 1. Testing Fixture Files ---');

  const fixturesDir = path.join(process.cwd(), 'fixtures');

  const clean25Path = path.join(fixturesDir, 'clean25.csv');
  assert(fs.existsSync(clean25Path), 'clean25.csv exists');
  const clean25Lines = fs.readFileSync(clean25Path, 'utf8').trim().split('\n');
  assert(clean25Lines.length === 26, `clean25.csv has 25 rows + header, got ${clean25Lines.length}`);
  const cleanHeader = clean25Lines[0];
  assert(cleanHeader === 'Name,Email,Event,Award,Date', `clean25 header: ${cleanHeader}`);
  console.log('  ok clean25.csv has 25 diverse participants');

  const dirtyPath = path.join(fixturesDir, 'dirty.csv');
  assert(fs.existsSync(dirtyPath), 'dirty.csv exists');
  const dirtyContent = fs.readFileSync(dirtyPath, 'utf8');
  assert(dirtyContent.includes('missing.name'), 'dirty.csv has missing names');
  assert(dirtyContent.includes('invalid-email-no-at'), 'dirty.csv has invalid emails');
  assert(dirtyContent.includes('ian.malcolm@example.com'), 'dirty.csv has duplicate entries');
  console.log('  ok dirty.csv has invalid rows and duplicates');

  const shuffledPath = path.join(fixturesDir, 'shuffled-columns.csv');
  assert(fs.existsSync(shuffledPath), 'shuffled-columns.csv exists');
  const shuffledHeader = fs.readFileSync(shuffledPath, 'utf8').trim().split('\n')[0];
  assert(shuffledHeader.includes('Prize / Category') && shuffledHeader.includes('E-Mail Address'), 'shuffled-columns has unconventional headings');
  console.log('  ok shuffled-columns.csv has unconventional column order');

  const awardsPath = path.join(fixturesDir, 'awards.csv');
  assert(fs.existsSync(awardsPath), 'awards.csv exists');
  const awardsContent = fs.readFileSync(awardsPath, 'utf8');
  const expectedAwards = [
    '1st Prize', '2nd Prize', '3rd Prize', 'Best UI',
    'Best Pitch', 'Honourable Mention', 'Participation', 'Special Mention',
  ];
  for (const aw of expectedAwards) {
    assert(awardsContent.includes(aw), `awards.csv includes "${aw}"`);
  }
  const aaravCount = (awardsContent.match(/Aarav Sharma/g) || []).length;
  assert(aaravCount >= 3, `Aarav Sharma has multiple awards (${aaravCount})`);
  console.log('  ok awards.csv covers all 8 awards and multi-award recipients');

  const longNamesPath = path.join(fixturesDir, 'long-names.csv');
  assert(fs.existsSync(longNamesPath), 'long-names.csv exists');
  const longNamesContent = fs.readFileSync(longNamesPath, 'utf8');
  assert(longNamesContent.includes('Wolfeschlegelsteinhausenbergerdorff'), 'long-names has extreme long names');
  assert(longNamesContent.includes('José Ignacio') && longNamesContent.includes('Châteaubriant'), 'long-names has accented Latin names');
  assert(longNamesContent.includes('अनन्या शर्मा') && longNamesContent.includes('विहान कृष्णमूर्ति'), 'long-names has Devanagari script names');
  console.log('  ok long-names.csv has extreme length, accented, and non-Latin scripts');

  console.log('\n--- 2. Testing Public Verification API & Logic ---');
  const { openDb, run } = await import('../../src/lib/db');
  const { getCertByVerifyCode } = await import('../../src/lib/db/repo');
  const { certToken } = await import('../../src/lib/secrets/crypto');
  const { publicCertInfo, createTicket } = await import('../../src/lib/tickets/tickets');
  const { issueYearMonth, linkedInAddToProfileUrl, linkedInShareUrl } = await import('../../src/lib/share/linkedin');

  const db = openDb();
  const now = new Date().toISOString();

  const orgId = 'org_test_public';
  run(db, 'INSERT INTO organizers (id, email, name, created_at) VALUES (?, ?, ?, ?)', orgId, 'org@test.com', 'Acme Coding Academy', now);
  run(db, "INSERT INTO settings (organizer_id, key, value, encrypted) VALUES (?, 'org', ?, 0)", orgId, JSON.stringify({ name: 'Acme Coding Academy', linkedInEnabled: true }));

  const batchId = 'batch_test_public';
  const configJson = JSON.stringify({
    organizationName: 'Acme Coding Academy',
    templates: {},
    scheme: { id: 's', name: 'Default', awardColumns: [], categories: [], defaultTemplateId: 'builtin:classic', multiAward: 'first-match', delivery: 'one-email' },
    issuedAt: '2026-03-14T00:00:00.000Z',
  });
  run(db, "INSERT INTO batches (id, organizer_id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'SENT', ?, ?, ?)", batchId, orgId, 'Test Batch', configJson, now, now);

  const recordId = 'rec_test_public';
  const values = {
    NAME: 'Rohan Mehta',
    EMAIL: 'rohan.mehta@example.edu',
    EVENT: 'HackFest 2026',
    DATE: '2026-03-14',
    CERTIFICATE_TYPE: '1st Prize',
    ACHIEVEMENT: 'Best Overall Project',
  };
  run(db, 'INSERT INTO records (id, batch_id, row_number, person_key, email, email_source, values_json) VALUES (?, ?, 1, ?, ?, ?, ?)',
    recordId, batchId, 'p_rohan', values.EMAIL, 'primary', JSON.stringify(values));

  const certId = 'cert_test_public_1';
  const verifyCode = 'TEST-CODE-0001';
  run(db, `INSERT INTO certificates (id, batch_id, organizer_id, record_id, person_key, category_id, category_label, template_id, dup_key, verify_code, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'cat1', '1st Prize', 'builtin:classic', 'dup1', ?, 'SENT', ?, ?)`,
    certId, batchId, orgId, recordId, 'p_rohan', verifyCode, now, now);

  const cert = getCertByVerifyCode(db, verifyCode);
  assert(cert && cert.id === certId, 'getCertByVerifyCode finds the certificate');
  assert(getCertByVerifyCode(db, verifyCode.toLowerCase())?.id === certId, 'lookup is case-insensitive');
  console.log('  ok getCertByVerifyCode works as expected');

  const token = certToken(certId);
  const info = publicCertInfo(db, token);
  assert(info.name === 'Rohan Mehta', `info.name matches (${info.name})`);
  assert(info.event === 'HackFest 2026', `info.event matches (${info.event})`);
  assert(info.award === '1st Prize', `info.award matches (${info.award})`);
  assert(info.organizationName === 'Acme Coding Academy', `info.organizationName matches (${info.organizationName})`);
  assert(info.verifyCode === verifyCode, 'info.verifyCode matches');
  console.log('  ok publicCertInfo returns valid certificate details');

  const ym = issueYearMonth(info.date, new Date());
  assert(ym.year === 2026 && ym.month === 3, 'issueYearMonth correctly parsed 2026-03');
  const linkedInUrl = linkedInAddToProfileUrl({
    name: '1st Prize - HackFest 2026',
    organizationName: info.organizationName,
    issueYear: ym.year,
    issueMonth: ym.month,
    certUrl: info.verifyUrl,
    certId: verifyCode,
  });
  assert(linkedInUrl.includes('name=1st+Prize+-+HackFest+2026') || linkedInUrl.includes('name=1st%20Prize%20-%20HackFest%202026'), 'LinkedIn add url has title');
  assert(linkedInUrl.includes(`certId=${verifyCode}`), 'LinkedIn add url has verify code');
  assert(linkedInShareUrl(info.verifyUrl).includes(encodeURIComponent(info.verifyUrl)), 'LinkedIn share url valid');
  console.log('  ok LinkedIn URLs correctly generated');

  const tkt = createTicket(db, token, { category: 'name', suggested: 'Rohan A. Mehta', note: 'Middle initial added' }, 'client_test_1');
  assert(tkt && tkt.id, 'ticket created successfully');
  const updatedInfo = publicCertInfo(db, token);
  assert(updatedInfo.openTicket === true, 'openTicket flag is true after ticket submission');
  console.log('  ok ticket creation and openTicket flag work properly');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nPUBLIC STUDENT PAGES & FIXTURES OK');
}

main().catch((err) => {
  console.error(`FAIL: ${(err as Error).stack ?? String(err)}`);
  process.exit(1);
});
