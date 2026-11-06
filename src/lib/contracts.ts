
export type RawRow = Record<string, string>;

export interface ParsedSheet {
  headers: string[];
  rows: RawRow[];
  sourceName: string;
  encoding: string;
  headerRowNumber: number;
  rowNumbers: number[];
}

export interface FieldMapping { placeholder: string; column: string }
export interface EmailSelection { primary: string; fallback?: string }

export type IssueCode =
  | 'MISSING_NAME' | 'MISSING_EMAIL' | 'INVALID_EMAIL' | 'DUPLICATE_RECORD'
  | 'MISSING_REQUIRED' | 'FALLBACK_USED' | 'NO_TEMPLATE_MATCH' | 'AMBIGUOUS_HEADER';

export interface Issue {
  row: number;
  column?: string;
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
}

export interface StudentRecord {
  recordId: string;
  personKey: string;
  rowNumber: number;
  values: Record<string, string>;
  email: string;
  emailSource: 'primary' | 'fallback';
}

export interface ValidationResult {
  valid: StudentRecord[];
  invalid: { rowNumber: number; issues: Issue[] }[];
  issues: Issue[];
}

export interface HeaderMatch {
  placeholder: string;
  typed?: string;
  column: string | null;
  confidence: number;
  candidates: string[];
  ambiguous: boolean;
}

export interface ColumnProfile { id: string; name: string; matches: Record<string, string> }

export interface FontRef {
  id: string;
  family: string;
  source: 'catalog' | 'bundled' | 'upload';
  weights: number[];
  italic: boolean;
}

export interface FitOptions {
  mode: 'shrink' | 'wrap' | 'shrink-then-wrap';
  allowAbbreviate: boolean;
  minLetterSpacing: number;
  uniformAcrossBatch: boolean;
}

export interface FitResult {
  lines: string[];
  fontSize: number;
  letterSpacing: number;
  shrunk: boolean;
  wrapped: boolean;
  abbreviated: boolean;
  overflow?: boolean;
}

export interface TextStyle {
  fontId: string;
  size: number;
  minSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  uppercase: boolean;
  opacity: number;
  rotation: number;
  maxLines: number;
  fit: FitOptions;
}

export interface TextLayer {
  id: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: TextStyle;
}

export interface CertTemplate {
  id: string;
  name: string;
  kind: 'builtin' | 'pdf' | 'image';
  pageSize: [number, number];
  backgroundRef?: string;
  layers: TextLayer[];
  qr?: { x: number; y: number; size: number };
}

export type CondOp = 'equals' | 'contains' | 'startsWith' | 'oneOf' | 'isEmpty' | 'between' | 'gte' | 'lte';

export interface Condition {
  column: string;
  op: CondOp;
  value?: string | string[] | number | [number, number];
}

export interface AwardCategory {
  id: string;
  label: string;
  values?: string[];
  match?: { all?: Condition[]; any?: Condition[] };
  priority: number;
  templateId: string;
  emailTemplateId?: string;
  driveSubfolder?: string;
  linkedInTitle?: string;
}

export interface AwardScheme {
  id: string;
  name: string;
  awardColumns: string[];
  categories: AwardCategory[];
  defaultTemplateId?: string;
  multiAward: 'first-match' | 'all-matches';
  delivery: 'one-email' | 'email-per-certificate';
}

export interface CertAssignment {
  certId: string;
  recordId: string;
  personKey: string;
  categoryId: string;
  templateId: string;
}

export interface RenderedCert {
  certId: string;
  recordId: string;
  fileName: string;
  pdf: Uint8Array;
  sha256: string;
  verifyCode: string;
  fits: Record<string, FitResult>;
}

export interface StoredCert {
  certId: string;
  driveFileId: string;
  webViewLink: string;
  folderPath: string;
}

export interface CertStorage {
  name: 'drive' | 'local' | 'none';
  save(c: Pick<RenderedCert, 'certId' | 'fileName' | 'pdf'>, folderPath: string[]): Promise<StoredCert>;
}

export interface EmailTemplate {
  id: string;
  subject: string;
  html: string;
  includeDriveLink: boolean;
  includeLinkedIn: boolean;
}

export interface MailAttachment { certId: string; fileName: string; content: Uint8Array; sha256: string }

export interface OutboundMail {
  personKey: string;
  to: string;
  from?: string;
  subject: string;
  html: string;
  text: string;
  attachments: MailAttachment[];
  messageId: string;
}

export interface MailTransport {
  name: 'gmail' | 'smtp' | 'capture';
  dailyLimit?: number;
  send(m: OutboundMail): Promise<{ messageId: string }>;
  wasSent?(messageId: string): Promise<boolean | 'unknown'>;
}

export type RecordStatus = 'PENDING' | 'GENERATED' | 'SAVED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface Ticket {
  id: string;
  certId: string;
  category: 'name' | 'event' | 'achievement' | 'date' | 'other';
  field?: string;
  suggested?: string;
  note?: string;
  status: 'OPEN' | 'RESOLVED' | 'REJECTED';
  createdAt: string;
  resolvedAt?: string;
}

export interface LinkedInCert {
  name: string;
  organizationName: string;
  organizationId?: string;
  issueYear: number;
  issueMonth: number;
  certUrl: string;
  certId: string;
}

export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class RenderError extends Error { constructor(msg: string) { super(msg); this.name = 'RenderError'; } }
export class MappingError extends Error { constructor(msg: string) { super(msg); this.name = 'MappingError'; } }
export class MailError extends Error {
  constructor(msg: string, public transient: boolean, public quota = false) { super(msg); this.name = 'MailError'; }
}
export class StorageError extends Error {
  constructor(msg: string, public transient: boolean, public userMessage?: string) { super(msg); this.name = 'StorageError'; }
}

export const STANDARD_PLACEHOLDERS = ['NAME', 'ID', 'EMAIL', 'PERSONAL_EMAIL', 'EVENT', 'CERTIFICATE_TYPE', 'ACHIEVEMENT', 'DATE'] as const;
