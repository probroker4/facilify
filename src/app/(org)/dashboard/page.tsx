'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, PageLoading, ProgressBar } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/form';
import { DownloadIcon, ExternalLinkIcon, PlusIcon, RefreshCwIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { api, errorText } from '@/components/wizard/api';
import { STORAGE_LABEL, useMe } from '@/components/wizard/me-context';
import { useWizard } from '@/components/wizard/wizard-context';

interface BatchRow {
  id: string; name: string; status: string; message: string | null; created_at: string; updated_at: string;
  counts: Record<string, number>; total: number; people: number; running: boolean;
}
interface CertRow {
  id: string; name: string; email: string; award: string; status: string; error: string | null; held_reason: string | null;
  attempts: number; sent_at: string | null; file_name: string; verify_code: string; web_link: string | null;
  folder_path: string | null; row_number: number; pdf_url: string; verify_url: string;
}
interface Detail {
  batch: { id: string; name: string; status: string; message: string | null };
  counts: Record<string, number>; total: number; running: boolean; certificates: CertRow[]; page: number; pageSize: number; matching: number;
  testSent: unknown;
}

const FILTERS: [string, string][] = [['', 'Everything'], ['SENT', 'Sent'], ['FAILED', 'Failed'], ['PENDING', 'Waiting'], ['SENDING', 'Sending'], ['SKIPPED', 'Skipped']];

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 16) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function DashboardPage() {
  const router = useRouter();
  const { reset } = useWizard();
  const { me } = useMe();
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendFor, setResendFor] = useState<CertRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const loadBatches = useCallback(async () => {
    try {
      const r = await api<{ batches: BatchRow[] }>('/api/batches');
      setBatches(r.batches);
      const wanted = new URLSearchParams(window.location.search).get('batch');
      setSelected((cur) => cur ?? (r.batches.some((b) => b.id === wanted) ? wanted : r.batches[0]?.id) ?? null);
    } catch (e) { setError(errorText(e)); setBatches((b) => b ?? []); }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selected) { setDetail(null); return; }
    const mine = ++seq.current;
    try {
      const p = new URLSearchParams({ page: String(page) });
      if (status) p.set('status', status);
      if (q.trim()) p.set('q', q.trim());
      const r = await api<Detail>(`/api/batches/${encodeURIComponent(selected)}?${p}`);
      if (mine === seq.current) setDetail(r);
    } catch (e) { if (mine === seq.current) setError(errorText(e)); }
  }, [selected, status, q, page]);

  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);

  const live = !!detail?.running || !!batches?.some((b) => b.running);
  useEffect(() => {
    const t = setInterval(() => { void loadBatches(); void loadDetail(); }, live ? 2000 : 10000);
    return () => clearInterval(t);
  }, [live, loadBatches, loadDetail]);

  const act = async (label: string, url: string, json?: unknown) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api<{ count?: number }>(url, { method: 'POST', json: json ?? {} });
      setNotice(`${label}${typeof r.count === 'number' ? ` (${r.count} certificate${r.count === 1 ? '' : 's'})` : ''}.`);
      await Promise.all([loadBatches(), loadDetail()]);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const resend = async () => {
    if (!resendFor) return;
    await act(`Sending ${resendFor.name || 'the certificate'} again`, `/api/certificates/${encodeURIComponent(resendFor.id)}/resend`, { reason });
    setResendFor(null); setReason('');
  };

  const startNew = () => { reset(); router.push('/upload'); };
  const sel = batches?.find((b) => b.id === selected);
  const held = !!detail && !detail.running && detail.certificates.some((c) => c.held_reason === 'daily-limit');
  const failed = detail?.counts.FAILED ?? 0;

  if (!batches) return <PageLoading label="Loading your batches" />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <PageHeader title="Dashboard" help="dashboard"
        subtitle={`Every certificate, whether it was sent, and where it is saved (${STORAGE_LABEL[me.storage]}).`}
        actions={<Button onClick={startNew} icon={<PlusIcon size={16} />} data-testid="new-batch">New batch</Button>} />

      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert type="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {me.openTickets > 0 && (
        <Alert type="warning" title="Students reported a problem">
          {me.openTickets} open ticket{me.openTickets === 1 ? '' : 's'}. <Link className="font-semibold underline" href="/tickets">Open the Tickets inbox</Link> to fix and reissue.
        </Alert>
      )}

      {batches.length === 0 ? (
        <EmptyState title="No batches yet" action={<Button onClick={startNew} data-testid="empty-new">Start your first batch</Button>}>
          Upload a student sheet and Facilify will make and email every certificate. Sent certificates show up here.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="batch-list">
            {batches.map((b) => {
              const sent = b.counts.SENT ?? 0;
              const bad = b.counts.FAILED ?? 0;
              return (
                <button key={b.id} type="button" onClick={() => { setSelected(b.id); setPage(1); setStatus(''); setDetail(null); }}
                  className={`rounded-xl border bg-white p-4 text-left shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${b.id === selected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300'}`}
                  aria-pressed={b.id === selected} data-testid={`batch-${b.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{b.name}</span>
                    {b.running ? <Badge variant="indigo" dot>Sending now</Badge> : <StatusBadge status={b.status} />}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{when(b.created_at)} · {b.people} people · {b.total} certificate{b.total === 1 ? '' : 's'}</p>
                  <div className="mt-3"><ProgressBar value={sent} max={Math.max(1, b.total)} label={`${sent} of ${b.total} sent`} tone={bad ? 'rose' : 'emerald'} /></div>
                  <p className="mt-1.5 text-xs text-slate-600">{sent} sent{bad ? ` · ${bad} failed` : ''}{b.counts.PENDING ? ` · ${b.counts.PENDING} waiting` : ''}{b.counts.SKIPPED ? ` · ${b.counts.SKIPPED} skipped` : ''}</p>
                </button>
              );
            })}
          </div>

          {sel && (
            <Card aria-labelledby="detail-heading" className="!p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
                <div>
                  <h2 id="detail-heading" className="text-base font-semibold text-slate-900">{sel.name}</h2>
                  {sel.message && <p className="mt-0.5 text-sm text-slate-600" role="status">{sel.message}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {failed > 0 && <Button variant="outline" size="sm" loading={busy} onClick={() => act('Trying the failed ones again', `/api/batches/${selected}/retry`)} icon={<RefreshCwIcon size={15} />} data-testid="retry">Retry {failed} failed</Button>}
                  {held && <Button variant="outline" size="sm" loading={busy} onClick={() => act('Continuing', `/api/batches/${selected}/continue`)} data-testid="continue">Continue (sending limit reset)</Button>}
                  <a className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50" href={`/api/batches/${selected}/report`} data-testid="report-csv"><DownloadIcon size={15} />Download report (CSV)</a>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4 sm:px-5">
                <div className="w-44"><SelectField label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="status-filter">
                  {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}{v && detail ? ` (${detail.counts[v] ?? 0})` : ''}</option>)}
                </SelectField></div>
                <div className="min-w-56 flex-1"><TextField label="Search" placeholder="Name, email or award" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="search" /></div>
              </div>

              {!detail ? <div className="p-6"><PageLoading label="Loading certificates" /></div> : detail.certificates.length === 0 ? (
                <p className="p-6 text-sm text-slate-600">{detail.total === 0 ? 'No certificates were made for this batch yet.' : 'Nothing matches that filter.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm" data-testid="cert-table">
                    <caption className="sr-only">Certificates in {sel.name}</caption>
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr><th scope="col" className="px-4 py-2.5">Student</th><th scope="col" className="px-3 py-2.5">Award</th><th scope="col" className="px-3 py-2.5">Status</th><th scope="col" className="px-3 py-2.5">Certificate</th><th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.certificates.map((c) => (
                        <tr key={c.id} data-testid={`cert-${c.row_number}`}>
                          <td className="px-4 py-3"><div className="font-medium text-slate-900">{c.name || '(no name)'}</div><div className="text-xs text-slate-500">{c.email}</div></td>
                          <td className="px-3 py-3 text-slate-700">{c.award}</td>
                          <td className="px-3 py-3">
                            <StatusBadge status={c.status} />
                            {c.sent_at && <div className="mt-1 text-xs text-slate-500">{when(c.sent_at)}</div>}
                            {c.held_reason === 'daily-limit' && <div className="mt-1 text-xs text-amber-800">Waiting for the daily sending limit</div>}
                            {c.held_reason?.startsWith('already-sent') && <div className="mt-1 text-xs text-slate-600">Already received earlier</div>}
                            {c.error && <div className="mt-1 max-w-xs text-xs text-rose-700">{c.error}</div>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1 text-sm">
                              <a href={c.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-800 underline" data-testid={`pdf-${c.row_number}`}>View PDF</a>
                              {c.web_link && <a href={c.web_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-800 underline" data-testid={`drive-${c.row_number}`}>{/^https:\/\/(drive|docs)\.google\.com\//.test(c.web_link) ? 'Open in Drive' : 'Open saved copy'} <ExternalLinkIcon size={13} /></a>}
                              {c.folder_path && <span className="text-xs text-slate-500">{c.folder_path}</span>}
                              <a href={c.verify_url} target="_blank" rel="noreferrer" className="text-xs text-slate-600 underline">Verification page</a>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {c.status === 'SENT' && <Button variant="ghost" size="sm" onClick={() => { setResendFor(c); setReason(''); }} data-testid={`resend-${c.row_number}`}>Send again</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {detail && detail.matching > detail.pageSize && (
                <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm text-slate-600">
                  <span>Showing {(page - 1) * detail.pageSize + 1}-{Math.min(page * detail.pageSize, detail.matching)} of {detail.matching}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={page * detail.pageSize >= detail.matching} onClick={() => setPage(page + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <Modal open={!!resendFor} onClose={() => setResendFor(null)} title="Send this certificate again?"
        description={resendFor ? `${resendFor.name} (${resendFor.email}) will get ${resendFor.award} again. The reason is kept in the history.` : undefined}
        footer={<><Button variant="ghost" onClick={() => setResendFor(null)}>Cancel</Button><Button onClick={resend} disabled={reason.trim().length < 3} loading={busy} data-testid="resend-confirm">Send again</Button></>}>
        <TextField label="Why are you sending it again?" placeholder="For example: student lost the email" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="resend-reason" />
      </Modal>
    </div>
  );
}
