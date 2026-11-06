import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  Failure, cleanDist, http, httpBytes, must, ok, rmrf, sessionCookie, startServer, tempDir, walk, type RunningServer,
} from '../../fixtures/security/harness';
import { parseEmail, type ParsedEmail } from '../../fixtures/security/mime';

const PORT = 3106;
const DIST = '.next-e2e';
const SECRET = 'e2e-mapping-secret-0123456789abcdef0123456789';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aarav', 'Vivaan', 'Diya', 'Ananya', 'Rohan', 'Isha', 'Kabir', 'Meera', 'Arjun', 'Sana', 'Liam', 'Olivia', 'Noah', 'Emma', 'Mateo', 'Sofia', 'José', 'Zoë', 'Chloé', 'Müller', 'Fatima', 'Omar', 'Yuki', 'Hiro', 'Wei', 'Mei', 'Nikolai', 'Elena', 'Tariq', 'Amara', 'Kwame', 'Zainab', 'Lucas', 'Hannah', 'Ethan', 'Priya', 'Dev', 'Tara', 'Sven', 'Ingrid'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Nair', 'Khan', 'Singh', 'Gupta', 'Smith', 'Johnson', 'Garcia', 'Martínez', 'Brown', 'Kim', 'Nguyen', "O'Brien", 'Fernandes', 'D’Souza', 'Ivanov', 'Rossi', 'Dubois', 'Schneider', 'Okafor', 'Mensah', 'Tanaka', 'Chen', 'Wang', 'Haddad', 'Silva', 'Costa', 'Novak', 'Kowalski', 'Andersson', 'Larsen', 'Petrov', 'Murphy', 'Walker', 'Young', 'Lopez', 'Hughes'];

const CATS: Record<string, { spellings: string[]; template: string }> = {
  gold: { spellings: ['1st Prize', 'First Prize', '1st prize'], template: 'builtin:gold' },
  silver: { spellings: ['2nd Prize', 'Second Prize'], template: 'builtin:silver' },
  bronze: { spellings: ['3rd Prize', 'Third Prize'], template: 'builtin:bronze' },
  mention: { spellings: ['Honourable Mention', 'Hon. Mention'], template: 'builtin:mention' },
  bestui: { spellings: ['Best UI'], template: 'builtin:modern' },
  bestpitch: { spellings: ['Best Pitch'], template: 'builtin:elegant' },
  jury: { spellings: ['Special Jury'], template: 'builtin:classic' },
  participation: { spellings: ['Participation', 'Participant'], template: 'builtin:participation' },
};
const spellingToCat = new Map<string, string>();
for (const [k, v] of Object.entries(CATS)) for (const s of v.spellings) spellingToCat.set(s.toLowerCase().replace(/\s+/g, ' ').trim(), k);

interface TruthRow {
  excelRow: number;
  name: string; email: string; id: string; event: string; award: string; project: string; date: string;
  cats: string[];
}

function buildTruth(rows: number): { rows: TruthRow[]; people: number } {
  const rand = rng(20260314);
  const extra = Math.max(4, Math.floor(rows * 0.06));
  const multiCell = Math.max(2, Math.floor(rows * 0.008));
  const persons = rows - extra;
  const weights: [string, number][] = [['gold', 6], ['silver', 6], ['bronze', 6], ['mention', 8], ['bestui', 5], ['bestpitch', 5], ['jury', 3], ['participation', 61]];
  const pick = (): string => { let r = rand() * 100; for (const [k, w] of weights) { if ((r -= w) < 0) return k; } return 'participation'; };
  const spell = (cat: string) => CATS[cat].spellings[Math.floor(rand() * CATS[cat].spellings.length)];
  const out: Omit<TruthRow, 'excelRow'>[] = [];
  const primaries: { idx: number; cat: string }[] = [];
  for (let i = 0; i < persons; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    const name = i < FIRST.length * LAST.length ? `${first} ${last}` : `${first} ${String.fromCharCode(65 + (i % 26))}. ${last}`;
    const id = `S26-${String(i + 1).padStart(5, '0')}`;
    const cat = pick();
    primaries.push({ idx: out.length, cat });
    const eventName = i % 17 === 0 ? 'Open Source Day 2026' : 'HackFest 2026';
    out.push({ name, email: `${id.toLowerCase()}@students.example.test`, id, event: eventName, award: spell(cat), project: `Project ${id.slice(4)} ${last}`, date: '2026-03-14', cats: [cat] });
  }
  const second = ['bestui', 'bestpitch', 'jury', 'bestui'];
  let made = 0;
  for (let p = 0; p < primaries.length && made < extra; p++) {
    if (primaries[p].cat !== 'participation') continue;
    if (p % 7 !== 0 && made < extra - 1 && p < primaries.length - 1) continue;
    const base = out[primaries[p].idx];
    const cat = second[made % second.length];
    out.push({ ...base, award: spell(cat), project: `${base.project} (finals)`, cats: [cat] });
    made++;
  }
  for (let p = 0; made < extra && p < primaries.length; p++) {
    const base = out[primaries[p].idx];
    if (base.cats[0] === 'participation' && !out.some((r, i) => i >= persons && r.id === base.id)) {
      const cat = second[made % second.length];
      out.push({ ...base, award: spell(cat), project: `${base.project} (finals)`, cats: [cat] }); made++;
    }
  }
  let m = 0;
  for (let i = out.length - 1; i >= 0 && m < multiCell; i--) {
    const r = out[i];
    if (i < persons && r.cats[0] === 'participation' && !out.some((o, j) => j !== i && o.id === r.id)) {
      r.award = `${spell('participation')}; ${CATS.bestui.spellings[0]}`;
      r.cats = ['participation', 'bestui'];
      m++;
    }
  }
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  const ids = new Set(out.map((r) => r.id));
  return { rows: out.map((r, i) => ({ ...r, excelRow: i + 4 })), people: ids.size };
}

const HEADERS = ['Participant Name', 'Roll No', 'Email Address', 'Event', 'Prize / Award', 'Project', 'Date'];
function buildXlsx(rows: TruthRow[]): Buffer {
  const aoa: (string | number)[][] = [['HackFest results 2026 (final)'], [], HEADERS, ...rows.map((r) => [r.name, r.id, r.email, r.event, r.award, r.project, r.date])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Results');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

function multipart(fileName: string, bytes: Buffer, kind: string) {
  const boundary = `----e2e${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body: new Uint8Array(body), contentType: `multipart/form-data; boundary=${boundary}` };
}

const norm = (s: string) => s.normalize('NFC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const U8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

async function main() {
  const ri = process.argv.indexOf('--rows');
  const rowsWanted = ri >= 0 ? Number(process.argv[ri + 1]) : 1000;
  if (!Number.isInteger(rowsWanted) || rowsWanted < 40) throw new Failure('--rows must be an integer of at least 40');

  const dataDir = tempDir('cf-e2e-');
  process.env.CERTFLOW_DATA_DIR = dataDir;
  process.env.CERTFLOW_SECRET = SECRET;
  process.env.CERTFLOW_PASSWORD_LOGIN = '1';
  const dbm = await import('../../src/lib/db/db');
  const repo = await import('../../src/lib/db/repo');
  const sess = await import('../../src/lib/auth/session');
  const pw = await import('../../src/lib/auth/password');
  const render = await import('../../src/lib/render');
  const raster = await import('../../src/lib/render/raster');
  const folders = await import('../../src/lib/storage/folders');

  const truth = buildTruth(rowsWanted);
  const totalCerts = truth.rows.reduce((n, r) => n + r.cats.length, 0);
  const byExcelRow = new Map(truth.rows.map((r) => [r.excelRow, r]));
  const rowsOfPerson = new Map<string, TruthRow[]>();
  for (const r of truth.rows) rowsOfPerson.set(r.id, [...(rowsOfPerson.get(r.id) ?? []), r]);
  console.log(`--- e2e: ${truth.rows.length} sheet rows, ${truth.people} people, ${totalCerts} certificates, ${[...rowsOfPerson.values()].filter((v) => v.length > 1 || v[0].cats.length > 1).length} people with several awards ---`);

  const ORG = 'org_e2e', ORG_EMAIL = 'organizer@e2e.example.test';
  const db = dbm.openDb();
  dbm.run(db, 'INSERT INTO organizers (id, email, name, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', ORG, ORG_EMAIL, 'E2E Organizer', pw.hashPassword('e2e-password-123'), dbm.nowIso());
  dbm.run(db, 'INSERT INTO organizers (id, email, name, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', 'org_other', 'other@e2e.example.test', 'Other', pw.hashPassword('e2e-password-456'), dbm.nowIso());
  repo.setSetting(db, ORG, 'org', { name: 'E2E Academy', email: ORG_EMAIL, linkedInEnabled: true });
  repo.setSetting(db, ORG, 'sender', { kind: 'capture' });
  repo.setSetting(db, ORG, 'storage', 'local');
  const cookie = sessionCookie(sess.signSession(ORG));
  const otherCookie = sessionCookie(sess.signSession('org_other'));

  let server: RunningServer | null = null;
  try {
    server = await startServer({ port: PORT, distDir: DIST, dataDir, timeoutMs: 180_000, env: { CERTFLOW_SECRET: SECRET, ORGANIZER_EMAILS: undefined, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined } });
    const api = async (method: string, p: string, json?: unknown, c: string | null = cookie) => http(server!.base, p, { method, json, cookie: c, timeoutMs: 600_000 });
    const must200 = (r: { status: number; text: string }, what: string) => must(r.status >= 200 && r.status < 300, `${what} returned ${r.status}: ${r.text.slice(0, 400)}`);

    const xlsx = buildXlsx(truth.rows);
    const mp = multipart('hackfest-results.xlsx', xlsx, 'sheet');
    const up = await http(server.base, '/api/uploads', { method: 'POST', cookie, body: mp.body, headers: { 'content-type': mp.contentType } });
    must200(up, 'POST /api/uploads');
    const uploadId = up.json?.id ?? up.json?.uploadId;
    must(typeof uploadId === 'string', `upload response has no id: ${up.text.slice(0, 200)}`);
    ok(`uploaded ${truth.rows.length}-row XLSX (${(xlsx.length / 1024).toFixed(0)} KB) as ${uploadId}`);

    const parsed = await api('POST', '/api/sheets/parse', { uploadId });
    must200(parsed, 'POST /api/sheets/parse');
    must(parsed.json.rowCount === truth.rows.length, `parse found ${parsed.json.rowCount} rows, expected ${truth.rows.length}`);
    must(parsed.json.headerRowNumber === 3, `header row detected at ${parsed.json.headerRowNumber}, expected 3 (below the title row)`);
    must(JSON.stringify(parsed.json.headers) === JSON.stringify(HEADERS), `headers read as ${JSON.stringify(parsed.json.headers)}`);
    const suggestions: { placeholder: string; column: string | null }[] = parsed.json.suggestions ?? [];
    const want: Record<string, string> = { NAME: 'Participant Name', ID: 'Roll No', EMAIL: 'Email Address', EVENT: 'Event', DATE: 'Date' };
    const sugMismatch = Object.entries(want).filter(([ph, col]) => suggestions.find((s) => s.placeholder === ph)?.column !== col);
    if (sugMismatch.length) console.log(`  note header suggestions differ from the obvious mapping for: ${sugMismatch.map(([p, c]) => `${p} (expected "${c}", got ${JSON.stringify(suggestions.find((s) => s.placeholder === p)?.column ?? null)})`).join(', ')}`);
    const mapping = [...Object.entries(want).map(([placeholder, column]) => ({ placeholder, column })), { placeholder: 'ACHIEVEMENT', column: 'Project' }];

    const validate = await api('POST', '/api/sheets/validate', { uploadId, mapping, email: { primary: 'Email Address' }, required: ['NAME'], awardColumns: ['Prize / Award'] });
    must200(validate, 'POST /api/sheets/validate');
    must(validate.json.validCount === truth.rows.length && (validate.json.errorRows ?? validate.json.invalid?.length ?? 0) === 0, `validate: ${validate.json.validCount} valid, ${validate.json.errorRows} bad: ${JSON.stringify(validate.json.issues ?? []).slice(0, 300)}`);
    ok(`header row found below the title, ${validate.json.validCount} rows valid`);

    const disc = await api('POST', '/api/awards/discover', { uploadId, awardColumns: ['Prize / Award'] });
    must200(disc, 'POST /api/awards/discover');
    const found: { key: string; label: string; values: string[]; count: number }[] = disc.json.categories;
    must(found.length === Object.keys(CATS).length, `discovered ${found.length} award categories (${found.map((c) => c.label).join(' | ')}), expected ${Object.keys(CATS).length}`);
    const catOfFound = new Map<string, string>();
    for (const c of found) {
      const keys = new Set(c.values.map((v) => spellingToCat.get(norm(v))));
      must(keys.size === 1 && !keys.has(undefined), `category "${c.label}" mixes or misses spellings: ${c.values.join(', ')}`);
      catOfFound.set(c.key, [...keys][0]!);
    }
    must(new Set(catOfFound.values()).size === found.length, 'two discovered categories are the same award, or one award was split');
    const expectedCount = new Map<string, number>();
    for (const r of truth.rows) for (const c of r.cats) expectedCount.set(c, (expectedCount.get(c) ?? 0) + 1);
    for (const c of found) must(c.count === expectedCount.get(catOfFound.get(c.key)!), `category "${c.label}" counts ${c.count} rows, expected ${expectedCount.get(catOfFound.get(c.key)!)}`);
    ok(`${found.length} award categories found and grouped (spelling variants merged, counts match)`);

    const categories = found.map((c, i) => {
      const cat = catOfFound.get(c.key)!;
      return { id: `cat-${cat}`, label: c.label, values: c.values, priority: i + 1, templateId: CATS[cat].template, driveSubfolder: `${i + 1} ${c.label}` };
    });
    const labelOfCat = new Map(categories.map((c) => [c.id, c]));
    const scheme = { id: 'e2e-scheme', name: 'E2E scheme', awardColumns: ['Prize / Award'], categories, multiAward: 'all-matches', delivery: 'one-email' };
    const draft = { mapping, email: { primary: 'Email Address' }, required: ['NAME'], scheme, templateIds: [...new Set(categories.map((c) => c.templateId))], organizationName: 'E2E Academy', linkedIn: true, issuedAt: '2026-03-14T00:00:00.000Z' };

    const created = await api('POST', '/api/batches', { name: 'E2E mapping batch' });
    must200(created, 'POST /api/batches');
    const batchId: string = created.json.id;
    must(typeof batchId === 'string' && batchId.length > 6, 'POST /api/batches returned no id');
    must((await api('POST', `/api/batches/${batchId}/prepare`, { uploadId, draft }, null)).status === 401, 'prepare works without a session');
    must([403, 404].includes((await api('POST', `/api/batches/${batchId}/prepare`, { uploadId, draft }, otherCookie)).status), "another organizer can prepare this organizer's batch");
    const prep = await api('POST', `/api/batches/${batchId}/prepare`, { uploadId, draft });
    must200(prep, 'POST /api/batches/[id]/prepare');
    must(prep.json.certificates === totalCerts, `prepare made ${prep.json.certificates} certificates, expected ${totalCerts}`);
    must(prep.json.people === truth.people, `prepare found ${prep.json.people} people, expected ${truth.people}`);
    must((prep.json.unmatchedValues ?? []).length === 0, `unmatched award values: ${JSON.stringify(prep.json.unmatchedValues)}`);
    must((prep.json.emails ?? truth.people) === truth.people, `prepare plans ${prep.json.emails} emails, expected ${truth.people}`);
    ok(`prepared ${prep.json.certificates} certificates for ${prep.json.people} people (${prep.json.emails ?? '?'} emails)`);

    const early = await api('POST', `/api/batches/${batchId}/start`, { confirm: true });
    must(early.status === 409, `start before the test email returned ${early.status}, expected 409`);
    const unconfirmed = await api('POST', `/api/batches/${batchId}/start`, {});
    must(unconfirmed.status >= 400 && unconfirmed.status < 500, `start without confirmation returned ${unconfirmed.status}`);
    const test = await api('POST', `/api/batches/${batchId}/test-send`, {});
    must200(test, 'POST /api/batches/[id]/test-send');
    must(test.json.to === ORG_EMAIL, `test email went to ${test.json.to}, expected the organizer ${ORG_EMAIL}`);
    const start = await api('POST', `/api/batches/${batchId}/start`, { confirm: true });
    must200(start, 'POST /api/batches/[id]/start');
    ok('start refused until a test email is sent; test sent to the organizer; batch started');

    const t0 = Date.now();
    let counts: Record<string, number> = {};
    let lastLog = 0;
    for (;;) {
      const st = await api('GET', `/api/batches/${batchId}`);
      must200(st, 'GET /api/batches/[id]');
      counts = st.json.counts;
      const done = counts.SENT ?? 0;
      if (Date.now() - lastLog > 10_000) { lastLog = Date.now(); console.log(`    ... ${done}/${totalCerts} sent, ${counts.FAILED ?? 0} failed, ${counts.PENDING ?? 0} pending (${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
      if ((counts.FAILED ?? 0) > 0) {
        const bad = await api('GET', `/api/batches/${batchId}?status=FAILED`);
        throw new Failure(`${counts.FAILED} certificates failed: ${JSON.stringify((bad.json?.certificates ?? []).slice(0, 3).map((c: { name: string; error: string }) => [c.name, c.error]))}`);
      }
      if (done === totalCerts && !st.json.running) break;
      if (Date.now() - t0 > 20 * 60_000) throw new Failure(`timed out waiting for the batch: ${JSON.stringify(counts)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    ok(`all ${totalCerts} certificates Sent in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const finalState = await api('GET', `/api/batches/${batchId}`);
    must(finalState.json.batch?.status === 'DONE', `batch status is ${finalState.json.batch?.status}, expected DONE`);

    const outbox = path.join(dataDir, 'outbox', ORG);
    const emlFiles = fs.readdirSync(outbox).filter((f) => f.endsWith('.eml'));
    must(emlFiles.length === truth.people + 1, `outbox holds ${emlFiles.length} emails, expected ${truth.people} + 1 test`);
    const emails: { file: string; mail: ParsedEmail }[] = emlFiles.map((f) => ({ file: f, mail: parseEmail(fs.readFileSync(path.join(outbox, f))) }));
    const testMails = emails.filter((e) => /\[TEST\]\s*$/.test(e.mail.subject));
    const mainMails = emails.filter((e) => !/\[TEST\]\s*$/.test(e.mail.subject));
    must(testMails.length === 1 && mainMails.length === truth.people, `expected 1 test + ${truth.people} real emails, found ${testMails.length} + ${mainMails.length}`);

    const certRows = dbm.all<{ id: string; record_id: string; person_key: string; category_id: string; category_label: string; template_id: string; file_name: string; sha256: string; verify_code: string; status: string; folder_path: string; storage_id: string; row_number: number; email: string; values_json: string; message_id: string }>(db,
      `SELECT c.id, c.record_id, c.person_key, c.category_id, c.category_label, c.template_id, c.file_name, c.sha256, c.verify_code, c.status, c.folder_path, c.storage_id, c.message_id,
              r.row_number, r.email, r.values_json FROM certificates c JOIN records r ON r.id = c.record_id WHERE c.batch_id = ?`, batchId);
    must(certRows.length === totalCerts, `database holds ${certRows.length} certificates, expected ${totalCerts}`);
    const certById = new Map(certRows.map((c) => [c.id, c]));
    must(certRows.every((c) => c.status === 'SENT'), 'some certificates are not SENT in the database');
    must(new Set(certRows.map((c) => c.verify_code)).size === totalCerts, 'verify codes are not unique');

    const expectedPairs = (id: string) => (rowsOfPerson.get(id) ?? []).flatMap((r) => r.cats.map((c) => `${r.excelRow}|${c}`)).sort();
    const seenCert = new Set<string>();
    const problems: string[] = [];
    const sampleByCat = new Map<string, Buffer[]>();
    const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    let attachmentsTotal = 0;

    await pool(mainMails, 6, async ({ file, mail }) => {
      const tag = `${file.slice(0, 24)}`;
      const bad = (msg: string) => { if (problems.length < 25) problems.push(`${mail.to[0] ?? '?'}: ${msg}`); };
      if (mail.to.length !== 1 || mail.cc.length || mail.bcc.length) { bad(`recipients to=${mail.to} cc=${mail.cc} bcc=${mail.bcc}`); return; }
      const to = mail.to[0];
      if (!mail.attachments.length) { bad('no attachment'); return; }
      const pairs: string[] = [];
      const codes: string[] = [];
      let personId = '';
      for (const a of mail.attachments) {
        attachmentsTotal++;
        if (!/\.pdf$/i.test(a.filename) || a.contentType !== 'application/pdf' || a.content.subarray(0, 5).toString() !== '%PDF-') { bad(`attachment ${a.filename} is not a PDF`); continue; }
        const meta = await render.readCertMeta(U8(a.content));
        const cert = certById.get(meta.certId);
        if (!cert) { bad(`attachment ${a.filename} carries unknown certId "${meta.certId}"`); continue; }
        if (seenCert.has(cert.id)) bad(`certificate ${cert.id} was attached to more than one email`);
        seenCert.add(cert.id);
        const row = byExcelRow.get(cert.row_number);
        if (!row) { bad(`record row ${cert.row_number} is not in the sheet`); continue; }
        personId ||= row.id;
        if (row.id !== personId) bad(`attachments of different people in one email (${personId} and ${row.id})`);
        if (row.email.toLowerCase() !== to) bad(`${a.filename} belongs to ${row.email}, email went to ${to}`);
        if (cert.email.toLowerCase() !== to) bad(`${a.filename} record email ${cert.email} differs from recipient`);
        if (meta.recordId !== cert.record_id) bad(`${a.filename} PDF recordId ${meta.recordId} != database ${cert.record_id}`);
        if (meta.personKey !== cert.person_key || meta.personKey !== `id:${row.id.toLowerCase()}`) bad(`${a.filename} PDF personKey ${meta.personKey} != id:${row.id}`);
        if (meta.verifyCode !== cert.verify_code) bad(`${a.filename} PDF verify code ${meta.verifyCode} != ${cert.verify_code}`);
        if (sha(a.content) !== cert.sha256) bad(`${a.filename} sha256 differs from the recorded one`);
        if (a.filename !== cert.file_name) bad(`attachment name ${a.filename} != stored name ${cert.file_name}`);
        const catKey = cert.category_id.replace(/^cat-/, '');
        if (!row.cats.includes(catKey)) bad(`${a.filename} is a "${catKey}" certificate but row ${row.excelRow} earned ${row.cats.join('+')}`);
        if (cert.template_id !== CATS[catKey]?.template) bad(`${a.filename} used template ${cert.template_id}, category ${catKey} wants ${CATS[catKey]?.template}`);
        pairs.push(`${row.excelRow}|${catKey}`);
        codes.push(cert.verify_code);
        const text = norm((await raster.pdfTextItems(U8(a.content))).map((i) => i.str).join(' '));
        if (!text.includes(norm(row.name))) bad(`${a.filename} does not show the name "${row.name}"`);
        if (!text.includes(norm(row.project))) bad(`${a.filename} does not show "${row.project}"`);
        if (!text.includes(norm(row.event))) bad(`${a.filename} does not show the event "${row.event}"`);
        if (!text.includes(norm(cert.category_label))) bad(`${a.filename} does not show the award "${cert.category_label}"`);
        if (!text.includes(cert.verify_code.toLowerCase())) bad(`${a.filename} does not print its verify code`);
        if (sampleByCat.size < 64 && (sampleByCat.get(catKey)?.length ?? 0) < 2) sampleByCat.set(catKey, [...(sampleByCat.get(catKey) ?? []), a.content]);
      }
      if (personId && JSON.stringify(pairs.sort()) !== JSON.stringify(expectedPairs(personId))) bad(`attachments ${JSON.stringify(pairs.sort())} != the person's awards ${JSON.stringify(expectedPairs(personId))}`);
      const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      const lin = links.filter((l) => /^https:\/\/www\.linkedin\.com\/profile\/add\?/.test(l)).map((l) => new URL(l).searchParams.get('certId'));
      if (JSON.stringify([...lin].sort()) !== JSON.stringify([...codes].sort())) bad(`LinkedIn credential ids ${JSON.stringify(lin)} != PDF verify codes ${JSON.stringify(codes)}`);
      for (const c of codes) if (!links.some((l) => l.includes(`/verify/${c}`))) bad(`email has no verify link for ${c}`);
      const reports = links.filter((l) => /\/report\//.test(l)).length;
      if (reports !== codes.length) bad(`${reports} report links for ${codes.length} certificates`);
      if (personId) {
        const truthRow = rowsOfPerson.get(personId)![0];
        const escaped = truthRow.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/’/g, '’');
        if (!mail.html.includes(truthRow.name) && !mail.html.includes(escaped)) bad(`greeting does not use the name "${truthRow.name}"`);
      }
      const addresses = new Set([...(mail.html + ' ' + mail.text).matchAll(emailRe)].map((m) => m[0].toLowerCase()));
      for (const addr of addresses) if (addr !== to && addr !== ORG_EMAIL && !addr.endsWith('@certflow.local')) bad(`email text mentions another address ${addr}`);
      void tag;
    });
    must(problems.length === 0, `mapping problems (${problems.length}${problems.length >= 25 ? '+' : ''}):\n    ${problems.join('\n    ')}`);
    must(seenCert.size === totalCerts && attachmentsTotal === totalCerts, `${attachmentsTotal} attachments covering ${seenCert.size} certificates, expected exactly ${totalCerts}`);
    ok(`${mainMails.length} emails: one recipient each, exactly that person's ${totalCerts} certificates in total, each PDF's certId/recordId/personKey/verify code/sha256/name/event/project/award match its row`);
    ok('every LinkedIn credential id equals its PDF verify code; every email links its own verify pages and nothing of anybody else');

    const t = testMails[0].mail;
    const firstRow = [...certRows].sort((a, b) => a.row_number - b.row_number)[0];
    const firstPerson = firstRow.person_key;
    const expectTestCerts = certRows.filter((c) => c.person_key === firstPerson).map((c) => c.id).sort();
    const gotTestCerts: string[] = [];
    for (const a of t.attachments) gotTestCerts.push((await render.readCertMeta(U8(a.content))).certId);
    must(t.to.length === 1 && t.to[0] === ORG_EMAIL, `test email recipients: ${t.to}`);
    must(JSON.stringify(gotTestCerts.sort()) === JSON.stringify(expectTestCerts), 'the test email does not carry exactly the first student\'s certificates');
    ok('the [TEST] email went only to the organizer with the first student\'s own certificates');

    const SCALE = 0.4;
    const bgOf = async (id: string) => raster.rasterizePdf(await render.builtinBackground(id.replace(/^builtin:/, '')), SCALE);
    const pointsFor = (w: number, h: number) => {
      const pts: [number, number][] = [];
      for (let i = 1; i <= 12; i++) { const f = i / 13; pts.push([Math.round(f * (w - 1)), Math.round(0.02 * h)], [Math.round(f * (w - 1)), Math.round(0.98 * h - 1)], [Math.round(0.02 * w), Math.round(f * (h - 1))], [Math.round(0.98 * w - 1), Math.round(f * (h - 1))]); }
      for (const f of [0.04, 0.08, 0.12]) pts.push([Math.round(f * w), Math.round(f * h)], [Math.round((1 - f) * w - 1), Math.round(f * h)], [Math.round(f * w), Math.round((1 - f) * h - 1)], [Math.round((1 - f) * w - 1), Math.round((1 - f) * h - 1)]);
      return pts;
    };
    const dist = (a: { data: Uint8ClampedArray; width: number }, b: { data: Uint8ClampedArray; width: number }, pts: [number, number][]) => {
      let d = 0;
      for (const [x, y] of pts) { const i = (y * a.width + x) * 4; d += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); }
      return d / pts.length / 3;
    };
    const templateIds = [...new Set(Object.values(CATS).map((c) => c.template))];
    const bgs = new Map<string, Awaited<ReturnType<typeof bgOf>>>();
    for (const id of templateIds) bgs.set(id, await bgOf(id));
    let checked = 0;
    for (const [catKey, pdfs] of sampleByCat) {
      for (const pdf of pdfs) {
        const r = await raster.rasterizePdf(U8(pdf), SCALE);
        const pts = pointsFor(r.width, r.height);
        const scored = templateIds.map((id) => [id, dist(r, bgs.get(id)!, pts)] as const).sort((a, b) => a[1] - b[1]);
        const best = scored[0][1];
        const expectedScore = scored.find(([id]) => id === CATS[catKey].template)![1];
        must(expectedScore <= best + 1.5 && expectedScore < 12, `a "${catKey}" certificate does not look like ${CATS[catKey].template} (distances ${scored.slice(0, 3).map(([i, d]) => `${i}=${d.toFixed(1)}`).join(', ')})`);
        checked++;
      }
    }
    ok(`${checked} sampled PDFs (2 per award) match their category's template background (pixels outside the text boxes)`);

    const root = path.join(dataDir, 'certificates', ORG);
    const stored = walk(root).filter((f) => !f.endsWith('.certflow-index.json') && !f.endsWith('.tmp') && !f.split(path.sep).includes('_reports'));
    must(stored.length === totalCerts, `storage holds ${stored.length} files, expected exactly ${totalCerts}`);
    const storedSet = new Set(stored.map((f) => path.resolve(f)));
    const seenFiles = new Set<string>();
    const folderOfCat = new Map<string, Set<string>>();
    const sentAttachment = new Map<string, Buffer>();
    for (const { mail } of mainMails) for (const a of mail.attachments) sentAttachment.set((await render.readCertMeta(U8(a.content))).certId, a.content);
    for (const c of certRows) {
      const row = byExcelRow.get(c.row_number)!;
      const catKey = c.category_id.replace(/^cat-/, '');
      const expectedFolder = ['Facilify', folders.safeFolderName(row.event), folders.safeFolderName(labelOfCat.get(c.category_id)!.driveSubfolder)].join('/');
      must(c.folder_path === expectedFolder, `${c.file_name} is filed in "${c.folder_path}", expected "${expectedFolder}"`);
      const file = path.resolve(root, ...c.folder_path.split('/'), c.file_name);
      must(storedSet.has(file), `stored file missing for ${c.file_name} in ${c.folder_path}`);
      must(!seenFiles.has(file), `two certificates share the stored file ${file}`);
      seenFiles.add(file);
      must(sha(fs.readFileSync(file)) === c.sha256 && sha(sentAttachment.get(c.id)!) === c.sha256, `stored file for ${c.file_name} differs from the emailed PDF`);
      const set = folderOfCat.get(catKey) ?? new Set<string>();
      set.add(path.basename(path.dirname(file)));
      folderOfCat.set(catKey, set);
    }
    must(seenFiles.size === totalCerts, 'not every certificate has its own stored file');
    for (const [cat, set] of folderOfCat) must(set.size === 1, `award "${cat}" is spread over several folders: ${[...set].join(', ')}`);
    ok(`${totalCerts} certificates stored: one file each (identical bytes to the emailed PDF) in Facilify/<event>/<award folder>`);

    const order = dbm.all<{ cert_id: string; sv: number; sd: number; se: number }>(db,
      `SELECT cert_id, MAX(CASE WHEN to_status = 'SAVED' THEN id END) sv, MIN(CASE WHEN to_status = 'SENDING' THEN id END) sd, MAX(CASE WHEN to_status = 'SENT' THEN id END) se
       FROM events WHERE batch_id = ? GROUP BY cert_id`, batchId);
    must(order.length === totalCerts, `events exist for ${order.length} certificates`);
    const wrong = order.filter((o) => !(o.sv && o.sd && o.se && o.sv < o.sd && o.sd < o.se));
    must(wrong.length === 0, `${wrong.length} certificates were not SAVED before SENDING/SENT (e.g. ${wrong[0]?.cert_id})`);
    ok('every certificate was saved to storage before its email was sent');

    const sample = certRows[Math.floor(certRows.length / 2)];
    const pdfRes = await httpBytes(server.base, `/api/certificates/${sample.id}/pdf`, { cookie });
    must(pdfRes.status === 200 && sha(pdfRes.bytes) === sample.sha256, `GET /api/certificates/[id]/pdf returned ${pdfRes.status} / different bytes`);
    const foreign = await httpBytes(server.base, `/api/certificates/${sample.id}/pdf`, { cookie: otherCookie });
    must(foreign.status === 404 || foreign.status === 403, `another organizer can download this certificate (${foreign.status})`);
    must((await httpBytes(server.base, `/api/certificates/${sample.id}/pdf`)).status === 401, 'certificate PDF downloads without a session');
    const report = await http(server.base, `/api/batches/${batchId}/report`, { cookie });
    must(report.status === 200 && report.text.split(/\r?\n/).filter(Boolean).length >= totalCerts + 1, `GET /api/batches/[id]/report returned ${report.status} with ${report.text.split(/\r?\n/).length} lines`);
    ok('PDF download is owner-only; the status report lists every certificate');

    must(!server.logs().includes(SECRET), 'server log contains the master secret');
    console.log('E2E MAPPING OK');
  } finally {
    if (server) await server.stop();
    cleanDist(DIST);
    dbm.closeDb();
    rmrf(dataDir);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`FAIL: ${e instanceof Failure ? e.message : (e as Error).stack ?? String(e)}`);
  process.exit(1);
});
