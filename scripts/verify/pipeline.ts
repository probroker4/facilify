import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKENS: Record<string, string> = {
  states: 'PIPELINE STATES OK',
  failures: 'PIPELINE FAILURES OK',
  duplicates: 'PIPELINE DUPLICATES OK',
  resume: 'PIPELINE RESUME OK',
  'bulk-quota': 'PIPELINE BULK QUOTA OK',
  report: 'PIPELINE REPORT OK',
};
const argIdx = process.argv.indexOf('--case');
const which = argIdx > 0 ? process.argv[argIdx + 1] : '';
if (!TOKENS[which]) {
  console.error(`Usage: --case ${Object.keys(TOKENS).join('|')}`);
  process.exit(2);
}

const REPO = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'certflow-pipeline-'));
const DATA = path.join(tmpRoot, 'data');
process.env.CERTFLOW_DATA_DIR = DATA;
process.env.CERTFLOW_SECRET = 'pipeline-oracle-secret-0123456789abcdef0123456789';
process.env.CERTFLOW_BASE_URL = 'http://localhost:3000';

let failures = 0;
let checks = 0;
function check(cond: unknown, label: string) {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}
async function rejects(fn: () => unknown, label: string, match?: RegExp): Promise<string> {
  try { await fn(); } catch (e) {
    const msg = (e as Error).message ?? String(e);
    check(!match || match.test(msg), `${label} -> "${msg.slice(0, 110)}"`);
    return msg;
  }
  check(false, `${label} (nothing was thrown)`);
  return '';
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
function leafParts(raw: string): Part[] {
  const split = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(raw.slice(0, split));
  const body = raw.slice(split).replace(/^\r?\n\r?\n/, '');
  const ct = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (/^multipart\//i.test(ct) && boundary) {
    const chunks = body.split(`--${boundary}`).slice(1).filter((c) => !c.startsWith('--'));
    return chunks.flatMap((c) => leafParts(c.replace(/^\r?\n/, '')));
  }
  const cte = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase();
  const buf = cte === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : cte === 'quoted-printable' ? decodeQP(body) : Buffer.from(body, 'utf8');
  return [{ headers, body: buf }];
}
interface Eml { file: string; to: string; subject: string; pdfs: Uint8Array[] }
function readEml(file: string): Eml {
  const raw = fs.readFileSync(file, 'utf8');
  const split = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(raw.slice(0, split));
  const parts = leafParts(raw);
  const toRaw = headers.to ?? '';
  const to = (/<([^>]+)>/.exec(toRaw)?.[1] ?? toRaw).trim().toLowerCase();
  return { file, to, subject: headers.subject ?? '', pdfs: parts.filter((p) => /application\/pdf/i.test(p.headers['content-type'] ?? '')).map((p) => new Uint8Array(p.body)) };
}
function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const ORG = 'org_pipeline';
interface Person { i: number; name: string; id: string; email: string; awards: string[] }
const pad = (n: number, w = 4) => String(n).padStart(w, '0');
const personAt = (i: number, awards: string[] = ['Participation']): Person => ({
  i, name: `Student ${pad(i)} Tester`, id: `S${1000 + i}`, email: `p${i}@example.edu`, awards,
});
const csvq = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const HEADERS = ['Name', 'Student ID', 'Email', 'Event', 'Award', 'Achievement', 'Date'];
function sheetBytes(people: Person[], event = 'Hack Day 2026'): Uint8Array {
  const lines = [HEADERS.join(',')];
  for (const p of people) {
    for (const a of p.awards) lines.push([p.name, p.id, p.email, event, a, 'Excellent work', '4 November 2026'].map(csvq).join(','));
  }
  return new TextEncoder().encode(lines.join('\n'));
}

async function main() {
  const dbmod = await import('@/lib/db');
  const { openDb, run, get, all } = dbmod;
  const { parseSheet } = await import('@/lib/ingest');
  const { discoverCategories, schemeFromDiscovery } = await import('@/lib/routing');
  const { prepareBatch } = await import('@/lib/pipeline/prepare');
  const R = await import('@/lib/pipeline/runner');
  const { runBatch } = R;
  const { buildRunnerDeps } = await import('@/lib/pipeline/services');
  const { transition, TransitionError } = await import('@/lib/pipeline/states');
  const { batchReportCsv, csvCell, REPORT_HEADERS } = await import('@/lib/pipeline/report');
  const { CaptureTransport } = await import('@/lib/mail');
  const { LocalStorage } = await import('@/lib/storage');
  const { builtinTemplate, readCertMeta } = await import('@/lib/render');
  const { statusCounts, eventsOf } = await import('@/lib/db/repo');
  type MailTransport = import('@/lib/contracts').MailTransport;
  type OutboundMail = import('@/lib/contracts').OutboundMail;
  type CertRow = import('@/lib/db/repo').CertRow;
  type BatchRow = import('@/lib/db/repo').BatchRow;
  type BatchConfig = import('@/lib/pipeline/config').BatchConfig;
  type RunnerDeps = import('@/lib/pipeline/runner').RunnerDeps;
  type RecordStatus = import('@/lib/contracts').RecordStatus;
  const { MailError, StorageError } = await import('@/lib/contracts');

  const db = openDb();
  const outboxDir = path.join(tmpRoot, 'outbox');
  const storeDir = path.join(tmpRoot, 'store');
  const capture = new CaptureTransport(outboxDir);
  const storage = new LocalStorage(storeDir);
  const now = new Date().toISOString();
  run(db, 'INSERT INTO organizers (id, email, name, created_at) VALUES (?, ?, ?, ?)', ORG, 'org@pipeline.test', 'Pipeline Org', now);
  run(db, "INSERT INTO settings (organizer_id, key, value, encrypted) VALUES (?, 'org', ?, 0)", ORG, JSON.stringify({ name: 'Pipeline Org', linkedInEnabled: false }));

  const emls = () => listFiles(outboxDir, '.eml').map(readEml);
  const certsOf = (batchId: string) => all<CertRow>(db, 'SELECT * FROM certificates WHERE batch_id = ? ORDER BY id', batchId);
  const batchRow = (batchId: string) => get<BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', batchId)!;
  const storedPdfs = () => listFiles(storeDir, '.pdf');
  const tally = (rows: CertRow[]) => {
    const t: Record<string, number> = {};
    for (const r of rows) t[r.status] = (t[r.status] ?? 0) + 1;
    return t;
  };

  function createBatch(batchId: string, name = batchId, organizerId = ORG) {
    run(db, "INSERT INTO batches (id, organizer_id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', '{}', ?, ?)", batchId, organizerId, name, now, now);
  }
  function buildConfig(sheet: import('@/lib/contracts').ParsedSheet, o: { delivery?: 'one-email' | 'email-per-certificate'; concurrency?: number; resend?: string } = {}): BatchConfig {
    const groups = discoverCategories(sheet.rows, ['Award']);
    const tplFor = (g: { label: string }) => (/1st|first|winner/i.test(g.label) ? 'builtin:gold' : /ui/i.test(g.label) ? 'builtin:modern' : 'builtin:participation');
    const scheme = schemeFromDiscovery('sch', 'Scheme', ['Award'], groups, tplFor, { multiAward: 'all-matches', delivery: o.delivery ?? 'one-email' });
    const templates: Record<string, import('@/lib/contracts').CertTemplate> = {};
    for (const c of scheme.categories) templates[c.templateId] = builtinTemplate(c.templateId.replace('builtin:', ''));
    return {
      mapping: [
        { placeholder: 'NAME', column: 'Name' }, { placeholder: 'ID', column: 'Student ID' }, { placeholder: 'EVENT', column: 'Event' },
        { placeholder: 'CERTIFICATE_TYPE', column: 'Award' }, { placeholder: 'ACHIEVEMENT', column: 'Achievement' }, { placeholder: 'DATE', column: 'Date' },
      ],
      email: { primary: 'Email' }, required: ['EVENT'], scheme, templates, emailTemplates: {}, defaultEmailTemplateId: 'default-email',
      folderPattern: 'Facilify/{{EVENT}}/{{CERTIFICATE_TYPE}}', organizationName: 'Pipeline Org', linkedIn: false,
      concurrency: o.concurrency ?? 4, issuedAt: now, ...(o.resend !== undefined ? { resendAlreadySent: { reason: o.resend } } : {}),
    };
  }
  function prep(batchId: string, people: Person[], o: Parameters<typeof buildConfig>[1] & { event?: string; name?: string; organizerId?: string } = {}) {
    const organizerId = o.organizerId ?? ORG;
    createBatch(batchId, o.name ?? batchId, organizerId);
    const sheet = parseSheet(sheetBytes(people, o.event), 'students.csv');
    const config = buildConfig(sheet, o);
    const result = prepareBatch(db, organizerId, batchId, sheet, config);
    return { sheet, config, result };
  }
  const deps = (batchId: string, over: Partial<RunnerDeps> = {}, organizerId = ORG) =>
    buildRunnerDeps(db, organizerId, batchRow(batchId), { transport: capture, storage, sleep: async () => {}, ...over });
  const sendersOf = (messages: Eml[]) => {
    const m = new Map<string, number>();
    for (const e of messages) m.set(e.to, (m.get(e.to) ?? 0) + 1);
    return m;
  };
  async function auditEmails(messages: Eml[], label: string) {
    const seen = new Map<string, number>();
    let bad = 0;
    for (const e of messages) {
      for (const pdf of e.pdfs) {
        const meta = await readCertMeta(pdf);
        const cert = get<CertRow & { email: string }>(db, 'SELECT c.*, r.email FROM certificates c JOIN records r ON r.id = c.record_id WHERE c.id = ?', meta.certId);
        if (!cert || cert.email.toLowerCase() !== e.to || cert.person_key !== meta.personKey) bad++;
        seen.set(meta.certId, (seen.get(meta.certId) ?? 0) + 1);
      }
    }
    check(bad === 0, `${label}: every attachment belongs to its recipient`);
    check([...seen.values()].every((n) => n === 1), `${label}: no certificate is attached to more than one email (${seen.size} distinct attachments)`);
    return seen;
  }

  async function auditEmailsLoose(messages: Eml[]) {
    const seen = new Map<string, number>();
    let bad = 0;
    for (const e of messages) {
      for (const pdf of e.pdfs) {
        const meta = await readCertMeta(pdf);
        const cert = get<CertRow & { email: string }>(db, 'SELECT c.*, r.email FROM certificates c JOIN records r ON r.id = c.record_id WHERE c.id = ?', meta.certId);
        if (!cert || cert.email.toLowerCase() !== e.to || cert.person_key !== meta.personKey) bad++;
        seen.set(meta.certId, (seen.get(meta.certId) ?? 0) + 1);
      }
    }
    check(bad === 0, `all emails: every attachment belongs to its recipient (${messages.length} emails)`);
    return seen;
  }

  if (which === 'states') {
    const { result } = prep('b_states', [personAt(1), personAt(2), personAt(3, ['Participation', 'Best UI'])]);
    check(result.certificates === 4 && result.people === 3, `prepared 4 certificates for 3 people (${result.certificates}/${result.people})`);

    const ALL: RecordStatus[] = ['PENDING', 'GENERATED', 'SAVED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'];
    const LEGAL: Record<string, string[]> = {
      PENDING: ['GENERATED', 'FAILED', 'SKIPPED'], GENERATED: ['SAVED', 'FAILED'], SAVED: ['SENDING', 'FAILED', 'SKIPPED'],
      SENDING: ['SENT', 'FAILED', 'SAVED'], SENT: ['SENDING', 'PENDING'], FAILED: ['PENDING', 'SENDING'], SKIPPED: ['PENDING'],
    };
    const NEEDS_REASON = new Set(['SENT>SENDING', 'SENT>PENDING', 'SKIPPED>PENDING']);
    for (const [a, b] of [['PENDING', 'GENERATED'], ['GENERATED', 'SAVED'], ['SAVED', 'SENDING'], ['SENDING', 'SENT'], ['SENDING', 'FAILED'], ['FAILED', 'SENDING']]) {
      check(LEGAL[a].includes(b), `plan edge ${a} -> ${b} is in the oracle table`);
    }
    const target = certsOf('b_states')[0];
    const setRaw = (s: RecordStatus) => run(db, 'UPDATE certificates SET status = ?, held_reason = NULL, error = NULL WHERE id = ?', s, target.id);
    let matrixOk = 0;
    let matrixBad: string[] = [];
    for (const from of ALL) {
      for (const to of ALL) {
        setRaw(from);
        const before = get<{ status: string; updated_at: string }>(db, 'SELECT status, updated_at FROM certificates WHERE id = ?', target.id)!;
        const evBefore = eventsOf(db, target.id).length;
        const legal = LEGAL[from].includes(to);
        let threw: string | null = null;
        try { transition(db, target.id, to); } catch (e) { threw = e instanceof TransitionError ? 'TransitionError' : `other:${(e as Error).message}`; }
        const needReason = NEEDS_REASON.has(`${from}>${to}`);
        const expectThrow = !legal || needReason;
        const after = get<{ status: string; updated_at: string }>(db, 'SELECT status, updated_at FROM certificates WHERE id = ?', target.id)!;
        const evAfter = eventsOf(db, target.id).length;
        let ok = expectThrow ? threw === 'TransitionError' && after.status === from && after.updated_at === before.updated_at && evAfter === evBefore
          : threw === null && after.status === to && evAfter === evBefore + 1;
        if (!expectThrow && ok === true) {
          const ev = eventsOf(db, target.id).at(-1)!;
          ok = ev.from_status === from && ev.to_status === to && !Number.isNaN(Date.parse(ev.at)) && after.updated_at === ev.at;
        }
        if (legal && needReason) {
          setRaw(from);
          let t2: string | null = null;
          try { transition(db, target.id, to, { note: 'because the student lost the email' }); } catch (e) { t2 = (e as Error).message; }
          ok = ok && t2 === null && get<{ status: string }>(db, 'SELECT status FROM certificates WHERE id = ?', target.id)!.status === to
            && eventsOf(db, target.id).at(-1)!.note === 'because the student lost the email';
        }
        if (ok) matrixOk++; else matrixBad.push(`${from}->${to}(${threw ?? 'ok'})`);
      }
    }
    check(matrixBad.length === 0, `all ${ALL.length * ALL.length} status pairs behave (legal move recorded, illegal / reason-less move rejected and leaves no trace)${matrixBad.length ? ` bad: ${matrixBad.join(' ')}` : ''}`);
    setRaw('SENT');
    await rejects(() => transition(db, target.id, 'SENDING', { note: '   ' }), 'a blank reason is not a reason (resend)', /reason is required/);
    await rejects(() => transition(db, target.id, 'PENDING', { note: '' }), 'an empty reason is not a reason (reissue)', /reason is required/);
    await rejects(() => transition(db, 'no_such_cert', 'SAVED'), 'unknown certificate is rejected', /Unknown certificate/);
    setRaw('PENDING');
    await rejects(() => transition(db, target.id, 'GENERATED', { fields: { status: 'SENT' } as never }), 'a transition cannot smuggle other columns', /Cannot set/);
    check(get<{ status: string }>(db, 'SELECT status FROM certificates WHERE id = ?', target.id)!.status === 'PENDING', 'rejected field leaves the status alone');

    run(db, 'DELETE FROM events WHERE cert_id = ?', target.id);
    setRaw('PENDING');
    run(db, "INSERT INTO events (cert_id, batch_id, from_status, to_status, note, at) VALUES (?, 'b_states', NULL, 'PENDING', 'Created', ?)", target.id, new Date().toISOString());
    const summary = await runBatch('b_states', deps('b_states'));
    check(summary.status === 'DONE' && summary.counts.SENT === 4, `batch ran to DONE with 4 SENT (${JSON.stringify(summary.counts)})`);
    const MAINLINE = ['PENDING>GENERATED', 'GENERATED>SAVED', 'SAVED>SENDING', 'SENDING>SENT'];
    for (const c of certsOf('b_states')) {
      const ev = eventsOf(db, c.id).filter((e) => e.from_status !== e.to_status);
      const chain = ev.filter((e) => e.from_status !== null).map((e) => `${e.from_status}>${e.to_status}`);
      check(JSON.stringify(chain) === JSON.stringify(MAINLINE), `cert ${c.id.slice(-6)} walked ${chain.join(' , ')}`);
      const times = ev.map((e) => Date.parse(e.at));
      check(times.every((t) => !Number.isNaN(t)) && times.every((t, k) => k === 0 || t >= times[k - 1]), `cert ${c.id.slice(-6)} history is timestamped in order`);
      check(c.updated_at === ev.at(-1)!.at && !!c.sent_at, `cert ${c.id.slice(-6)} updated_at equals the last event, sent_at set`);
    }
    check(emls().length === 3, `3 people -> 3 emails (${emls().length})`);

    prep('b_states2', [personAt(10), personAt(11)]);
    const failing: MailTransport = { name: 'capture', async send(m: OutboundMail) { if (m.to === 'p10@example.edu') throw new MailError('mailbox does not exist', false); return capture.send(m); }, wasSent: (id: string) => capture.wasSent(id) };
    const s1 = await runBatch('b_states2', deps('b_states2', { transport: failing }));
    check(s1.counts.FAILED === 1 && s1.counts.SENT === 1, `one permanent failure does not stop the other (${JSON.stringify(s1.counts)})`);
    const failed = certsOf('b_states2').find((c) => c.status === 'FAILED')!;
    check(failed.error_transient === 0 && /mailbox does not exist/.test(failed.error ?? ''), 'failure keeps a readable reason and is marked permanent');
    check(R.requestRetry(db, 'b_states2') === 1, 'requestRetry marks exactly the failed certificate');
    await runBatch('b_states2', deps('b_states2'));
    const chain = eventsOf(db, failed.id).filter((e) => e.from_status !== e.to_status).map((e) => `${e.from_status ?? 'null'}>${e.to_status}`);
    check(chain.join(' ') === 'null>PENDING PENDING>GENERATED GENERATED>SAVED SAVED>SENDING SENDING>FAILED FAILED>SENDING SENDING>SENT', `retry path ${chain.join(' ')}`);
    check(certsOf('b_states2').every((c) => c.status === 'SENT'), 'after the retry both are SENT');
  }

  if (which === 'failures') {
    const N = 200;
    const people: Person[] = Array.from({ length: N }, (_v, i) => personAt(i, i % 10 === 0 ? ['Participation', 'Best UI'] : ['Participation']));
    const CLS = { storagePerm: 20, storageTransientOk: 21, storageTransientAlways: 22, mailPerm: 3, mailTransientOk: 7, mailTransientAlways: 11, mailAmbiguous: 15 };
    const clsOf = (i: number) => (Object.entries(CLS).find(([, r]) => i % 25 === r)?.[0] ?? 'normal');
    const certCount = (i: number) => (i % 10 === 0 ? 2 : 1);
    const idx = (email: string) => Number(/^p(\d+)@/.exec(email)![1]);
    const { result } = prep('b_fail', people, { concurrency: 6 });
    const totalCerts = people.reduce((n, p) => n + p.awards.length, 0);
    check(result.certificates === 220 && totalCerts === 220 && result.people === 200, `prepared 220 certificates for 200 people (${result.certificates}/${result.people})`);

    const info = new Map<string, { i: number; award: string }>();
    for (const c of certsOf('b_fail')) {
      const rec = get<{ email: string }>(db, 'SELECT email FROM records WHERE id = ?', c.record_id)!;
      info.set(c.id, { i: idx(rec.email), award: c.category_label });
    }
    let phase = 1;
    const mailTries = new Map<string, number>();
    const storeTries = new Map<string, number>();
    const mailLog: string[] = [];
    const flaky: MailTransport = {
      name: 'capture',
      async send(m: OutboundMail) {
        const i = idx(m.to);
        const n = (mailTries.get(m.to) ?? 0) + 1;
        mailTries.set(m.to, n);
        mailLog.push(m.to);
        switch (clsOf(i)) {
          case 'mailPerm': throw new MailError('550 mailbox unavailable', false);
          case 'mailTransientOk': if (n <= 2) throw new MailError('421 try again later', true); break;
          case 'mailTransientAlways': if (phase === 1) throw new MailError('421 server busy', true); break;
          case 'mailAmbiguous': if (n === 1) { await capture.send(m); throw new MailError('connection reset after the message was accepted', true); } break;
          default: break;
        }
        return capture.send(m);
      },
      wasSent: (id: string) => capture.wasSent(id),
    };
    const flakyStorage = {
      name: 'local' as const,
      async save(c: { certId: string; fileName: string; pdf: Uint8Array }, folder: string[]) {
        const f = info.get(c.certId)!;
        const n = (storeTries.get(c.certId) ?? 0) + 1;
        storeTries.set(c.certId, n);
        const cls = clsOf(f.i);
        if (cls === 'storagePerm' && (certCount(f.i) === 1 || f.award === 'Best UI')) throw new StorageError('Drive says the folder is gone', false, 'Google Drive refused this file (folder missing).');
        if (cls === 'storageTransientOk' && n <= 2) throw new StorageError('503 backend error', true);
        if (cls === 'storageTransientAlways' && phase === 1) throw new StorageError('503 backend error', true);
        return storage.save(c, folder);
      },
    };
    const t0 = Date.now();
    const s1 = await runBatch('b_fail', deps('b_fail', { storage: flakyStorage, transport: flaky }));
    console.log(`  (run 1 took ${Date.now() - t0} ms)`);

    const sp = people.filter((p) => clsOf(p.i) === 'storagePerm');
    const stx = people.filter((p) => clsOf(p.i) === 'storageTransientAlways');
    const mp = people.filter((p) => clsOf(p.i) === 'mailPerm');
    const mtx = people.filter((p) => clsOf(p.i) === 'mailTransientAlways');
    const spFailedCerts = sp.reduce((n, p) => n + (certCount(p.i) === 1 ? 1 : 1), 0);
    const failed1 = spFailedCerts + stx.reduce((n, p) => n + certCount(p.i), 0) + mp.reduce((n, p) => n + certCount(p.i), 0) + mtx.reduce((n, p) => n + certCount(p.i), 0);
    const spSingle = sp.filter((p) => certCount(p.i) === 1).length;
    const emails1 = N - stx.length - spSingle - mp.length - mtx.length;
    check(failed1 === 32 && emails1 === 172, `oracle arithmetic: 32 failed certificates, 172 emails after run 1 (${failed1}/${emails1})`);
    const rows1 = certsOf('b_fail');
    const t1 = tally(rows1);
    check(t1.FAILED === 32 && t1.SENT === 188 && Object.keys(t1).length === 2, `run 1 counts ${JSON.stringify(t1)} (expected FAILED 32, SENT 188 and nothing else)`);
    check(s1.status === 'DONE' && /failed/.test(batchRow('b_fail').message ?? ''), `batch finished (status ${s1.status}) and says some certificates failed: "${batchRow('b_fail').message}"`);
    const e1 = emls();
    check(e1.length === emails1, `run 1 delivered ${e1.length} emails (expected ${emails1})`);
    const perAddr1 = sendersOf(e1);
    check([...perAddr1.values()].every((n) => n === 1), 'no address received two emails in run 1 (ambiguous deliveries were not repeated)');
    const amb = people.filter((p) => clsOf(p.i) === 'mailAmbiguous');
    check(amb.every((p) => perAddr1.get(p.email) === 1), 'delivered-then-connection-error recipients got exactly one email');
    check(amb.every((p) => (mailTries.get(p.email) ?? 0) === 1), 'ambiguous deliveries were confirmed with wasSent, not sent again');
    const ok2 = people.filter((p) => clsOf(p.i) === 'mailTransientOk');
    check(ok2.every((p) => mailTries.get(p.email) === 3 && perAddr1.get(p.email) === 1), 'temporary failures were retried inside the run (3 tries, 1 email each)');
    check(mp.every((p) => mailTries.get(p.email) === 1), 'permanent mail failures were tried once only');
    check(mtx.every((p) => mailTries.get(p.email) === 3), 'temporary failures give up after 3 tries');
    const multi1 = e1.filter((e) => e.pdfs.length === 2).length;
    check(multi1 === 16, `16 people with two awards got ONE email with two certificates (${multi1})`);
    await auditEmails(e1, 'run 1');
    for (const c of rows1.filter((r) => r.status === 'FAILED')) {
      const f = info.get(c.id)!;
      const cls = clsOf(f.i);
      const transient = cls === 'storageTransientAlways' || cls === 'mailTransientAlways';
      check(c.error_transient === (transient ? 1 : 0) && !!c.error && !/\n\s+at /.test(c.error), `failed ${f.i}/${f.award}: ${cls}, transient=${transient}, readable error`);
      if (failures > 8) break;
    }

    const untouched = rows1.filter((r) => r.status === 'SENT').map((r) => ({ id: r.id, updated_at: r.updated_at, attempts: r.attempts, message_id: r.message_id, sent_at: r.sent_at, ev: eventsOf(db, r.id).length }));
    const eml1Files = new Set(e1.map((e) => e.file));
    phase = 2;
    mailLog.length = 0;
    check(R.requestRetry(db, 'b_fail') === 32, 'requestRetry selected the 32 failed certificates');
    const s2 = await runBatch('b_fail', deps('b_fail', { storage: flakyStorage, transport: flaky }));
    const rows2 = certsOf('b_fail');
    const t2 = tally(rows2);
    check(t2.FAILED === 16 && t2.SENT === 204 && Object.keys(t2).length === 2, `after retry ${JSON.stringify(t2)} (expected FAILED 16 = permanent only, SENT 204)`);
    const same = untouched.every((u) => {
      const r = rows2.find((x) => x.id === u.id)!;
      return r.status === 'SENT' && r.updated_at === u.updated_at && r.attempts === u.attempts && r.message_id === u.message_id && r.sent_at === u.sent_at && eventsOf(db, r.id).length === u.ev;
    });
    check(same, 'retry did not touch any of the 188 already-SENT rows (status, timestamps, attempts, history identical)');
    const e2 = emls();
    const fresh = e2.filter((e) => !eml1Files.has(e.file));
    check(fresh.length === 16 && e2.length === 188, `retry sent exactly 16 new emails (${fresh.length}), 188 in total (${e2.length})`);
    const freshTo = new Set(fresh.map((e) => e.to));
    check([...freshTo].every((to) => { const c = clsOf(idx(to)); return c === 'storageTransientAlways' || c === 'mailTransientAlways'; }) && freshTo.size === 16, 'new emails went only to the people whose earlier failure was temporary');
    const mpEmails = new Set(mp.map((p) => p.email));
    check(mailLog.length === 16 + 8 && mailLog.every((to) => freshTo.has(to) || mpEmails.has(to)), `the mail transport was called only for the 16 recoverable + 8 permanently refused failures during the retry (${mailLog.length} calls)`);
    await auditEmails(e2, 'after retry');
    check(sendersOf(e2).size === 188 - 0 && [...sendersOf(e2).values()].every((n) => n === 1), 'still at most one email per address');
    check(storedPdfs().length === 212, `212 certificate files stored once each (${storedPdfs().length}; 8 refused by Drive)`);
    const dupNames = new Set(storedPdfs().map((f) => path.basename(f).toLowerCase()));
    check(dupNames.size === storedPdfs().length, 'no two stored files share a name');

    const before3 = emls().length;
    check(R.requestRetry(db, 'b_fail') === 16, 'second retry selects the 16 permanent failures');
    const s3 = await runBatch('b_fail', deps('b_fail', { storage: flakyStorage, transport: flaky }));
    const t3 = tally(certsOf('b_fail'));
    check(t3.FAILED === 16 && t3.SENT === 204 && emls().length === before3, `permanent failures stay FAILED, no new email (${JSON.stringify(t3)}, ${emls().length})`);
    check(s2.status === 'DONE' && s3.status === 'DONE', 'batch status is DONE after each run');
    check(certsOf('b_fail').filter((c) => c.status === 'FAILED').every((c) => c.error_transient === 0 && c.attempts >= 2), 'permanent failures were genuinely re-attempted (attempts >= 2) and stay permanent');

    const gpeople = [0, 1, 2, 3, 4, 5].map((k) => personAt(500 + k));
    prep('b_guard', gpeople);
    const gbase = emls().length;
    const gdeps = deps('b_guard');
    const realCompose = gdeps.compose;
    gdeps.compose = (items, mid, corr) => {
      const mail = realCompose(items, mid, corr);
      if (mail.to === 'p500@example.edu') mail.to = 'someone.else@example.org';
      if (mail.to === 'p501@example.edu') mail.attachments = mail.attachments.map((a) => ({ ...a, content: new Uint8Array(a.content.length) }));
      return mail;
    };
    const realRender = gdeps.renderCert;
    gdeps.renderCert = async (cert, rec) => { if (rec.email === 'p502@example.edu') throw new Error('font file is corrupt'); return realRender(cert, rec); };
    const sg = await runBatch('b_guard', gdeps);
    const tg = tally(certsOf('b_guard'));
    check(sg.status === 'DONE' && tg.SENT === 3 && tg.FAILED === 3 && Object.keys(tg).length === 2, `guard + render errors: 3 sent, 3 failed, batch finished (${JSON.stringify(tg)})`);
    check(emls().length - gbase === 3 && emls().every((e) => e.to !== 'someone.else@example.org' && e.to !== 'p500@example.edu' && e.to !== 'p501@example.edu'), 'blocked emails were never sent, not even to the wrong address');
    const gfailed = certsOf('b_guard').filter((c) => c.status === 'FAILED');
    check(gfailed.filter((c) => /^Blocked:/.test(c.error ?? '')).length === 2 && gfailed.some((c) => /font file is corrupt/.test(c.error ?? '')) && gfailed.every((c) => c.error_transient === 0), 'guard errors say "Blocked: ..." and the render error says what broke; none is retried automatically');

    prep('b_per', [personAt(600, ['Participation', 'Best UI']), personAt(601)], { delivery: 'email-per-certificate' });
    const pbase = emls().length;
    await runBatch('b_per', deps('b_per'));
    const per = emls().slice().filter((e) => e.to === 'p600@example.edu' || e.to === 'p601@example.edu');
    check(emls().length - pbase === 3 && per.length === 3 && per.every((e) => e.pdfs.length === 1) && sendersOf(per).get('p600@example.edu') === 2, 'email-per-certificate: 3 certificates -> 3 emails, one PDF each');
  }

  if (which === 'duplicates') {
    let calls = 0;
    const counting: MailTransport = { name: 'capture', async send(m: OutboundMail) { calls++; return capture.send(m); }, wasSent: (id: string) => capture.wasSent(id) };
    const A = [personAt(1), personAt(2), personAt(3, ['Participation', 'Best UI']), personAt(4), personAt(5)];
    prep('b_a', A);
    await runBatch('b_a', deps('b_a', { transport: counting }));
    check(tally(certsOf('b_a')).SENT === 6 && calls === 5 && emls().length === 5, `batch A: 6 certificates sent in 5 emails (calls ${calls}, outbox ${emls().length})`);

    const snap = (id: string) => certsOf(id).map((c) => `${c.id}|${c.status}|${c.updated_at}|${c.attempts}|${c.message_id}|${eventsOf(db, c.id).length}`).join('\n');
    const before = snap('b_a');
    await runBatch('b_a', deps('b_a', { transport: counting }));
    await runBatch('b_a', deps('b_a', { transport: counting }));
    check(calls === 5 && emls().length === 5 && snap('b_a') === before, 'running a finished batch twice more sends nothing and changes nothing');
    check(batchRow('b_a').status === 'DONE', 'finished batch stays DONE');

    const B = prep('b_b', A);
    check(B.result.alreadySent.length === 6 && B.result.certificates === 6, `re-uploading the same sheet reports 6 prior certificates (${B.result.alreadySent.length})`);
    check(B.result.alreadySent.every((x) => x.previousBatchId === 'b_a'), 'each warning names the earlier batch');
    const rowsB = certsOf('b_b');
    check(rowsB.length === 6 && rowsB.every((c) => c.status === 'SKIPPED' && (c.held_reason ?? '').startsWith('already-sent:b_a')), 'all 6 new certificates are SKIPPED, marked already-sent');
    check(rowsB.every((c) => /Already received in batch b_a/.test(eventsOf(db, c.id).at(-1)?.note ?? '')), 'the skip is explained in the history');
    const sB = await runBatch('b_b', deps('b_b', { transport: counting }));
    check(calls === 5 && emls().length === 5 && sB.status === 'DONE' && tally(certsOf('b_b')).SKIPPED === 6, 'running the duplicate batch sends nothing; batch is DONE with 6 SKIPPED');
    check(storedPdfs().length === 6, `skipped certificates were not even generated (${storedPdfs().length} files)`);

    const C = prep('b_c', [personAt(1), personAt(2), personAt(4, ['Special Jury']), personAt(6), personAt(7)]);
    check(C.result.alreadySent.length === 2 && C.result.certificates === 5, `partial overlap: 2 warnings (${C.result.alreadySent.length}), 5 certificates`);
    await runBatch('b_c', deps('b_c', { transport: counting }));
    const tC = tally(certsOf('b_c'));
    check(tC.SENT === 3 && tC.SKIPPED === 2, `3 sent, 2 skipped (${JSON.stringify(tC)})`);
    const perAddr = sendersOf(emls());
    check(perAddr.get('p4@example.edu') === 2 && perAddr.get('p6@example.edu') === 1 && perAddr.get('p1@example.edu') === 1, 'a second, different award is not a duplicate (p4 has 2 emails); repeats got nothing new');
    const D = prep('b_d', [personAt(1)], { event: 'Other Event 2026' });
    check(D.result.alreadySent.length === 0, 'same person and award at another event is not a duplicate');
    run(db, 'INSERT INTO organizers (id, email, name, created_at) VALUES (?, ?, ?, ?)', 'org_two', 'two@pipeline.test', 'Second Org', now);
    const E = prep('b_other', A, { organizerId: 'org_two' });
    check(E.result.alreadySent.length === 0 && tally(certsOf('b_other')).PENDING === 6, "another organizer's history does not leak into this batch");
    const sheetA = parseSheet(sheetBytes(A), 'x.csv');
    await rejects(() => prepareBatch(db, 'org_two', 'b_a', sheetA, buildConfig(sheetA)), "an organizer cannot prepare someone else's batch", /not found/i);
    await rejects(() => prepareBatch(db, ORG, 'b_a', sheetA, buildConfig(sheetA)), 'a batch that already sent cannot be prepared again', /already sent/i);

    const F = prep('b_f', [{ ...personAt(1), id: '' }, { ...personAt(2), id: '' }, { ...personAt(40), id: '' }]);
    check(F.result.alreadySent.length === 2 && tally(certsOf('b_f')).SKIPPED === 2 && tally(certsOf('b_f')).PENDING === 1, `sheet without IDs: the 2 repeats are found by email address (${F.result.alreadySent.length})`);

    createBatch('b_e');
    const sheetE = parseSheet(sheetBytes(A), 'students.csv');
    for (const bad of ['', '   ']) {
      await rejects(() => prepareBatch(db, ORG, 'b_e', sheetE, buildConfig(sheetE, { resend: bad })), `resend with reason "${bad}" is refused`, /reason/i);
    }
    check(certsOf('b_e').length === 0, 'a refused resend creates no certificates');
    const callsBeforeE = calls;
    const resendE = prepareBatch(db, ORG, 'b_e', sheetE, buildConfig(sheetE, { resend: 'Mail server lost the first send' }));
    check(resendE.alreadySent.length === 6 && tally(certsOf('b_e')).PENDING === 6, 'with a reason the 6 repeats are PENDING again (and still reported)');
    check(certsOf('b_e').every((c) => eventsOf(db, c.id).some((e) => /Resend approved: Mail server lost the first send/.test(e.note ?? ''))), 'the reason is saved in each certificate history');
    await runBatch('b_e', deps('b_e', { transport: counting }));
    check(calls - callsBeforeE === 5 && tally(certsOf('b_e')).SENT === 6, `resend batch sent exactly one more email per person (${calls - callsBeforeE})`);
    check(sendersOf(emls()).get('p2@example.edu') === 2, 'p2 now has exactly two emails (original + authorized resend)');

    prep('b_race', [personAt(300), personAt(301), personAt(302, ['Participation', 'Best UI']), personAt(303)]);
    const callsBeforeRace = calls;
    const race = await Promise.all([runBatch('b_race', deps('b_race', { transport: counting })), runBatch('b_race', deps('b_race', { transport: counting })), runBatch('b_race', deps('b_race', { transport: counting }))]);
    check(calls - callsBeforeRace === 4 && race.every((r) => r.counts.SENT === 5), `three simultaneous runBatch calls on one batch sent 4 emails in total (${calls - callsBeforeRace})`);

    prep('b_nostore', [personAt(310), personAt(311)]);
    const nsBase = emls().length;
    await runBatch('b_nostore', deps('b_nostore', { storage: null }));
    const nsRows = certsOf('b_nostore');
    check(nsRows.every((c) => c.status === 'SENT' && !c.storage_id) && emls().length - nsBase === 2, 'with storage turned off both certificates are sent without a saved copy');

    const emailOf = (c: CertRow) => get<{ email: string }>(db, 'SELECT email FROM records WHERE id = ?', c.record_id)!.email;
    const p2cert = certsOf('b_a').find((c) => emailOf(c) === 'p2@example.edu')!;
    const evBefore = eventsOf(db, p2cert.id).length;
    for (const bad of ['', '   ']) {
      await rejects(() => R.requestResend(db, p2cert.id, bad), `requestResend with reason "${bad}" is refused`, /reason/i);
    }
    check(get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', p2cert.id)!.status === 'SENT' && eventsOf(db, p2cert.id).length === evBefore, 'refused resend changes nothing');
    const callsBefore = calls;
    R.requestResend(db, p2cert.id, 'Student reports it went to spam');
    await rejects(() => R.requestResend(db, p2cert.id, 'clicked twice'), 'a second resend request before the first ran is refused', /already sent/i);
    await runBatch('b_a', deps('b_a', { transport: counting }));
    check(calls - callsBefore === 1, `exactly one more email was sent (${calls - callsBefore})`);
    const hist = eventsOf(db, p2cert.id).filter((e) => e.from_status !== e.to_status).map((e) => `${e.from_status}>${e.to_status}`).slice(-4).join(' ');
    check(hist === 'SENT>SENDING SENDING>SAVED SAVED>SENDING SENDING>SENT', `history of the resend: ${hist}`);
    check(eventsOf(db, p2cert.id).some((e) => e.from_status === 'SENT' && e.to_status === 'SENDING' && /Student reports it went to spam/.test(e.note ?? '')), 'the resend reason is audited');
    await runBatch('b_a', deps('b_a', { transport: counting }));
    check(calls - callsBefore === 1, 'running again sends no further copy');
    const p3best = certsOf('b_a').find((c) => c.category_label === 'Best UI')!;
    const sentBefore = emls().length;
    R.requestResend(db, p3best.id, 'Wrong attachment opened');
    await runBatch('b_a', deps('b_a', { transport: counting }));
    const p3mails = emls().filter((e) => e.to === 'p3@example.edu');
    check(emls().length === sentBefore + 1, 'person with two awards: resend of one produced one extra email');
    const sizes = p3mails.map((e) => e.pdfs.length).sort();
    check(p3mails.length === 3 && sizes.join() === '1,2,2', `p3 has the original two-certificate email, the batch-E resend and the single-certificate resend (${sizes.join()})`);
    const metaIds = (await Promise.all(p3mails.flatMap((e) => e.pdfs).map((pdf) => readCertMeta(pdf)))).map((m) => m.certId);
    check(metaIds.filter((id) => id === p3best.id).length === 2, 'the resent certificate is the Best UI one (attached in the original and the resend)');
    const pending = certsOf('b_other')[0];
    await rejects(() => R.requestResend(db, pending.id, 'please'), 'resending a certificate that was never sent is refused', /already sent/i);
    const skipped = certsOf('b_b')[0];
    await rejects(() => R.requestInclude(db, skipped.id, ' '), 'including a skipped certificate needs a reason', /reason/i);
    const callsBeforeInc = calls;
    R.requestInclude(db, skipped.id, 'Organizer confirmed the student never got it');
    await runBatch('b_b', deps('b_b', { transport: counting }));
    check(calls - callsBeforeInc === 1 && get<CertRow>(db, 'SELECT * FROM certificates WHERE id = ?', skipped.id)!.status === 'SENT', 'an included skipped certificate is sent exactly once');
    const seenAll = await auditEmailsLoose(emls());
    const twice = [...seenAll].filter(([, n]) => n > 1).map(([id]) => id).sort();
    check(JSON.stringify(twice) === JSON.stringify([p2cert.id, p3best.id].sort()) && [...seenAll.values()].every((n) => n <= 2), 'the only certificates attached twice are the two that were deliberately resent (each exactly twice)');
  }

  if (which === 'resume') {
    const N = 60;
    const people = Array.from({ length: N }, (_v, i) => personAt(i, i % 10 === 0 ? ['Participation', 'Best UI'] : ['Participation']));
    prep('b_resume', people, { concurrency: 4 });
    const totalCerts = 66;
    check(certsOf('b_resume').length === totalCerts, `prepared ${totalCerts} certificates for ${N} people`);
    const childScript = path.join(REPO, 'fixtures', 'pipeline', 'resume-child.ts');
    const tsxCli = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const markers = path.join(tmpRoot, 'markers');
    const children: ChildProcess[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const markerCount = (mode: string) => (fs.existsSync(markers) ? fs.readdirSync(markers).filter((f) => f.startsWith(`${mode}-`)).length : 0);
    async function crashChild(mode: 'save-hang' | 'send-hang', after: number): Promise<void> {
      const child = spawn(process.execPath, [tsxCli, childScript, '--data', DATA, '--batch', 'b_resume', '--org', ORG, '--mode', mode, '--after', String(after),
        '--markers', markers, '--store', storeDir, '--outbox', outboxDir], { cwd: REPO, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let out = '';
      child.stdout!.on('data', (d) => { out += String(d); });
      child.stderr!.on('data', (d) => { out += String(d); });
      const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
      const t0 = Date.now();
      while (markerCount(mode) < 4) {
        if (child.exitCode !== null) throw new Error(`child ended before hanging (code ${child.exitCode}): ${out.slice(-600)}`);
        if (Date.now() - t0 > 120_000) throw new Error(`child did not reach its crash point: ${out.slice(-600)}`);
        await sleep(50);
      }
      const snapBefore = JSON.stringify(statusCounts(db, 'b_resume'));
      await rejects(() => runBatch('b_resume', deps('b_resume')), `${mode}: a second runner is refused while the first is alive`, /already running/i);
      check(JSON.stringify(statusCounts(db, 'b_resume')) === snapBefore, `${mode}: the refused runner changed nothing`);
      await sleep(300);
      const realPid = Number(fs.readFileSync(path.join(markers, `${mode}.pid`), 'utf8'));
      try { process.kill(realPid, 'SIGKILL'); } catch {  }
      child.kill('SIGKILL');
      const code = await exited;
      for (let i = 0; i < 100; i++) { try { process.kill(realPid, 0); await sleep(50); } catch { break; } }
      check((() => { try { process.kill(realPid, 0); return false; } catch { return true; } })(), `${mode}: the runner process is really dead (pid ${realPid})`);
      check(code === null || code !== 0, `${mode}: child was killed hard (exit ${code})`);
    }
    try {
      await crashChild('save-hang', 20);
      const c1 = tally(certsOf('b_resume'));
      check((c1.GENERATED ?? 0) >= 1 && (c1.SAVED ?? 0) >= 15 && !c1.SENT && !c1.SENDING && emls().length === 0, `after crash 1: ${JSON.stringify(c1)}, no email yet`);
      check(storedPdfs().length >= 20, `after crash 1 ${storedPdfs().length} files are already stored`);
      await crashChild('send-hang', 25);
      const c2 = tally(certsOf('b_resume'));
      const delivered = emls();
      check((c2.SENDING ?? 0) >= 4 && (c2.SENT ?? 0) >= 20 && (c2.SAVED ?? 0) >= 1, `after crash 2: ${JSON.stringify(c2)}`);
      const recordedMessages = new Set(certsOf('b_resume').filter((c) => c.status === 'SENT').map((c) => c.message_id));
      check(delivered.length - recordedMessages.size === 2, `exactly 2 emails are in the outbox without a SENT record (${delivered.length} in outbox, ${recordedMessages.size} recorded)`);
      check(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM batch_locks')!.n >= 1, 'the dead runner left its lock behind');

      const t0 = Date.now();
      const s = await runBatch('b_resume', deps('b_resume'));
      console.log(`  (resume took ${Date.now() - t0} ms)`);
      const t3 = tally(certsOf('b_resume'));
      check(s.status === 'DONE' && t3.SENT === totalCerts && Object.keys(t3).length === 1, `resumed batch is DONE with all ${totalCerts} SENT (${JSON.stringify(t3)})`);
      const final = emls();
      const perAddr = sendersOf(final);
      check(final.length === N && perAddr.size === N && [...perAddr.values()].every((n) => n === 1), `zero double sends: ${final.length} emails for ${N} people, each address exactly once`);
      const sentMessageIds = new Set(certsOf('b_resume').map((c) => c.message_id));
      check(final.length === sentMessageIds.size, `outbox count (${final.length}) equals the number of SENT emails recorded (${sentMessageIds.size})`);
      check(final.filter((e) => e.pdfs.length === 2).length === 6, 'the six two-award people still got ONE email with both certificates');
      await auditEmails(final, 'after resume');
      const files = storedPdfs();
      check(files.length === totalCerts && new Set(files.map((f) => path.basename(f).toLowerCase())).size === totalCerts, `no duplicate stored files: ${files.length} files for ${totalCerts} certificates`);
      const index = JSON.parse(fs.readFileSync(path.join(storeDir, '.certflow-index.json'), 'utf8')) as Record<string, string>;
      const certIndex = Object.keys(index).filter((k) => !k.startsWith('report:'));
      check(certIndex.length === totalCerts && new Set(Object.values(index)).size === Object.keys(index).length, `storage index has one entry per certificate (${certIndex.length})`);
      const confirmed = certsOf('b_resume').filter((c) => eventsOf(db, c.id).some((e) => /Confirmed delivered after restart/.test(e.note ?? '')));
      const redone = certsOf('b_resume').filter((c) => eventsOf(db, c.id).some((e) => /Not delivered before the restart/.test(e.note ?? '')));
      check(confirmed.length >= 2 && redone.length >= 2, `restart recovery used the outbox: ${confirmed.length} confirmed delivered, ${redone.length} re-sent`);
      check(certsOf('b_resume').every((c) => c.attempts <= 2), 'no certificate needed more than 2 send attempts');
      check(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM batch_locks')!.n === 0, 'the run lock is released');
      await runBatch('b_resume', deps('b_resume'));
      check(emls().length === N, 'another run after completion sends nothing');
    } finally {
      for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
      for (const f of fs.existsSync(markers) ? fs.readdirSync(markers).filter((x) => x.endsWith('.pid')) : []) {
        try { process.kill(Number(fs.readFileSync(path.join(markers, f), 'utf8')), 'SIGKILL'); } catch {  }
      }
    }
  }

  if (which === 'bulk-quota') {
    const resetDay = () => run(db, 'DELETE FROM send_counts');
    const limited = (limit: number | undefined, extra?: (m: OutboundMail, n: number) => void): MailTransport & { sent: number } => {
      const t = { name: 'capture' as const, dailyLimit: limit, sent: 0, async send(m: OutboundMail) { t.sent++; extra?.(m, t.sent); return capture.send(m); }, wasSent: (id: string) => capture.wasSent(id) };
      return t;
    };
    let dayNo = 0;
    const nextDay = () => run(db, 'UPDATE send_counts SET day = ? WHERE day = ?', `2000-01-${String(++dayNo).padStart(2, '0')}`, new Date().toISOString().slice(0, 10));

    const big = Array.from({ length: 1000 }, (_v, i) => personAt(i));
    prep('b_big', big, { concurrency: 8 });
    const t0 = Date.now();
    const sBig = await runBatch('b_big', deps('b_big', { concurrency: 8 }));
    const ms = Date.now() - t0;
    console.log(`  (1,000 records took ${(ms / 1000).toFixed(1)} s)`);
    check(ms < 180_000, `1,000 records finished in under 3 minutes (${(ms / 1000).toFixed(1)} s)`);
    check(sBig.status === 'DONE' && sBig.counts.SENT === 1000, `all 1,000 SENT (${JSON.stringify(sBig.counts)})`);
    const bigEml = emls();
    const bigAddr = sendersOf(bigEml);
    check(bigEml.length === 1000 && bigAddr.size === 1000, `1,000 emails to 1,000 different addresses (${bigEml.length}/${bigAddr.size})`);
    check(storedPdfs().length === 1000, `1,000 certificate files stored (${storedPdfs().length})`);
    const sampleOk = await Promise.all([0, 137, 499, 998].map(async (k) => {
      const e = bigEml.find((x) => x.to === `p${k}@example.edu`)!;
      const meta = await readCertMeta(e.pdfs[0]);
      return meta.personKey === `id:s${1000 + k}`;
    }));
    check(sampleOk.every(Boolean), 'spot check: PDFs in sampled emails name the right person');

    resetDay();
    const quotaPeople = Array.from({ length: 300 }, (_v, i) => personAt(i + 2000, i % 10 === 0 ? ['Participation', 'Best UI'] : ['Participation']));
    prep('b_quota', quotaPeople, { concurrency: 8 });
    const base = emls().length;
    const lim = limited(120);
    const q1 = await runBatch('b_quota', deps('b_quota', { transport: lim, concurrency: 8 }));
    const isQuota = (e: Eml) => quotaPeople.some((p) => p.email === e.to);
    const sentCerts1 = emls().filter(isQuota).reduce((n, e) => n + e.pdfs.length, 0);
    check(emls().length - base === 120 && lim.sent === 120, `limit 120 with 8 workers: exactly 120 emails left (${emls().length - base}), never more`);
    const t = tally(certsOf('b_quota'));
    check(t.SENT === sentCerts1 && t.SAVED === 330 - sentCerts1 && Object.keys(t).length === 2, `the remainder is held, not failed: ${JSON.stringify(t)} (sent certificates ${sentCerts1})`);
    const heldRows = certsOf('b_quota').filter((c) => c.status === 'SAVED');
    check(heldRows.every((c) => c.held_reason === 'daily-limit') && q1.heldForQuota === heldRows.length, 'held certificates are marked daily-limit');
    const batch1 = batchRow('b_quota');
    check(batch1.status === 'PAUSED' && /tomorrow/i.test(batch1.message ?? '') && /sender/i.test(batch1.message ?? '') && /120/.test(batch1.message ?? ''), `batch PAUSED with a clear message: "${batch1.message}"`);
    await runBatch('b_quota', deps('b_quota', { transport: limited(120), concurrency: 8 }));
    check(emls().length - base === 120 && batchRow('b_quota').status === 'PAUSED', 'running again the same day sends nothing more and stays PAUSED');
    check(R.releaseQuotaHold(db, 'b_quota') === heldRows.length && batchRow('b_quota').status === 'READY', 'Continue releases the hold');
    nextDay();
    await runBatch('b_quota', deps('b_quota', { transport: limited(120), concurrency: 8 }));
    check(emls().length - base === 240 && batchRow('b_quota').status === 'PAUSED', `next day: another 120 (${emls().length - base})`);
    nextDay();
    const q3 = await runBatch('b_quota', deps('b_quota', { transport: limited(120), concurrency: 8 }));
    const finalQ = emls().filter(isQuota);
    const addrQ = sendersOf(finalQ);
    check(q3.status === 'DONE' && tally(certsOf('b_quota')).SENT === 330, `day 3 completes the batch: ${JSON.stringify(tally(certsOf('b_quota')))}`);
    check(finalQ.length === 300 && addrQ.size === 300 && [...addrQ.values()].every((n) => n === 1), 'no duplicate emails across the three days (300 emails, 300 addresses)');
    await auditEmails(finalQ, 'quota batch');

    resetDay();
    const ra = Array.from({ length: 40 }, (_v, i) => personAt(i + 3000));
    const rb = Array.from({ length: 40 }, (_v, i) => personAt(i + 3100));
    prep('b_par_a', ra, { concurrency: 8 });
    prep('b_par_b', rb, { concurrency: 8 });
    const baseP = emls().length;
    const shared = limited(50);
    await Promise.all([runBatch('b_par_a', deps('b_par_a', { transport: shared, concurrency: 8 })), runBatch('b_par_b', deps('b_par_b', { transport: shared, concurrency: 8 }))]);
    const tp = tally([...certsOf('b_par_a'), ...certsOf('b_par_b')]);
    check(emls().length - baseP === 50 && tp.SENT === 50 && tp.SAVED === 30, `two batches at once with limit 50: exactly 50 emails, 30 held (${emls().length - baseP}, ${JSON.stringify(tp)})`);

    resetDay();
    const pc = Array.from({ length: 60 }, (_v, i) => personAt(i + 5000));
    prep('b_switch', pc, { concurrency: 4 });
    const baseC = emls().length;
    await runBatch('b_switch', deps('b_switch', { transport: limited(25) }));
    check(emls().length - baseC === 25 && batchRow('b_switch').status === 'PAUSED', 'limit 25: 25 sent, PAUSED');
    R.releaseQuotaHold(db, 'b_switch');
    await runBatch('b_switch', deps('b_switch', { transport: limited(undefined) }));
    const addrC = sendersOf(emls().filter((e) => pc.some((p) => p.email === e.to)));
    check(batchRow('b_switch').status === 'DONE' && addrC.size === 60 && [...addrC.values()].every((n) => n === 1), 'after Continue with an unlimited sender all 60 are sent, none twice');

    resetDay();
    const pd = Array.from({ length: 60 }, (_v, i) => personAt(i + 7000));
    prep('b_provider', pd, { concurrency: 4 });
    const baseD = emls().length;
    const providerQuota = limited(undefined, (_m, n) => { if (n > 25) throw new MailError('Gmail sending limit reached (dailyLimitExceeded).', true, true); });
    const sD = await runBatch('b_provider', deps('b_provider', { transport: providerQuota }));
    const tD = tally(certsOf('b_provider'));
    check(emls().length - baseD === 25 && tD.SENT === 25 && tD.SAVED === 35 && !tD.FAILED, `provider quota error: 25 sent, 35 held, none failed (${JSON.stringify(tD)})`);
    check(sD.status === 'PAUSED' && /tomorrow/i.test(batchRow('b_provider').message ?? ''), 'provider quota pauses the batch with a clear message');
    R.releaseQuotaHold(db, 'b_provider');
    await runBatch('b_provider', deps('b_provider', { transport: limited(undefined) }));
    const addrD = sendersOf(emls().filter((e) => pd.some((p) => p.email === e.to)));
    check(batchRow('b_provider').status === 'DONE' && addrD.size === 60 && [...addrD.values()].every((n) => n === 1), 'after the limit resets all 60 are sent exactly once');
  }

  if (which === 'report') {
    check(['=1+1', '+1', '-1', '@a', '\t=1', '\r=1', ' =1', '|calc', ' \t@x', '=HYPERLINK("http://x","y")'].every((v) => /^"?'/.test(csvCell(v))), 'csvCell neutralizes every formula starter, also after leading spaces');
    check(csvCell('plain') === 'plain' && csvCell('a,b') === '"a,b"' && csvCell('say "hi"') === '"say ""hi"""' && csvCell(null) === '' && csvCell(12) === '12', 'csvCell leaves normal cells alone and quotes commas/quotes');
    const evil = [
      '=HYPERLINK("http://evil.example/?x=1","Click me")', '+1+1', '-2+3', '@SUM(1,1)', '|calc', 'Plain, Name "Quoted"', 'Ünïcode Ñame 日本', 'Ana "=" Maria',
      'Second Row Person', 'Third Row Person', 'Fourth Row Person', 'Fifth Row Person',
    ];
    const people: Person[] = evil.map((n, i) => ({ ...personAt(i + 1), name: n }));
    prep('b_rep', people, { name: 'Report Batch' });
    const permFail: MailTransport = { name: 'capture', async send(m: OutboundMail) { if (m.to === 'p3@example.edu' || m.to === 'p9@example.edu') throw new MailError('550 no such user "x", please check\nthe address', false); return capture.send(m); }, wasSent: (id: string) => capture.wasSent(id) };
    await runBatch('b_rep', deps('b_rep', { transport: permFail }));
    const more = [people[0], people[5], ...Array.from({ length: 4 }, (_v, i) => ({ ...personAt(100 + i), name: `New Person ${i}` }))];
    prep('b_rep2', more, { name: 'Second Report' });
    const twoOnly: MailTransport = { name: 'capture', dailyLimit: 2, send: (m: OutboundMail) => capture.send(m), wasSent: (id: string) => capture.wasSent(id) };
    run(db, 'DELETE FROM send_counts');
    await runBatch('b_rep2', deps('b_rep2', { transport: twoOnly }));

    for (const batchId of ['b_rep', 'b_rep2']) {
      const csv = batchReportCsv(db, batchId);
      check(csv.charCodeAt(0) === 0xfeff && csv.includes('\r\n'), `${batchId}: UTF-8 with BOM and CRLF lines (Excel-friendly)`);
      const table = parseCsv(csv);
      check(JSON.stringify(table[0]) === JSON.stringify(REPORT_HEADERS), `${batchId}: header row`);
      const rows = table.slice(1);
      const dbRows = all<CertRow & { email: string; values_json: string; row_number: number }>(db, 'SELECT c.*, r.email, r.values_json, r.row_number FROM certificates c JOIN records r ON r.id = c.record_id WHERE c.batch_id = ?', batchId);
      check(rows.length === dbRows.length && rows.every((r) => r.length === REPORT_HEADERS.length), `${batchId}: one well-formed line per certificate (${rows.length} = ${dbRows.length})`);
      const col = (name: string) => REPORT_HEADERS.indexOf(name);
      const csvCounts: Record<string, number> = {};
      for (const r of rows) csvCounts[r[col('Status')]] = (csvCounts[r[col('Status')]] ?? 0) + 1;
      const dbCounts = tally(dbRows);
      check(JSON.stringify(Object.entries(csvCounts).sort()) === JSON.stringify(Object.entries(dbCounts).sort()), `${batchId}: status counts match the database ${JSON.stringify(csvCounts)}`);
      const sc = statusCounts(db, batchId);
      check(Object.entries(sc).every(([k, n]) => (csvCounts[k] ?? 0) === n), `${batchId}: status counts match statusCounts()`);
      let formulas = 0;
      for (const r of rows) for (const cell of r) if (/^[=+\-@\t\r]/.test(cell)) formulas++;
      check(formulas === 0, `${batchId}: no cell starts with = + - @ tab or CR after parsing`);
      for (const d of dbRows) {
        const v = JSON.parse(d.values_json) as Record<string, string>;
        const line = rows.find((r) => r[col('Verify code')] === d.verify_code)!;
        const nameCell = line[col('Name')];
        const startsEvil = /^[=+\-@|]/.test(v.NAME);
        check(startsEvil ? nameCell === `'${v.NAME}` : nameCell === v.NAME, `${batchId}: name "${v.NAME.slice(0, 24)}" -> "${nameCell.slice(0, 26)}"`);
        const okLine = line[col('Email')] === d.email && line[col('Status')] === d.status && line[col('Row')] === String(d.row_number) && line[col('File name')] === d.file_name
          && line[col('Award')] === d.category_label && line[col('Attempts')] === String(d.attempts) && line[col('Last update')] === d.updated_at;
        const errOk = d.status === 'FAILED' ? line[col('Error')].length > 5 : line[col('Error')] === '';
        const sentOk = d.status === 'SENT' ? line[col('Sent at')] === d.sent_at && !!d.sent_at : line[col('Sent at')] === '';
        const linkOk = d.status === 'SENT' || d.status === 'SAVED' ? line[col('Link')] === `/api/files/${d.id}` : d.status === 'SKIPPED' ? line[col('Link')] === '' : true;
        const waitOk = d.status === 'SAVED' && d.held_reason === 'daily-limit' ? /limit/i.test(line[col('Waiting for')]) && /tomorrow/i.test(line[col('Waiting for')])
          : d.status === 'SKIPPED' ? /Already sent/i.test(line[col('Waiting for')]) : line[col('Waiting for')] === '';
        if (!(okLine && errOk && sentOk && linkOk && waitOk)) check(false, `${batchId}: line for ${d.id.slice(-6)} (${d.status}) is wrong: ${JSON.stringify(line)}`);
      }
      check(true, `${batchId}: every line carries email, award, file name, status, error, link, wait text, attempts and timestamps`);
    }
    const t1 = tally(certsOf('b_rep'));
    const t2 = tally(certsOf('b_rep2'));
    check(t1.FAILED === 2 && t1.SENT === 10, `first batch: 10 sent, 2 failed (${JSON.stringify(t1)})`);
    check(t2.SKIPPED === 2 && t2.SENT === 2 && t2.SAVED === 2, `second batch: 2 skipped, 2 sent, 2 held (${JSON.stringify(t2)})`);
    check(/\n/.test(certsOf('b_rep').find((c) => c.status === 'FAILED')?.error ?? ''), 'a multi-line error is in the data (so quoting is really exercised)');

    const reports = listFiles(path.join(storeDir, 'Facilify'), '.csv');
    check(reports.length === 2 && reports.every((f) => f.split(path.sep).includes('_reports')), `one report per batch in a _reports folder (${reports.map((f) => path.relative(storeDir, f)).join(' | ')})`);
    const mine = reports.find((f) => /Report Batch/.test(f))!;
    check(fs.readFileSync(mine, 'utf8') === batchReportCsv(db, 'b_rep'), 'the saved report is identical to the downloadable one');
    R.requestRetry(db, 'b_rep');
    await runBatch('b_rep', deps('b_rep', { transport: capture }));
    check(listFiles(path.join(storeDir, 'Facilify'), '.csv').length === 2, 'saving the report again replaces the file instead of adding another');
    check(fs.readFileSync(mine, 'utf8') === batchReportCsv(db, 'b_rep') && tally(certsOf('b_rep')).SENT === 12, 'the replaced report shows the retried certificates as SENT');
    check(storedPdfs().length === 12 + t2.SENT + t2.SAVED, `report files are not mixed with certificate PDFs (${storedPdfs().length} PDFs)`);
  }

  void crypto;
}

main().then(async () => {
  console.log(`${checks - failures}/${checks} checks passed`);
  try { (await import('@/lib/db')).closeDb(); } catch {  }
  if (failures) { console.log(`${failures} FAILED (working files kept in ${tmpRoot})`); process.exit(1); }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {  }
  console.log(TOKENS[which]);
}).catch((e) => {
  console.error((e as Error).stack ?? String(e));
  process.exit(1);
});
