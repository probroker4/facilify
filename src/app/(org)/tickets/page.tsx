'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, PageLoading } from '@/components/ui/card';
import { TextAreaField, TextField } from '@/components/ui/form';
import { api, errorText } from '@/components/wizard/api';
import { useMe } from '@/components/wizard/me-context';

interface TicketView {
  id: string; cert_id: string; category: string; field: string | null; suggested: string | null; note: string | null;
  status: string; resolution_note: string | null; created_at: string; resolved_at: string | null;
  name: string; email: string; award: string; batch_name: string; current: string | null; pdf_url: string; web_link: string | null; purged: boolean;
}

const TABS: [string, string][] = [['OPEN', 'Open'], ['RESOLVED', 'Fixed'], ['REJECTED', 'Declined'], ['', 'All']];
const CATEGORY_TEXT: Record<string, string> = { name: 'Name', event: 'Event', achievement: 'Achievement', date: 'Date', other: 'Other detail' };

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function TicketCard({ t, onDone }: { t: TicketView; onDone: (msg: string) => void }) {
  const [value, setValue] = useState(t.suggested ?? '');
  const [field, setField] = useState(t.field ?? '');
  const [note, setNote] = useState('');
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = t.status === 'OPEN';

  const resolve = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/api/tickets/${encodeURIComponent(t.id)}/resolve`, { json: { field: field.trim() || undefined, value, note } });
      onDone(`Fixed. A corrected certificate was made and emailed to ${t.name || t.email}.`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/api/tickets/${encodeURIComponent(t.id)}/reject`, { json: { note } });
      onDone(`Declined. ${t.name || t.email} was emailed your reason.`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Card as="article" aria-label={`Problem reported by ${t.name || t.email}`} data-testid={`ticket-${t.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t.name || '(no name)'} <span className="font-normal text-slate-500">· {t.email}</span></h2>
          <p className="text-sm text-slate-600">{t.award}{t.batch_name ? ` · ${t.batch_name}` : ''} · reported {when(t.created_at)}</p>
        </div>
        <StatusBadge status={t.status} />
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-slate-500">They say wrong</dt><dd className="font-medium text-slate-900">{CATEGORY_TEXT[t.category] ?? t.category}</dd>
        {t.field && <><dt className="text-slate-500">Now on the certificate</dt><dd data-testid="current">{t.current ?? '(empty)'}</dd></>}
        {t.suggested && <><dt className="text-slate-500">They suggest</dt><dd className="font-medium text-indigo-900" data-testid="suggested">{t.suggested}</dd></>}
        {t.note && <><dt className="text-slate-500">Their message</dt><dd>{t.note}</dd></>}
        {t.resolution_note && <><dt className="text-slate-500">Your note</dt><dd>{t.resolution_note}</dd></>}
      </dl>
      <p className="mt-3 flex flex-wrap gap-4 text-sm">
        <a className="font-medium text-indigo-800 underline" href={t.pdf_url} target="_blank" rel="noreferrer">View the certificate</a>
        {t.web_link && <a className="font-medium text-indigo-800 underline" href={t.web_link} target="_blank" rel="noreferrer">Open the saved copy</a>}
      </p>

      {error && <div className="mt-3"><Alert type="error" onDismiss={() => setError(null)}>{error}</Alert></div>}

      {open && t.purged && <p className="mt-3 text-sm text-amber-800">The data for this certificate was deleted, so it can only be declined.</p>}
      {open && !declining && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          {!t.field && <TextField label="Which detail to correct? (for example NAME, EVENT, DATE)" value={field} onChange={(e) => setField(e.target.value.toUpperCase())} data-testid="fix-field" />}
          <TextField label="Correct value" value={value} onChange={(e) => setValue(e.target.value)} data-testid="fix-value" hint="This replaces the value in the student's row and on the certificate." />
          <TextField label="Note for the student (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} data-testid="fix-note" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={resolve} loading={busy} disabled={t.purged || !value.trim() || (!t.field && !field.trim())} data-testid="fix-send">Fix and send corrected certificate</Button>
            <Button variant="outline" onClick={() => setDeclining(true)} disabled={busy} data-testid="decline">Decline</Button>
          </div>
        </div>
      )}
      {open && declining && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <TextAreaField label="Why are you declining? (the student receives this)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} data-testid="decline-note" />
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={reject} loading={busy} disabled={note.trim().length < 3} data-testid="decline-confirm">Decline and email the student</Button>
            <Button variant="ghost" onClick={() => setDeclining(false)} disabled={busy}>Back</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function TicketsPage() {
  const { refresh } = useMe();
  const [tab, setTab] = useState('OPEN');
  const [all, setAll] = useState<TicketView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAll((await api<{ tickets: TicketView[] }>('/api/tickets')).tickets); } catch (e) { setError(errorText(e)); setAll((a) => a ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!all) return <PageLoading label="Loading problem reports" />;
  const count = (s: string) => (s ? all.filter((t) => t.status === s).length : all.length);
  const shown = tab ? all.filter((t) => t.status === tab) : all;

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-10">
      <PageHeader title="Problem reports" help="tickets" subtitle="Students press &quot;Report a problem&quot; in their email. Fix the detail and Facilify remakes and re-sends their certificate." />
      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert type="success" onDismiss={() => setNotice(null)}><span data-testid="ticket-notice">{notice}</span></Alert>}

      <div role="tablist" aria-label="Filter reports" className="flex flex-wrap gap-2">
        {TABS.map(([v, l]) => (
          <button key={v || 'all'} role="tab" type="button" aria-selected={tab === v} onClick={() => setTab(v)} data-testid={`tab-${v || 'ALL'}`}
            className={`min-h-9 rounded-full border px-3.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${tab === v ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
            {l} ({count(v)})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={tab === 'OPEN' ? 'No problems reported yet' : 'Nothing here'}>
          {tab === 'OPEN' ? 'No problems reported yet. Students get a Report a problem button in every email.' : 'No reports match this filter.'}
        </EmptyState>
      ) : (
        <div className="space-y-4" data-testid="ticket-list">
          {shown.map((t) => <TicketCard key={t.id} t={t} onDone={(m) => { setNotice(m); void load(); void refresh(); }} />)}
        </div>
      )}
    </div>
  );
}
