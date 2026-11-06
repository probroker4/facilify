'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, PageLoading, ProgressBar, StepFooter } from '@/components/ui/card';
import { CheckboxField, TextField } from '@/components/ui/form';
import { SendIcon } from '@/components/ui/icons';
import { api, errorText } from '@/components/wizard/api';
import { StepGate } from '@/components/wizard/gate';
import { SENDER_LABEL, STORAGE_LABEL, useMe } from '@/components/wizard/me-context';
import { useWizard } from '@/components/wizard/wizard-context';

interface Detail {
  batch: { id: string; name: string; status: string; message: string | null };
  counts: Record<string, number>; total: number; running: boolean; testSent: { to?: string; at?: string } | null;
  certificates: { id: string; held_reason: string | null }[];
}
interface TestResult { ok: boolean; to: string; transport: string; from: string; studentName: string; certificates: number; note: string }

function SendInner() {
  const { draft } = useWizard();
  const { me } = useMe();
  const batchId = draft.batchId;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [to, setTo] = useState(me.organizer.email);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!batchId) return;
    try { setDetail(await api<Detail>(`/api/batches/${encodeURIComponent(batchId)}?page=1`)); } catch (e) { setError(errorText(e)); }
  }, [batchId]);

  useEffect(() => { void load(); }, [load]);
  const running = !!detail?.running;
  useEffect(() => {
    const t = setInterval(() => void load(), running ? 1500 : 6000);
    return () => clearInterval(t);
  }, [load, running]);

  if (!batchId) {
    return <Alert type="warning" title="Prepare the batch first">Go back to Preview and click &quot;Prepare&quot;.</Alert>;
  }
  if (!detail) return <PageLoading label="Loading your batch" />;

  const c = detail.counts;
  const sent = c.SENT ?? 0, failed = c.FAILED ?? 0, skipped = c.SKIPPED ?? 0;
  const toSend = detail.total - skipped;
  const open = (c.PENDING ?? 0) + (c.GENERATED ?? 0) + (c.SAVED ?? 0) + (c.SENDING ?? 0);
  const started = sent + failed > 0 || running;
  const finished = started && !running && open === 0;
  const held = !running && detail.certificates.some((x) => x.held_reason === 'daily-limit');
  const testOk = !!detail.testSent;

  const sendTest = async () => {
    setTesting(true); setError(null);
    try { setTest(await api<TestResult>(`/api/batches/${encodeURIComponent(batchId)}/test-send`, { json: { to } })); await load(); }
    catch (e) { setError(errorText(e)); } finally { setTesting(false); }
  };
  const start = async () => {
    setStarting(true); setError(null);
    try { await api(`/api/batches/${encodeURIComponent(batchId)}/start`, { json: { confirm: true } }); setConfirm(false); await load(); }
    catch (e) { setError(errorText(e)); } finally { setStarting(false); }
  };
  const act = async (path: string) => {
    setError(null);
    try { await api(`/api/batches/${encodeURIComponent(batchId)}/${path}`, { json: {} }); await load(); } catch (e) { setError(errorText(e)); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <PageHeader step="Step 8 of 8" title="Test, then send" help="send" subtitle={`${detail.batch.name}: ${toSend} certificate${toSend === 1 ? '' : 's'} ready.`} />
      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}

      <Card aria-labelledby="where-heading">
        <h2 id="where-heading" className="text-base font-semibold text-slate-900">Where everything goes</h2>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-slate-500">Emails are sent by</dt><dd data-testid="sender">{SENDER_LABEL[me.sender]}</dd>
          <dt className="text-slate-500">PDFs are saved to</dt><dd data-testid="storage">{STORAGE_LABEL[me.storage]}</dd>
        </dl>
        {me.sender === 'capture' && <Alert type="warning" className="mt-3" title="Test outbox is on">Nothing will really be delivered: emails are saved as files. To email students, connect Gmail or your email server in <a className="font-semibold underline" href="/settings">Settings</a>.</Alert>}
        {me.storage === 'none' && <Alert type="info" className="mt-3">Certificates are only emailed, not stored. Choose a folder or Google Drive in <a className="font-semibold underline" href="/settings">Settings</a> to keep a copy.</Alert>}
      </Card>

      {!finished && (
        <Card aria-labelledby="test-heading">
          <h2 id="test-heading" className="text-base font-semibold text-slate-900">1. Send a test to yourself</h2>
          <p className="mt-0.5 text-sm text-slate-600">You receive the first student&apos;s real email, marked [TEST]. Nobody else gets anything.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1"><TextField label="Send the test to" type="email" value={to} onChange={(e) => setTo(e.target.value)} data-testid="test-to" /></div>
            <Button onClick={sendTest} loading={testing} disabled={!to.trim() || running} variant="outline" data-testid="test-send">Send test email</Button>
          </div>
          {(test || testOk) && (
            <p className="mt-3 text-sm text-emerald-800" role="status" data-testid="test-done">
              {test ? `Test sent to ${test.to}${test.studentName ? ` (the email for ${test.studentName})` : ''}. ${test.note}` : `A test was sent to ${detail.testSent?.to ?? 'you'}.`}
            </p>
          )}
        </Card>
      )}

      {!started && (
        <Card aria-labelledby="go-heading">
          <h2 id="go-heading" className="text-base font-semibold text-slate-900">2. Send to everyone</h2>
          <p className="mt-0.5 text-sm text-slate-600">Each student receives only their own certificate(s). You can watch progress and fix problems on the dashboard.</p>
          <div className="mt-3"><CheckboxField label={`Yes, send ${toSend} certificate${toSend === 1 ? '' : 's'} now`} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!testOk} data-testid="confirm" />
            {!testOk && <p className="ml-7 mt-1 text-xs text-slate-600">Send yourself a test first.</p>}</div>
          <div className="mt-4"><Button onClick={start} loading={starting} disabled={!confirm || !testOk} icon={<SendIcon size={16} />} data-testid="start">Send now</Button></div>
        </Card>
      )}

      {started && (
        <Card aria-labelledby="prog-heading" data-testid="progress">
          <h2 id="prog-heading" className="text-base font-semibold text-slate-900">{finished ? (failed ? 'Finished, with some problems' : 'All done') : running ? 'Sending...' : 'Paused'}</h2>
          <div className="mt-3"><ProgressBar value={sent} max={Math.max(1, toSend)} label={`${sent} of ${toSend} sent`} tone={failed ? 'rose' : 'emerald'} /></div>
          <p className="mt-2 text-sm text-slate-700" data-testid="counts">{sent} sent · {failed} failed · {open} waiting{skipped ? ` · ${skipped} skipped` : ''}</p>
          {detail.batch.message && <p className="mt-1 text-sm text-slate-600" role="status">{detail.batch.message}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {failed > 0 && !running && <Button variant="outline" size="sm" onClick={() => act('retry')} data-testid="retry">Retry {failed} failed</Button>}
            {held && <Button variant="outline" size="sm" onClick={() => act('continue')} data-testid="continue">Continue (sending limit reset)</Button>}
            <ButtonLink href="/dashboard" size="sm" data-testid="to-dashboard">Open the dashboard</ButtonLink>
          </div>
        </Card>
      )}

      <StepFooter back={<ButtonLink href="/preview" variant="ghost">Back</ButtonLink>} />
    </div>
  );
}

export default function SendPage() {
  return <StepGate step={8}><SendInner /></StepGate>;
}
