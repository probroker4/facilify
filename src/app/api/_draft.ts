import type { AwardScheme, CertTemplate, EmailSelection, EmailTemplate, FieldMapping, ParsedSheet } from '@/lib/contracts';
import type { DB } from '@/lib/db/db';
import { getDoc, getSetting, type OrganizerRow } from '@/lib/db/repo';
import { parseSheet } from '@/lib/ingest/parse';
import { DEFAULT_EMAIL_TEMPLATE, type BatchConfig } from '@/lib/pipeline/config';
import { orgSettings } from '@/lib/pipeline/services';
import { BUILTIN_BACKGROUNDS, builtinTemplate } from '@/lib/render/builtin';
import { readUpload } from '@/lib/secrets/uploads';
import { DEFAULT_FOLDER_PATTERN } from '@/lib/storage';
import { badRequest } from './_shared';

export interface DraftConfig {
  mapping: FieldMapping[];
  email: EmailSelection;
  required?: string[];
  scheme: AwardScheme;
  templateIds?: string[];
  emailTemplateIds?: string[];
  defaultEmailTemplateId?: string;
  folderPattern?: string;
  organizationName?: string;
  organizationId?: string;
  linkedIn?: boolean;
  concurrency?: number;
  issuedAt?: string;
  skipRows?: number[];
  resendAlreadySent?: { reason: string };
}

export function loadSheet(db: DB, org: OrganizerRow, uploadId: unknown, skipRows: number[] = []): ParsedSheet {
  if (typeof uploadId !== 'string' || !uploadId) throw badRequest('Please upload your student sheet first.');
  const up = readUpload(db, org.id, uploadId);
  if (up.kind !== 'sheet') throw badRequest('That upload is not a student sheet.');
  const sheet = parseSheet(up.bytes, up.name);
  return withoutRows(sheet, skipRows);
}

export function withoutRows(sheet: ParsedSheet, skipRows: number[] = []): ParsedSheet {
  const skip = new Set(skipRows.filter((n) => Number.isInteger(n)));
  if (!skip.size) return sheet;
  const keep = sheet.rowNumbers.map((n, i) => (skip.has(n) ? -1 : i)).filter((i) => i >= 0);
  return { ...sheet, rows: keep.map((i) => sheet.rows[i]), rowNumbers: keep.map((i) => sheet.rowNumbers[i]) };
}

const builtinIds = new Set(BUILTIN_BACKGROUNDS.map((b) => b.id));

export function resolveTemplate(db: DB, org: OrganizerRow, id: string): CertTemplate {
  const saved = getDoc<CertTemplate>(db, 'templates', org.id, id);
  if (saved) return { ...saved, id };
  const bare = id.replace(/^builtin:/, '');
  if (builtinIds.has(bare)) return { ...builtinTemplate(bare), id };
  throw badRequest('One of the chosen certificate designs no longer exists. Pick a design again in the Awards step.');
}

export function resolveEmailTemplate(db: DB, org: OrganizerRow, id: string): EmailTemplate {
  const saved = getDoc<EmailTemplate>(db, 'email_templates', org.id, id);
  if (saved) return { ...saved, id };
  if (id === DEFAULT_EMAIL_TEMPLATE.id) return DEFAULT_EMAIL_TEMPLATE;
  throw badRequest('The chosen email wording no longer exists. Open the Email step and save it again.');
}

function validateDraft(d: unknown): DraftConfig {
  const draft = d as DraftConfig;
  if (!draft || typeof draft !== 'object') throw badRequest('Missing batch settings.');
  if (!Array.isArray(draft.mapping)) throw badRequest('Match your columns first (the mapping is missing).');
  if (!draft.email?.primary) throw badRequest('Choose which column holds the email address.');
  if (!draft.scheme || !Array.isArray(draft.scheme.categories)) throw badRequest('Set up the awards first.');
  if (!draft.mapping.some((m) => m.placeholder === 'NAME' && m.column)) throw badRequest('Choose which column holds the student name.');
  return draft;
}

export function buildConfig(db: DB, org: OrganizerRow, d: unknown): { config: BatchConfig; draft: DraftConfig } {
  const draft = validateDraft(d);
  const scheme = draft.scheme;
  const ids = new Set<string>(draft.templateIds ?? []);
  for (const c of scheme.categories) if (c.templateId) ids.add(c.templateId);
  if (scheme.defaultTemplateId) ids.add(scheme.defaultTemplateId);
  if (!ids.size) throw badRequest('Choose a certificate design for at least one award.');
  const templates: Record<string, CertTemplate> = {};
  for (const id of ids) templates[id] = resolveTemplate(db, org, id);

  const defaultEmailId = draft.defaultEmailTemplateId || DEFAULT_EMAIL_TEMPLATE.id;
  const emailIds = new Set<string>([defaultEmailId, ...(draft.emailTemplateIds ?? [])]);
  for (const c of scheme.categories) if (c.emailTemplateId) emailIds.add(c.emailTemplateId);
  const emailTemplates: Record<string, EmailTemplate> = {};
  for (const id of emailIds) emailTemplates[id] = resolveEmailTemplate(db, org, id);

  const o = orgSettings(db, org.id);
  const config: BatchConfig = {
    mapping: draft.mapping,
    email: draft.email,
    required: draft.required?.length ? draft.required : ['NAME'],
    scheme,
    templates,
    emailTemplates,
    defaultEmailTemplateId: defaultEmailId,
    folderPattern: draft.folderPattern || getSetting<string>(db, org.id, 'folderPattern') || DEFAULT_FOLDER_PATTERN,
    organizationName: draft.organizationName || o.name,
    organizationId: draft.organizationId || o.linkedInOrgId,
    linkedIn: draft.linkedIn ?? o.linkedInEnabled,
    concurrency: draft.concurrency || 4,
    issuedAt: draft.issuedAt || new Date().toISOString(),
    resendAlreadySent: draft.resendAlreadySent,
  };
  return { config, draft };
}
