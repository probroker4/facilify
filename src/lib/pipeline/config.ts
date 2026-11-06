import type { AwardScheme, CertTemplate, EmailSelection, EmailTemplate, FieldMapping } from '@/lib/contracts';

export interface BatchConfig {
  mapping: FieldMapping[];
  email: EmailSelection;
  required: string[];
  scheme: AwardScheme;
  templates: Record<string, CertTemplate>;
  emailTemplates: Record<string, EmailTemplate>;
  defaultEmailTemplateId: string;
  folderPattern: string;
  organizationName: string;
  organizationId?: string;
  linkedIn: boolean;
  concurrency: number;
  issuedAt: string;
  resendAlreadySent?: { reason: string };
}

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  id: 'default-email',
  subject: 'Your certificate for {{EVENT}}',
  html: `<p>Dear {{NAME}},</p>
<p>Congratulations! Thank you for being part of <strong>{{EVENT}}</strong>. Your certificate for <strong>{{AWARDS}}</strong> is attached to this email.</p>
<p>Best wishes,<br>{{ORGANIZATION}}</p>`,
  includeDriveLink: true,
  includeLinkedIn: true,
};
