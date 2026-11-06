'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, PageHeader, PageLoading } from '@/components/ui/card';
import { CheckboxField, RadioCard, TextField } from '@/components/ui/form';
import { api, errorText } from '@/components/wizard/api';
import { useMe } from '@/components/wizard/me-context';

type SenderKind = 'capture' | 'smtp' | 'gmail';
interface SettingsData {
  org: { name: string; email: string; linkedInOrgId?: string; linkedInEnabled: boolean };
  sender: { kind: SenderKind };
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; dailyLimit: number | null; hasPassword: boolean };
  storage: 'local' | 'drive' | 'none';
  folderPattern: string;
  google: { configured: boolean; connected: boolean; email: string | null };
  accountEmail: string;
}

export default function SettingsPage() {
  const { refresh } = useMe();
  const [s, setS] = useState<SettingsData | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setS(await api<SettingsData>('/api/settings')); } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!s) return error ? <Alert type="error">{error}</Alert> : <PageLoading label="Loading settings" />;

  const set = (patch: Partial<SettingsData>) => setS((cur) => (cur ? { ...cur, ...patch } : cur));
  const smtp = (p: Partial<SettingsData['smtp']>) => set({ smtp: { ...s.smtp, ...p } });

  const save = async () => {
    setBusy(true); setError(null); setMsg(null); setTestMsg(null);
    try {
      await api('/api/settings', {
        method: 'PUT',
        json: {
          org: { name: s.org.name, email: s.org.email, linkedInOrgId: s.org.linkedInOrgId ?? '', linkedInEnabled: s.org.linkedInEnabled },
          smtp: s.smtp.host ? { ...s.smtp, pass: pass || undefined } : undefined,
          sender: { kind: s.sender.kind },
          storage: s.storage,
          folderPattern: s.folderPattern,
        },
      });
      setPass('');
      setMsg('Saved.');
      await Promise.all([load(), refresh()]);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setTesting(true); setError(null); setTestMsg(null);
    try { const r = await api<{ note: string }>('/api/settings/test-sender', { json: {} }); setTestMsg(r.note); }
    catch (e) { setError(errorText(e)); } finally { setTesting(false); }
  };

  const disconnect = async () => {
    setError(null);
    try { await api('/api/settings/google', { method: 'DELETE' }); await Promise.all([load(), refresh()]); } catch (e) { setError(errorText(e)); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <PageHeader title="Settings" help="settings" subtitle="Who the emails come from, where certificates are saved, and how your organization appears." />
      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {msg && <Alert type="success" onDismiss={() => setMsg(null)}>{msg}</Alert>}

      <Card aria-labelledby="org-heading">
        <h2 id="org-heading" className="text-base font-semibold text-slate-900">Your organization</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextField label="Organization or club name" value={s.org.name} onChange={(e) => set({ org: { ...s.org, name: e.target.value } })} hint="Printed in emails and shown to students." data-testid="org-name" />
          <TextField label="Reply-to email" type="email" value={s.org.email} onChange={(e) => set({ org: { ...s.org, email: e.target.value } })} hint="Where students' replies go." data-testid="org-email" />
          <TextField label="LinkedIn company ID (optional)" value={s.org.linkedInOrgId ?? ''} onChange={(e) => set({ org: { ...s.org, linkedInOrgId: e.target.value } })} hint="Numbers only. Lets 'Add to LinkedIn' name your organization." data-testid="li-org" />
          <div className="self-end"><CheckboxField label="Put an 'Add to LinkedIn' button in every email" checked={s.org.linkedInEnabled} onChange={(e) => set({ org: { ...s.org, linkedInEnabled: e.target.checked } })} data-testid="li-enabled" /></div>
        </div>
      </Card>

      <Card aria-labelledby="google-heading">
        <h2 id="google-heading" className="text-base font-semibold text-slate-900">Google account</h2>
        {s.google.connected ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-emerald-800" data-testid="google-connected">Connected as {s.google.email ?? 'your Google account'}. You can send with Gmail and save to Google Drive.</p>
            <Button variant="outline" size="sm" onClick={disconnect} data-testid="google-disconnect">Disconnect</Button>
          </div>
        ) : s.google.configured ? (
          <div className="mt-2">
            <p className="text-sm text-slate-600">Connect Google to send emails from your Gmail and keep certificates in Google Drive.</p>
            <a className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800" href="/api/auth/google?next=/settings" data-testid="google-connect">Connect Google</a>
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-700" data-testid="google-setup-help">
            <p>The <strong>Connect Google</strong> button appears once this copy of Facilify has Google keys. One-time setup (about 10 minutes):</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open <a className="font-semibold text-indigo-800 underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> and create a project.</li>
              <li>Under APIs &amp; Services &gt; Library, turn on the <strong>Gmail API</strong> and the <strong>Google Drive API</strong>.</li>
              <li>Under the OAuth consent screen choose <strong>External</strong>, keep it in <strong>Testing</strong>, and add your Gmail address as a <strong>test user</strong>.</li>
              <li>Under Credentials create an <strong>OAuth client ID</strong> of type <strong>Web application</strong> with this redirect address: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/google/callback</code></li>
              <li>Copy the client ID and secret into the file <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">.env.local</code> (lines <code className="text-xs">GOOGLE_CLIENT_ID</code> and <code className="text-xs">GOOGLE_CLIENT_SECRET</code>), then restart Facilify and reload this page.</li>
            </ol>
            <p className="mt-2 text-slate-600">Until then, email goes to the test outbox or your own mail server, and certificates are saved to a folder on this computer.</p>
          </div>
        )}
      </Card>

      <Card aria-labelledby="send-heading">
        <h2 id="send-heading" className="text-base font-semibold text-slate-900">How emails are sent</h2>
        <div className="mt-3 grid gap-3" role="radiogroup" aria-label="How emails are sent">
          <RadioCard name="sender" value="capture" checked={s.sender.kind === 'capture'} onChange={() => set({ sender: { kind: 'capture' } })} title="Test outbox" description="Nothing is delivered. Emails are saved as files so you can look at them. Good for a first try." testId="sender-capture" />
          <RadioCard name="sender" value="gmail" checked={s.sender.kind === 'gmail'} onChange={() => set({ sender: { kind: 'gmail' } })} title="My Gmail account" description={s.google.connected ? 'Sent from your own Gmail address over a secure connection. Gmail limits how many you can send per day; Facilify pauses and continues for you.' : 'Connect your Google account above to use this.'} testId="sender-gmail" />
          <RadioCard name="sender" value="smtp" checked={s.sender.kind === 'smtp'} onChange={() => set({ sender: { kind: 'smtp' } })} title="My email server (SMTP)" description="Use your school or company mail server, or any provider that gives you SMTP details." testId="sender-smtp" />
        </div>
        {(s.sender.kind === 'smtp' || s.smtp.host) && (
          <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="smtp-form">
            <TextField label="Mail server" value={s.smtp.host} onChange={(e) => smtp({ host: e.target.value })} placeholder="smtp.example.com" data-testid="smtp-host" />
            <TextField label="Port" inputMode="numeric" value={String(s.smtp.port)} onChange={(e) => smtp({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} hint="Usually 587 (or 465 for SSL)." data-testid="smtp-port" />
            <TextField label="User name" value={s.smtp.user} onChange={(e) => smtp({ user: e.target.value })} autoComplete="off" data-testid="smtp-user" />
            <TextField label={s.smtp.hasPassword ? 'Password (saved; type to change)' : 'Password'} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" data-testid="smtp-pass" />
            <TextField label="Send from address" type="email" value={s.smtp.from} onChange={(e) => smtp({ from: e.target.value })} data-testid="smtp-from" />
            <TextField label="Daily sending limit (optional)" inputMode="numeric" value={s.smtp.dailyLimit == null ? '' : String(s.smtp.dailyLimit)} onChange={(e) => smtp({ dailyLimit: e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null })} hint="Facilify pauses when it reaches this and carries on later." data-testid="smtp-limit" />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={sendTest} loading={testing} data-testid="send-test">Send me a test message</Button>
          <span className="text-xs text-slate-500">Save first if you changed anything above.</span>
        </div>
        {testMsg && <p className="mt-2 text-sm text-emerald-800" role="status" data-testid="test-msg">{testMsg}</p>}
      </Card>

      <Card aria-labelledby="store-heading">
        <h2 id="store-heading" className="text-base font-semibold text-slate-900">Where certificates are saved</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Where certificates are saved">
          <RadioCard name="storage" value="local" checked={s.storage === 'local'} onChange={() => set({ storage: 'local' })} title="A folder on this computer" description="Organized by event and award." testId="storage-local" />
          <RadioCard name="storage" value="drive" checked={s.storage === 'drive'} onChange={() => set({ storage: 'drive' })} title="Google Drive" description={s.google.connected ? 'Organized in folders in your Drive.' : 'Connect Google above first.'} testId="storage-drive" />
          <RadioCard name="storage" value="none" checked={s.storage === 'none'} onChange={() => set({ storage: 'none' })} title="Email only" description="Do not keep a copy." testId="storage-none" />
        </div>
        <div className="mt-4 max-w-lg">
          <TextField label="Folder layout" value={s.folderPattern} onChange={(e) => set({ folderPattern: e.target.value })} hint="Words in {{braces}} are replaced, for example {{EVENT}}/{{CATEGORY}}. Each certificate is saved inside the matching folders." data-testid="folder-pattern" />
        </div>
      </Card>

      <div><Button onClick={save} loading={busy} data-testid="save-settings">Save settings</Button></div>
    </div>
  );
}
