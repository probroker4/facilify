import type { EmailSelection, FieldMapping, Issue, ParsedSheet, StudentRecord, ValidationResult } from '@/lib/contracts';
import { stableId } from '@/lib/hash';
import { normKey } from '@/lib/routing/norm';
import { canonicalAward, cellValue, splitAwards } from '@/lib/routing/discover';

export interface ValidateOptions {
  batchId: string;
  mapping: FieldMapping[];
  email: EmailSelection;
  required?: string[];
  awardColumns?: string[];
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function isValidEmail(v: string): boolean {
  if (!v || v.length > 254 || !EMAIL_RE.test(v)) return false;
  const [local] = v.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !v.includes('..');
}

export function cleanEmail(v: string | undefined): string {
  let s = (v ?? '').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\u00a0/g, ' ').trim();
  s = s.replace(/^mailto:/i, '').trim();
  const angled = /^[^<>]*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s);
  if (angled) s = angled[1];
  return s;
}

function normId(v: string | undefined): string {
  return (v ?? '').replace(/\s+/g, '').toLowerCase();
}

export function validateSheet(sheet: ParsedSheet, opts: ValidateOptions): ValidationResult {
  const headerOf = new Map(sheet.headers.map((h) => [normKey(h), h]));
  const resolve = (c: string): string => (sheet.headers.includes(c) ? c : headerOf.get(normKey(c)) ?? c);
  opts = {
    ...opts,
    mapping: opts.mapping.map((m) => ({ ...m, column: resolve(m.column) })),
    email: { primary: resolve(opts.email.primary), fallback: opts.email.fallback ? resolve(opts.email.fallback) : undefined },
    awardColumns: opts.awardColumns?.map(resolve),
  };
  const colFor = new Map(opts.mapping.map((m) => [m.placeholder, m.column]));
  const nameCol = colFor.get('NAME');
  const idCol = colFor.get('ID');
  const required = new Set(['NAME', ...(opts.required ?? [])]);
  const awardCols = opts.awardColumns ?? (colFor.get('CERTIFICATE_TYPE') ? [colFor.get('CERTIFICATE_TYPE')!] : []);
  const eventCol = colFor.get('EVENT');

  const issues: Issue[] = [];
  const valid: StudentRecord[] = [];
  const invalid: { rowNumber: number; issues: Issue[] }[] = [];
  const seenPersonAward = new Map<string, number>();
  const seenEmailAward = new Map<string, number>();

  sheet.rows.forEach((row, idx) => {
    const rowNumber = sheet.rowNumbers[idx] ?? idx + 2;
    const rowIssues: Issue[] = [];
    const add = (code: Issue['code'], severity: Issue['severity'], message: string, column?: string) =>
      rowIssues.push({ row: rowNumber, column, code, severity, message });

    const name = nameCol ? (row[nameCol] ?? '').trim() : '';
    if (!name) add('MISSING_NAME', 'error', 'Name is empty.', nameCol);

    const primary = cleanEmail(row[opts.email.primary]);
    const fallback = opts.email.fallback ? cleanEmail(row[opts.email.fallback]) : '';
    let email = '';
    let emailSource: 'primary' | 'fallback' = 'primary';
    if (isValidEmail(primary)) email = primary;
    else if (opts.email.fallback && isValidEmail(fallback)) {
      email = fallback; emailSource = 'fallback';
      add('FALLBACK_USED', 'warning', primary ? `"${primary}" is not a valid email, using ${opts.email.fallback} instead.` : `No ${opts.email.primary}, using ${opts.email.fallback} instead.`, opts.email.fallback);
    } else if (!primary && !fallback) add('MISSING_EMAIL', 'error', 'No email address.', opts.email.primary);
    else {
      const bad = primary || fallback;
      add('INVALID_EMAIL', 'error', `"${bad}" is not a valid email address.`, primary ? opts.email.primary : opts.email.fallback);
    }

    for (const ph of required) {
      if (ph === 'NAME') continue;
      const col = colFor.get(ph);
      if (col && !(row[col] ?? '').trim()) add('MISSING_REQUIRED', 'error', `${col} is empty but the certificate needs it.`, col);
      if (!col) add('MISSING_REQUIRED', 'error', `No column is chosen for {{${ph}}}.`);
    }

    const idVal = idCol ? normId(row[idCol]) : '';
    const personKey = idVal ? `id:${idVal}` : email ? `email:${email.toLowerCase()}` : `row:${rowNumber}`;
    const awardKey = awardCols.map((c) => [...new Set(splitAwards(row[c] ?? '').map(canonicalAward))].sort().join('+')).join('|');
    const eventKey = eventCol ? (row[eventCol] ?? '').trim().toLowerCase() : '';
    if (name && (idVal || email)) {
      const k = `${personKey}#${eventKey}#${awardKey}`;
      const first = seenPersonAward.get(k);
      if (first !== undefined) add('DUPLICATE_RECORD', 'error', `Same person and same award as row ${first}.`, idCol ?? nameCol);
      else seenPersonAward.set(k, rowNumber);
      if (email) {
        const ek = `${email.toLowerCase()}#${eventKey}#${awardKey}`;
        const firstE = seenEmailAward.get(ek);
        if (firstE !== undefined && first === undefined) add('DUPLICATE_RECORD', 'warning', `Same email and award as row ${firstE} but a different ID. Check it is not the same student twice.`, emailSource === 'fallback' ? opts.email.fallback : opts.email.primary);
        else if (firstE === undefined) seenEmailAward.set(ek, rowNumber);
      }
    }

    issues.push(...rowIssues);
    if (rowIssues.some((i) => i.severity === 'error')) {
      invalid.push({ rowNumber, issues: rowIssues });
      return;
    }
    const values: Record<string, string> = { ...row };
    for (const m of opts.mapping) values[m.placeholder] = (row[m.column] ?? '').trim();
    const mappedEmail = colFor.get('EMAIL');
    if (!values.EMAIL || mappedEmail === opts.email.primary || mappedEmail === opts.email.fallback) values.EMAIL = email;
    values.EMAIL_SELECTED = email;
    valid.push({ recordId: stableId('rec', opts.batchId, rowNumber), personKey, rowNumber, values, email, emailSource });
  });
  return { valid, invalid, issues };
}
