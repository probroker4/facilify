import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKENS: Record<string, string> = {
  submit: 'TICKETS SUBMIT OK',
  inbox: 'TICKETS INBOX OK',
  reissue: 'TICKETS REISSUE OK',
  notify: 'TICKETS NOTIFY OK',
};

const argIdx = process.argv.indexOf('--case');
const which = argIdx > 0 ? process.argv[argIdx + 1] : '';
if (!TOKENS[which]) {
  console.error(`Usage: --case ${Object.keys(TOKENS).join('|')}`);
  process.exit(2);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'certflow-tickets-'));
process.env.CERTFLOW_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CERTFLOW_SECRET = crypto.randomBytes(32).toString('hex');
process.env.CERTFLOW_BASE_URL = 'http://localhost:3000';

let failures = 0;
let checks = 0;
function check(cond: unknown, label: string) {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}
async function expectError(fn: () => unknown, status: number, label: string) {
  try {
    await fn();
    check(false, `${label} (no error thrown)`);
  } catch (e) {
    const s = (e as { status?: number }).status;
    check(s === status, `${label} -> ${s} ${(e as Error).message}`);
  }
}

interface Part { headers: Record<string, string>; body: Buffer }
function parseHeaders(raw: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of raw.replace(/\r\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
}
function decodeQP(s: string): Buffer {
  const soft = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) { bytes.push(parseInt(soft.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(soft[i], 'utf8'));
  }
  return Buffer.from(bytes);
}
function decodeWords(s: string): string {
  return s.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_m, enc: string, txt: string) =>
    enc.toLowerCase() === 'b' ? Buffer.from(txt, 'base64').toString('utf8') : decodeQP(txt.replace(/_/g, ' ')).toString('utf8'));
}
function leafParts(raw: string): { headers: Record<string, string>; parts: Part[] } {
  const split = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(raw.slice(0, split));
  const body = raw.slice(split).replace(/^\r?\n\r?\n/, '');
  const ct = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (/^multipart\//i.test(ct) && boundary) {
    const chunks = body.split(`--${boundary}`).slice(1).filter((c) => !c.startsWith('--'));
    return { headers, parts: chunks.flatMap((c) => leafParts(c.replace(/^\r?\n/, '')).parts) };
  }
  const cte = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase();
  const buf = cte === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : cte === 'quoted-printable' ? decodeQP(body) : Buffer.from(body, 'utf8');
  return { headers, parts: [{ headers, body: buf }] };
}
function readEml(file: string) {
  const raw = fs.readFileSync(file, 'utf8');
  const { headers, parts } = leafParts(raw);
  const html = parts.filter((p) => /text\/html/i.test(p.headers['content-type'] ?? '')).map((p) => p.body.toString('utf8')).join('\n');
  const pdfs = parts.filter((p) => /application\/pdf/i.test(p.headers['content-type'] ?? '')).map((p) => new Uint8Array(p.body));
  return { subject: decodeWords(headers.subject ?? ''), to: headers.to ?? '', html, pdfs, raw };
}

function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

async function main() {
  const { openDb, run, get, all } = await import('@/lib/db/db');
  const { prepareBatch } = await import('@/lib/pipeline/prepare');
  const { runBatch } = await import('@/lib/pipeline/runner');
  const { buildRunnerDeps } = await import('@/lib/pipeline/services');
  const { CaptureTransport } = await import('@/lib/mail');
  const { LocalStorage } = await import('@/lib/storage');
  const { builtinTemplate } = await import('@/lib/render');
  const { pdfTextItems } = await import('@/lib/render/raster');
  const { certToken } = await import('@/lib/secrets/crypto');
  const { sha256 } = await import('@/lib/hash');
  const T = await import('@/lib/tickets/tickets');
  type BatchConfig = import('@/lib/pipeline/config').BatchConfig;
  type CertRow = import('@/lib/db/repo').CertRow;
  type BatchRow = import('@/lib/db/repo').BatchRow;
  type ParsedSheet = import('@/lib/contracts').ParsedSheet;

  const db = openDb();
  const outboxDir = path.join(tmpRoot, 'outbox');
  const storeDir = path.join(tmpRoot, 'store');
  const transport = new CaptureTransport(outboxDir);
  const storage = new LocalStorage(storeDir);
  const overrides = { transport, storage, sleep: async () => {} };

  const now = new Date().toISOString();
  function organizer(id: string, email: string, orgName: string) {
    run(db, 'INSERT INTO organizers (id, email, name, created_at) VALUES (?, ?, ?, ?)', id, email, orgName, now);
    run(db, "INSERT INTO settings (organizer_id, key, value, encrypted) VALUES (?, 'org', ?, 0)", id, JSON.stringify({ name: orgName, linkedInEnabled: false }));
  }
  function config(orgName: string): BatchConfig {
    const tpl = builtinTemplate('classic');
    return {
      mapping: [
        { placeholder: 'NAME', column: 'Full Name' }, { placeholder: 'EMAIL', column: 'Email' }, { placeholder: 'EVENT', column: 'Event' },
        { placeholder: 'ACHIEVEMENT', column: 'Achievement' }, { placeholder: 'DATE', column: 'Date' },
      ],
      email: { primary: 'Email' }, required: [],
      scheme: { id: 'sch', name: 'Default', awardColumns: [], categories: [], defaultTemplateId: tpl.id, multiAward: 'first-match', delivery: 'one-email' },
      templates: { [tpl.id]: tpl }, emailTemplates: {}, defaultEmailTemplateId: 'default-email',
      folderPattern: 'Facilify/{{EVENT}}/{{CERTIFICATE_TYPE}}', organizationName: orgName, linkedIn: false, concurrency: 2, issuedAt: now,
    };
  }
  async function sentBatch(organizerId: string, batchId: string, orgName: string, people: [string, string][]): Promise<BatchRow> {
    run(db, "INSERT INTO batches (id, organizer_id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', '{}', ?, ?)", batchId, organizerId, `${orgName} batch`, now, now);
    const sheet: ParsedSheet = {
      headers: ['Full Name', 'Email', 'Event', 'Achievement', 'Date'],
      rows: people.map(([name, email]) => ({ 'Full Name': name, Email: email, Event: 'Hack Day 2026', Achievement: 'Best Design', Date: '3 November 2026' })),
      sourceName: 'students.csv', encoding: 'utf-8', headerRowNumber: 1, rowNumbers: people.map((_p, i) => i + 2),
    };
    const prep = prepareBatch(db, organizerId, batchId, sheet, config(orgName));
    if (prep.certificates !== people.length) throw new Error(`prepare produced ${prep.certificates} certificates: ${JSON.stringify(prep.validation.issues)} ${JSON.stringify(prep.routingIssues)}`);
    const batch = get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', batchId)!;
    const summary = await runBatch(batchId, buildRunnerDeps(db, organizerId, batch, overrides));
    if (summary.counts.SENT !== people.length) throw new Error(`batch not fully sent: ${JSON.stringify(summary)}`);
    return batch;
  }
  const certsOf = (batchId: string) => all<CertRow>(db, 'SELECT * FROM certificates WHERE batch_id = ? ORDER BY id', batchId);
  const certOfEmail = (email: string) => get<CertRow>(db, 'SELECT c.* FROM certificates c JOIN records r ON r.id = c.record_id WHERE r.email = ?', email)!;
  const emls = () => listFiles(outboxDir, '.eml').sort();

  const people: [string, string][] = [
    ['Aisha Rahman', 'aisha@example.edu'], ['Ben Carter', 'ben@example.edu'], ['Chloe Dubois', 'chloe@example.edu'],
    ['Daniel Okafor', 'daniel@example.edu'], ['Elena Petrova', 'elena@example.edu'], ['Farid Haddad', 'farid@example.edu'],
    ['Grace Lin', 'grace@example.edu'],
  ];
  organizer('org_a', 'a@org.test', 'Alpha Society');
  organizer('org_b', 'b@org.test', 'Beta Club');
  const batchA = await sentBatch('org_a', 'batch_a', 'Alpha Society', people);
  const batchB = await sentBatch('org_b', 'batch_b', 'Beta Club', [['Zoe Brooks', 'zoe@example.edu']]);
  const aisha = certOfEmail('aisha@example.edu');
  const ben = certOfEmail('ben@example.edu');
  const zoe = certOfEmail('zoe@example.edu');
  check(emls().length === people.length + 1, `setup: ${people.length + 1} emails sent`);
  T.resetRateLimits();

  if (which === 'submit') {
    const tok = certToken(aisha.id);
    const info = T.publicCertInfo(db, tok);
    check(info.name === 'Aisha Rahman' && info.event === 'Hack Day 2026' && info.date === '3 November 2026' && info.organizationName === 'Alpha Society', 'publicCertInfo shows this certificate');
    check(info.verifyCode === aisha.verify_code && info.verifyUrl.endsWith(`/verify/${aisha.verify_code}`), 'publicCertInfo verify code and URL');
    const infoJson = JSON.stringify(info);
    check(!infoJson.includes('@') && !infoJson.includes('Ben Carter'), 'publicCertInfo leaks no email or other students');

    const sig = tok.slice(tok.lastIndexOf('.') + 1);
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    await expectError(() => T.createTicket(db, `${aisha.id}.${flipped}`, { category: 'name', suggested: 'X' }, 'c1'), 404, 'tampered signature refused');
    await expectError(() => T.createTicket(db, `${ben.id}.${sig}`, { category: 'name', suggested: 'X' }, 'c1'), 404, "another certificate's id with this signature refused");
    await expectError(() => T.createTicket(db, 'garbage', { category: 'name', suggested: 'X' }, 'c1'), 404, 'garbage token refused');
    await expectError(() => T.createTicket(db, '', { category: 'name', suggested: 'X' }, 'c1'), 404, 'empty token refused');
    await expectError(() => T.publicCertInfo(db, `${ben.id}.${sig}`), 404, 'publicCertInfo refuses a swapped token');
    await expectError(() => T.createTicket(db, tok, { category: 'name', suggested: '  ', note: '' }, 'c1'), 400, 'empty suggested + note refused');
    await expectError(() => T.createTicket(db, tok, { category: 'colour', suggested: 'x' }, 'c1'), 400, 'unknown category refused');
    check(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM tickets')!.n === 0, 'no tickets created by refused submissions');

    const t1 = T.createTicket(db, tok, { category: 'name', suggested: 'Aysha Rahmaan', note: 'Spelling' }, 'c1');
    const row = get<{ cert_id: string; organizer_id: string; field: string; suggested: string; status: string }>(db, 'SELECT * FROM tickets WHERE id = ?', t1.id)!;
    check(row.cert_id === aisha.id && row.organizer_id === 'org_a' && row.field === 'NAME' && row.suggested === 'Aysha Rahmaan' && row.status === 'OPEN', 'valid token creates an OPEN ticket for that certificate only');
    check(T.publicCertInfo(db, tok).openTicket === true, 'public info reports the open ticket');
    await expectError(() => T.createTicket(db, tok, { category: 'date', suggested: '4 November 2026' }, 'c2'), 409, 'second open ticket on same certificate -> 409');

    const others = certsOf('batch_a').filter((c) => c.id !== aisha.id);
    for (let i = 0; i < 4; i++) T.createTicket(db, certToken(others[i].id), { category: 'other', note: `note ${i}` }, 'c1');
    await expectError(() => T.createTicket(db, certToken(others[4].id), { category: 'other', note: 'sixth' }, 'c1'), 429, '6th report in an hour from one client -> 429');
    const fromOther = T.createTicket(db, certToken(others[4].id), { category: 'other', note: 'different client' }, 'c9');
    check(!!fromOther.id, 'a different client is not rate limited (control)');
    check(get<{ n: number }>(db, "SELECT COUNT(*) n FROM tickets WHERE status = 'OPEN'")!.n === 6, '6 open tickets in total');
  }

  if (which === 'inbox') {
    const ta = T.createTicket(db, certToken(aisha.id), { category: 'name', suggested: 'Aysha Rahmaan', note: 'Please fix the spelling' }, 'c1');
    const tb = T.createTicket(db, certToken(ben.id), { category: 'date', suggested: '4 November 2026' }, 'c1');
    const tz = T.createTicket(db, certToken(zoe.id), { category: 'event', suggested: 'Hack Night 2026' }, 'c2');
    const listA = T.listTickets(db, 'org_a');
    const listB = T.listTickets(db, 'org_b');
    check(listA.length === 2 && listA.every((t) => t.organizer_id === 'org_a'), 'organizer A sees exactly their 2 tickets');
    check(!listA.some((t) => t.id === tz.id), "organizer A does not see B's ticket");
    check(listB.length === 1 && listB[0].id === tz.id, "organizer B sees only their own ticket, none of A's");
    const va = listA.find((t) => t.id === ta.id)!;
    check(va.category === 'name' && va.suggested === 'Aysha Rahmaan' && va.current === 'Aisha Rahman' && va.note === 'Please fix the spelling', 'category, suggested value, current value, note');
    check(va.values['Full Name'] === 'Aisha Rahman' && va.values.EVENT === 'Hack Day 2026' && va.email === 'aisha@example.edu' && va.name === 'Aisha Rahman', 'record data side by side');
    check(va.web_link === `/api/files/${aisha.id}` && va.pdf_url === `/api/certificates/${aisha.id}/pdf` && va.verify_code === aisha.verify_code, 'certificate link + preview link');
    check(va.batch_name === 'Alpha Society batch' && va.purged === false, 'batch name and live flag');
    const vb = listA.find((t) => t.id === tb.id)!;
    check(vb.category === 'date' && vb.current === '3 November 2026' && vb.suggested === '4 November 2026', 'second ticket fields');
    check(T.openTicketCount(db, 'org_a') === 2 && T.openTicketCount(db, 'org_b') === 1, 'open ticket badge counts per organizer');
    check(T.listTickets(db, 'org_a', 'OPEN').length === 2 && T.listTickets(db, 'org_a', 'RESOLVED').length === 0, 'status filter');
    await expectError(() => T.listTickets(db, 'org_a', 'BOGUS'), 400, 'unknown status filter refused');
    await expectError(() => T.getTicket(db, 'org_b', ta.id), 404, "organizer B cannot open A's ticket");
    await expectError(() => T.resolveTicket(db, 'org_b', ta.id, { field: 'NAME', value: 'Hacked' }, { depsOverrides: overrides }), 404, "organizer B cannot resolve A's ticket");
    await expectError(() => T.rejectTicket(db, 'org_b', ta.id, 'no', { transport }), 404, "organizer B cannot reject A's ticket");
    check(T.getTicket(db, 'org_a', ta.id).status === 'OPEN', "A's ticket untouched by B's attempts");
    check(T.listTickets(db, 'org_none').length === 0, 'an organizer with no tickets sees none');
  }

  if (which === 'reissue') {
    const before = certsOf('batch_a');
    const oldAisha = before.find((c) => c.id === aisha.id)!;
    const others = before.filter((c) => c.id !== aisha.id);
    const otherRecords = all<{ id: string; values_json: string }>(db, "SELECT id, values_json FROM records WHERE batch_id = 'batch_a' AND email <> 'aisha@example.edu' ORDER BY id");
    const otherEvents = get<{ n: number }>(db, "SELECT COUNT(*) n FROM events WHERE batch_id = 'batch_a' AND cert_id <> ?", aisha.id)!.n;
    const pdfsBefore = listFiles(storeDir, '.pdf');
    const oldStored = storage.pathOf(aisha.id)!;
    const emlBefore = new Set(emls());
    const oldText = (await pdfTextItems(new Uint8Array(fs.readFileSync(oldStored)))).map((i) => i.str).join('').replace(/\s+/g, '');
    check(oldText.includes('AishaRahman'), 'original PDF has the old name (control)');

    const t = T.createTicket(db, certToken(aisha.id), { category: 'name', suggested: 'Aysha Rahmaan' }, 'c1');
    await expectError(() => T.resolveTicket(db, 'org_a', t.id, { field: 'NAME', value: '   ' }, { depsOverrides: overrides }), 400, 'empty corrected value refused');
    await expectError(() => T.resolveTicket(db, 'org_a', t.id, { field: 'VERIFY_CODE', value: 'X' }, { depsOverrides: overrides }), 400, 'reserved field refused');
    check(T.getTicket(db, 'org_a', t.id).status === 'OPEN' && emls().length === emlBefore.size, 'refused resolves change nothing');

    const res = await T.resolveTicket(db, 'org_a', t.id, { field: 'NAME', value: 'Aysha Rahmaan', note: 'Your name is now spelled correctly.' }, { depsOverrides: overrides });
    check(res.ok && res.certId === aisha.id && res.certStatus === 'SENT', 'resolveTicket ok');
    const rec = JSON.parse(get<{ values_json: string }>(db, 'SELECT values_json FROM records WHERE id = ?', aisha.record_id)!.values_json) as Record<string, string>;
    check(rec.NAME === 'Aysha Rahmaan' && rec['Full Name'] === 'Aysha Rahmaan' && rec.EVENT === 'Hack Day 2026', 'record value (placeholder + original column) updated');

    const newAisha = get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', aisha.id)!;
    check(!!newAisha.sha256 && newAisha.sha256 !== oldAisha.sha256, 'PDF regenerated with a new sha256');
    check(newAisha.status === 'SENT' && newAisha.verify_code === oldAisha.verify_code, 'certificate SENT again, same verify code');
    const newStored = storage.pathOf(aisha.id)!;
    const storedBytes = new Uint8Array(fs.readFileSync(newStored));
    check(sha256(storedBytes) === newAisha.sha256, 'stored file is the regenerated PDF');
    const newText = (await pdfTextItems(storedBytes)).map((i) => i.str).join('').replace(/\s+/g, '');
    check(newText.includes('AyshaRahmaan') && !newText.includes('AishaRahman'), 'new name appears in the PDF text, old one gone');
    const pdfsAfter = listFiles(storeDir, '.pdf');
    check(pdfsAfter.length === pdfsBefore.length, `local storage file count unchanged (${pdfsBefore.length} -> ${pdfsAfter.length})`);
    const forAisha = pdfsAfter.filter((p) => /Aisha|Aysha/i.test(path.basename(p)));
    check(forAisha.length === 1 && path.resolve(forAisha[0]) === path.resolve(newStored), 'exactly ONE stored file for that certificate (replaced)');
    check(oldStored === newStored || !fs.existsSync(oldStored), 'old file is gone or overwritten');

    const added = emls().filter((f) => !emlBefore.has(f));
    check(added.length === 1, `exactly one new email (${added.length})`);
    if (added.length === 1) {
      const m = readEml(added[0]);
      check(m.subject.startsWith('Corrected:'), `subject starts with "Corrected:" (${m.subject})`);
      check(m.to.includes('aisha@example.edu'), 'sent to the student');
      check(m.pdfs.length === 1 && sha256(m.pdfs[0]) === newAisha.sha256, 'corrected PDF attached');
      check(m.html.includes('This is a corrected certificate.') && m.html.includes('Your name is now spelled correctly.') && m.html.includes('Aysha Rahmaan'), 'corrected banner + note + new name in body');
      check(m.html.includes('/report/'), 'corrected email still has the Report a problem link');
    }
    const ev = all<{ note: string | null; from_status: string; to_status: string }>(db, 'SELECT note, from_status, to_status FROM events WHERE cert_id = ? ORDER BY id', aisha.id);
    check(ev.some((e) => e.from_status === 'SENT' && e.to_status === 'PENDING' && (e.note ?? '').includes('Reissue') && (e.note ?? '').includes(t.id)), 'audited event containing "Reissue" and the ticket id');
    const tk = T.getTicket(db, 'org_a', t.id);
    check(tk.status === 'RESOLVED' && !!tk.resolved_at && (tk.resolution_note ?? '').length > 0, 'ticket RESOLVED with resolution note');
    await expectError(() => T.resolveTicket(db, 'org_a', t.id, { field: 'NAME', value: 'Again' }, { depsOverrides: overrides }), 409, 'resolving again refused');

    const afterOthers = certsOf('batch_a').filter((c) => c.id !== aisha.id);
    check(JSON.stringify(afterOthers.map((c) => [c.id, c.sha256, c.status, c.message_id])) === JSON.stringify(others.map((c) => [c.id, c.sha256, c.status, c.message_id])), 'other certificates untouched');
    check(JSON.stringify(all(db, "SELECT id, values_json FROM records WHERE batch_id = 'batch_a' AND email <> 'aisha@example.edu' ORDER BY id")) === JSON.stringify(otherRecords), 'other records untouched');
    check(get<{ n: number }>(db, "SELECT COUNT(*) n FROM events WHERE batch_id = 'batch_a' AND cert_id <> ?", aisha.id)!.n === otherEvents, 'no events on other certificates');
    check(certsOf('batch_b')[0].sha256 === zoe.sha256, "other organizer's batch untouched");

    const tBen = T.createTicket(db, certToken(ben.id), { category: 'name', suggested: 'Benjamin Carter' }, 'c2');
    const benRec = get<{ values_json: string }>(db, 'SELECT values_json FROM records WHERE id = ?', ben.record_id)!.values_json;
    const emlCount = emls().length;
    run(db, "UPDATE batches SET config_json = '{}' WHERE id = 'batch_a'");
    await expectError(() => T.resolveTicket(db, 'org_a', tBen.id, { field: 'NAME', value: 'Benjamin Carter' }, { depsOverrides: overrides }), 410, 'purged batch -> clear 410 failure');
    check(get<{ values_json: string }>(db, 'SELECT values_json FROM records WHERE id = ?', ben.record_id)!.values_json === benRec, 'purged: record unchanged');
    check(T.getTicket(db, 'org_a', tBen.id).status === 'OPEN' && emls().length === emlCount && get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', ben.id)!.status === 'SENT', 'purged: ticket still OPEN, no email, cert unchanged');
    run(db, "UPDATE batches SET id = 'batch_a_gone' WHERE id = 'batch_a'");
    await expectError(() => T.resolveTicket(db, 'org_a', tBen.id, { field: 'NAME', value: 'Benjamin Carter' }, { depsOverrides: overrides }), 410, 'batch row gone -> 410');
    check(T.listTickets(db, 'org_a').find((x) => x.id === tBen.id)?.purged === true, 'inbox still lists the ticket, flagged purged');
  }

  if (which === 'notify') {
    const xss = '<img src=x onerror=alert(1)>';
    const tok = certToken(aisha.id);
    const t1 = T.createTicket(db, tok, { category: 'name', suggested: xss, note: `<script>alert(2)</script>` }, 'c1');
    const v = T.listTickets(db, 'org_a').find((x) => x.id === t1.id)!;
    check(v.suggested === xss && v.note === '<script>alert(2)</script>', 'listTickets returns raw text for the UI to escape');

    let before = new Set(emls());
    const rj = await T.rejectTicket(db, 'org_a', t1.id, `We could not use "${xss}" as a name.`, { transport });
    check(rj.ok && rj.notified, 'rejectTicket ok');
    let added = emls().filter((f) => !before.has(f));
    check(added.length === 1, `rejecting sends exactly one email (${added.length})`);
    if (added.length === 1) {
      const m = readEml(added[0]);
      check(m.to.includes('aisha@example.edu') && m.subject === 'About your certificate report', `status email to the student (${m.subject})`);
      check(m.pdfs.length === 0, 'no attachment');
      check(m.html.includes('We could not use &quot;&lt;img src=x onerror=alert(1)&gt;&quot; as a name.'), 'note included, HTML-escaped');
      check(!m.html.includes('<img') && !m.html.includes('<script'), 'no raw student markup in the notify email');
      check(m.html.length < 2000, 'short email');
    }
    const tk1 = T.getTicket(db, 'org_a', t1.id);
    check(tk1.status === 'REJECTED' && !!tk1.resolved_at && (tk1.resolution_note ?? '').includes(xss), 'ticket REJECTED with note');
    before = new Set(emls());
    await expectError(() => T.rejectTicket(db, 'org_a', t1.id, 'again', { transport }), 409, 'rejecting a closed ticket refused');
    check(emls().length === before.size, 'no email for a refused reject');

    const t2 = T.createTicket(db, tok, { category: 'name', suggested: xss }, 'c1');
    before = new Set(emls());
    await T.resolveTicket(db, 'org_a', t2.id, { field: 'NAME', value: xss, note: `Name set to ${xss}` }, { depsOverrides: overrides });
    added = emls().filter((f) => !before.has(f));
    check(added.length === 1, 'resolving sends exactly one email (the corrected certificate with a status note)');
    if (added.length === 1) {
      const m = readEml(added[0]);
      check(m.subject.startsWith('Corrected:') && m.pdfs.length === 1, 'resolution email is the corrected certificate');
      check(m.html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'student value HTML-escaped in corrected email');
      check(!m.html.includes('<img'), 'no raw <img in corrected email HTML');
    }
    check(T.getTicket(db, 'org_a', t2.id).status === 'RESOLVED', 'ticket RESOLVED');

    const t3 = T.createTicket(db, tok, { category: 'other', note: 'still wrong' }, 'c1');
    before = new Set(emls());
    await T.rejectTicket(db, 'org_a', t3.id, '', { transport });
    added = emls().filter((f) => !before.has(f));
    if (added.length === 1) {
      const m = readEml(added[0]);
      check(m.html.includes('Dear &lt;img src=x onerror=alert(1)&gt;,') && !m.html.includes('<img'), 'student name escaped in the status email greeting');
      check(m.html.includes('correct as issued'), 'empty decline note gets a default message');
    } else check(false, 'decline with empty note sends one email');
    const info = T.publicCertInfo(db, tok);
    check(info.name === xss, 'publicCertInfo returns raw text (React escapes it)');
  }

  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
  console.log(TOKENS[which]);
}

main().catch((e) => {
  console.log(`  FAIL unexpected error: ${(e as Error).stack ?? e}`);
  process.exit(1);
}).finally(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {  }
});
