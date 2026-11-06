import { MailError } from '@/lib/contracts';
import { buildTransport, orgSettings, senderAddress } from '@/lib/pipeline/services';
import { randomId } from '@/lib/secrets/crypto';
import { escapeHtml } from '@/lib/text';
import { htmlToText } from '@/lib/mail';
import { conflict, withApi } from '../../_shared';

export const dynamic = 'force-dynamic';

export const POST = withApi(async ({ db, org }) => {
  const transport = buildTransport(db, org.id);
  const o = orgSettings(db, org.id);
  const to = org.email;
  const html = `<p>Hello ${escapeHtml(org.name || 'there')},</p><p>This is a test message from Facilify. If you can read it, ${escapeHtml(o.name)} can send certificates this way.</p>`;
  const mail = { personKey: 'test', to, from: senderAddress(db, org.id, transport), subject: 'Facilify test message', html, text: htmlToText(html), attachments: [], messageId: `<cf.settings.${randomId('t').replace(/[^A-Za-z0-9]/g, '')}@certflow.local>` };
  try {
    await transport.send(mail);
  } catch (e) {
    if (e instanceof MailError) throw conflict(e.message);
    throw e;
  }
  return {
    ok: true, transport: transport.name, to,
    note: transport.name === 'capture' ? 'The test outbox saved the message as a file. Nothing was delivered.' : `A test message was sent to ${to}. Check that inbox.`,
  };
});
