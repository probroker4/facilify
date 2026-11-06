import type { EmailTemplate } from '@/lib/contracts';
import { badRequest, plainText } from './_shared';

export function cleanEmailTemplate(body: unknown, id: string): { template: EmailTemplate; name: string } {
  const t = (body as { template?: EmailTemplate })?.template ?? (body as EmailTemplate);
  const subject = plainText(t?.subject, 200);
  const html = String(t?.html ?? '').slice(0, 20000);
  if (!subject) throw badRequest('The email needs a subject line.');
  if (!html.trim()) throw badRequest('The email needs a message.');
  const name = plainText((body as { name?: string })?.name, 80) || subject;
  return { name, template: { id, subject, html, includeDriveLink: !!t.includeDriveLink, includeLinkedIn: t.includeLinkedIn !== false } };
}
