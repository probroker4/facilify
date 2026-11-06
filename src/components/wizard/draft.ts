import type { AwardCategory, AwardScheme, Condition, HeaderMatch } from '@/lib/contracts';
import type { DiscoveredCategory } from '@/lib/routing/discover';

export interface FieldSpec { key: string; label: string; help: string; required?: boolean }

export const FIELD_SPECS: FieldSpec[] = [
  { key: 'NAME', label: 'Student name', help: 'Printed on the certificate.', required: true },
  { key: 'EMAIL', label: 'Email address', help: 'Where the certificate is sent.', required: true },
  { key: 'PERSONAL_EMAIL', label: 'Backup email (optional)', help: 'Used only when the main email is empty or wrong.' },
  { key: 'ID', label: 'Student ID (optional)', help: 'Helps tell two students with the same name apart.' },
  { key: 'EVENT', label: 'Event name', help: 'For example "CodeSprint 2026".' },
  { key: 'CERTIFICATE_TYPE', label: 'Award or prize', help: 'For example "1st Prize". Facilify lists every different award it finds.' },
  { key: 'ACHIEVEMENT', label: 'What they achieved (optional)', help: 'A short line such as "Winner of the 24-hour hackathon".' },
  { key: 'DATE', label: 'Date (optional)', help: 'Printed on the certificate and used for LinkedIn.' },
];

export interface DraftCategory {
  id: string;
  key: string;
  label: string;
  values: string[];
  count: number;
  templateId: string;
  driveSubfolder?: string;
  linkedInTitle?: string;
  customEmail?: { subject: string; body: string; savedId?: string } | null;
}

export interface DraftRule {
  id: string;
  label: string;
  mode: 'all' | 'any';
  conditions: Condition[];
  templateId: string;
  driveSubfolder?: string;
  linkedInTitle?: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  includeDriveLink: boolean;
  includeLinkedIn: boolean;
  savedId?: string;
}

export interface Draft {
  v: 2;
  batchName: string;
  batchId?: string;
  upload?: { id: string; originalId: string; name: string };
  sheet?: { headers: string[]; rowCount: number; headerRowNumber: number; encoding: string; sampleRows: Record<string, string>[] };
  suggestions: HeaderMatch[];
  typed: Record<string, string>;
  mapping: Record<string, string>;
  awardColumns: string[];
  skipRows: number[];
  checked?: { validCount: number; total: number; blockingRows: number; skipped: number };
  discovered: DiscoveredCategory[];
  discoverSig?: string;
  categories: DraftCategory[];
  rules: DraftRule[];
  defaultTemplateId: string;
  multiAward: AwardScheme['multiAward'];
  delivery: AwardScheme['delivery'];
  schemeName: string;
  email: EmailDraft;
  prepared?: { at: string; certificates: number; people: number; emails: number };
  allowRepeat?: { reason: string };
}

export const DEFAULT_SUBJECT = 'Your certificate for {{EVENT}}';
export const DEFAULT_BODY = `Dear {{NAME}},

Congratulations! Thank you for being part of {{EVENT}}. Your certificate for {{AWARDS}} is attached to this email.

Best wishes,
{{ORGANIZATION}}`;

export function emptyDraft(): Draft {
  return {
    v: 2,
    batchName: '',
    suggestions: [],
    typed: {},
    mapping: {},
    awardColumns: [],
    skipRows: [],
    discovered: [],
    categories: [],
    rules: [],
    defaultTemplateId: '',
    multiAward: 'all-matches',
    delivery: 'one-email',
    schemeName: '',
    email: { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY, includeDriveLink: false, includeLinkedIn: true },
  };
}

export const BUILTIN_CHOICES: { id: string; name: string }[] = [
  { id: 'builtin:gold', name: 'Gold (1st prize)' },
  { id: 'builtin:silver', name: 'Silver (2nd prize)' },
  { id: 'builtin:bronze', name: 'Bronze (3rd prize)' },
  { id: 'builtin:mention', name: 'Honourable mention' },
  { id: 'builtin:participation', name: 'Participation' },
  { id: 'builtin:classic', name: 'Classic navy' },
  { id: 'builtin:modern', name: 'Modern teal' },
  { id: 'builtin:elegant', name: 'Elegant ivory' },
];

export function defaultTemplateFor(key: string): string {
  const k = key.toLowerCase();
  if (k === '1st') return 'builtin:gold';
  if (k === '2nd') return 'builtin:silver';
  if (k === '3rd') return 'builtin:bronze';
  if (k.includes('honorable') || k.includes('mention')) return 'builtin:mention';
  if (k.includes('particip') || k.includes('attend') || k.includes('volunteer')) return 'builtin:participation';
  if (/^\d+(st|nd|rd|th)$/.test(k)) return 'builtin:classic';
  return 'builtin:modern';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';

export function categoriesFromDiscovery(found: DiscoveredCategory[], previous: DraftCategory[]): DraftCategory[] {
  const byKey = new Map(previous.map((c) => [c.key, c]));
  return found.map((g) => {
    const old = byKey.get(g.key);
    return {
      id: `c_${slug(g.key)}`,
      key: g.key,
      label: old?.label && old.values.some((v) => g.values.includes(v)) ? old.label : g.label,
      values: [...g.values],
      count: g.count,
      templateId: old?.templateId ?? defaultTemplateFor(g.key),
      driveSubfolder: old?.driveSubfolder,
      linkedInTitle: old?.linkedInTitle,
      customEmail: old?.customEmail ?? null,
    };
  });
}

export function templateIdsInUse(d: Draft): string[] {
  const ids = new Set<string>();
  for (const c of d.categories) if (c.templateId) ids.add(c.templateId);
  for (const r of d.rules) if (r.templateId) ids.add(r.templateId);
  if (d.defaultTemplateId) ids.add(d.defaultTemplateId);
  return [...ids];
}

export function buildScheme(d: Draft, emailIdFor: (cat: DraftCategory) => string | undefined = () => undefined): AwardScheme {
  const categories: AwardCategory[] = [];
  d.rules.forEach((r, i) => {
    const conds = r.conditions.filter((c) => c.column);
    categories.push({
      id: r.id, label: r.label || `Rule ${i + 1}`, priority: i, templateId: r.templateId,
      match: r.mode === 'any' ? { any: conds } : { all: conds },
      driveSubfolder: r.driveSubfolder || undefined, linkedInTitle: r.linkedInTitle || undefined,
    });
  });
  d.categories.forEach((c, i) => {
    categories.push({
      id: c.id, label: c.label, values: c.values, priority: d.rules.length + i, templateId: c.templateId,
      emailTemplateId: emailIdFor(c), driveSubfolder: c.driveSubfolder || undefined, linkedInTitle: c.linkedInTitle || undefined,
    });
  });
  return {
    id: 'draft', name: d.schemeName || 'Awards', awardColumns: d.awardColumns, categories,
    defaultTemplateId: d.defaultTemplateId || undefined, multiAward: d.multiAward, delivery: d.delivery,
  };
}

export function mappingList(d: Draft): { placeholder: string; column: string }[] {
  const out: { placeholder: string; column: string }[] = [];
  for (const [placeholder, column] of Object.entries(d.mapping)) if (column) out.push({ placeholder, column });
  return out;
}

export function bodyToHtml(body: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function placeholdersFor(d: Draft): string[] {
  const out = new Set<string>(['NAME', 'EVENT', 'CERTIFICATE_TYPE', 'ACHIEVEMENT', 'DATE', 'ID']);
  for (const [k, v] of Object.entries(d.mapping)) if (v && k !== 'EMAIL' && k !== 'PERSONAL_EMAIL') out.add(k);
  out.add('VERIFY_CODE');
  const mappedColumns = new Set(Object.values(d.mapping));
  for (const h of d.sheet?.headers ?? []) if (!mappedColumns.has(h)) out.add(h);
  return [...out];
}

export function sampleRowsFor(d: Draft): Record<string, string>[] {
  const rows = d.sheet?.sampleRows ?? [];
  const awardCol = d.awardColumns[0];
  return rows.slice(0, 25).map((r) => {
    const out: Record<string, string> = { ...r };
    for (const [ph, col] of Object.entries(d.mapping)) if (col && col in r) out[ph] = r[col];
    if (awardCol && r[awardCol] && !out.CERTIFICATE_TYPE) out.CERTIFICATE_TYPE = r[awardCol];
    return out;
  }).filter((r) => r.NAME);
}

export interface StepInfo { id: number; slug: string; href: string; title: string; short: string }

export const STEPS: StepInfo[] = [
  { id: 1, slug: 'upload', href: '/upload', title: 'Upload your sheet', short: 'Upload' },
  { id: 2, slug: 'columns', href: '/columns', title: 'Match columns', short: 'Columns' },
  { id: 3, slug: 'fix', href: '/fix', title: 'Fix problems', short: 'Fix' },
  { id: 4, slug: 'awards', href: '/awards', title: 'Awards', short: 'Awards' },
  { id: 5, slug: 'design', href: '/design', title: 'Design', short: 'Design' },
  { id: 6, slug: 'email', href: '/email', title: 'Email wording', short: 'Email' },
  { id: 7, slug: 'preview', href: '/preview', title: 'Preview', short: 'Preview' },
  { id: 8, slug: 'send', href: '/send', title: 'Test and send', short: 'Send' },
];

export function columnsDone(d: Draft): boolean {
  return !!d.upload && !!d.mapping.NAME && !!d.mapping.EMAIL;
}

export function awardsDone(d: Draft): boolean {
  const covered = d.categories.length > 0 || d.rules.length > 0 || !!d.defaultTemplateId;
  return covered && d.categories.every((c) => !!c.templateId) && d.rules.every((r) => !!r.templateId && r.conditions.some((c) => c.column));
}

export function missingBefore(d: Draft, step: number): StepInfo | null {
  const checks: [number, boolean][] = [
    [1, !!d.upload],
    [2, columnsDone(d)],
    [3, !!d.checked && d.checked.blockingRows === 0 && d.checked.validCount > 0],
    [4, awardsDone(d)],
    [7, !!d.prepared],
  ];
  for (const [n, ok] of checks) if (step > n && !ok) return STEPS[n - 1];
  return null;
}

export function toDraftConfig(d: Draft): Record<string, unknown> {
  const scheme = buildScheme(d, (c) => c.customEmail?.savedId);
  const emailIds = d.categories.map((c) => c.customEmail?.savedId).filter((x): x is string => !!x);
  return {
    mapping: mappingList(d),
    email: { primary: d.mapping.EMAIL, fallback: d.mapping.PERSONAL_EMAIL || undefined },
    required: ['NAME'],
    scheme,
    templateIds: templateIdsInUse(d),
    emailTemplateIds: emailIds,
    defaultEmailTemplateId: d.email.savedId || undefined,
    skipRows: d.skipRows,
    resendAlreadySent: d.allowRepeat?.reason?.trim() ? d.allowRepeat : undefined,
  };
}
