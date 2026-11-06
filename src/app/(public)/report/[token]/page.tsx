'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/form';
import { PageLoading } from '@/components/ui/card';
import { api, ApiError, errorText } from '@/components/wizard/api';

interface CertInfo {
  name: string; event: string; award: string; date: string; verifyCode: string; verifyUrl: string;
  organizationName: string; revoked: boolean; openTicket: boolean;
}

const CATEGORIES: { value: string; label: string; ask: string; placeholder: string }[] = [
  { value: 'name', label: 'My name is spelled wrong', ask: 'How should your name be written?', placeholder: 'Your full name, exactly as it should appear' },
  { value: 'event', label: 'The event name is wrong', ask: 'What should the event name be?', placeholder: 'The correct event name' },
  { value: 'achievement', label: 'The award or achievement is wrong', ask: 'What should it say?', placeholder: 'The correct award or achievement' },
  { value: 'date', label: 'The date is wrong', ask: 'What should the date be?', placeholder: 'For example 14 March 2026' },
  { value: 'other', label: 'Something else', ask: 'What should it say instead?', placeholder: 'The correct text (or explain below)' },
];

export default function ReportPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<CertInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState('name');
  const [suggested, setSuggested] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { document.title = 'Report a problem with your certificate - Facilify'; }, []);

  useEffect(() => {
    let dead = false;
    api<CertInfo>(`/api/public/cert/${encodeURIComponent(token)}`, { noRedirect: true })
      .then((r) => { if (!dead) setInfo(r); })
      .catch((e) => { if (!dead) setLoadError(e instanceof ApiError && e.status === 404 ? 'This link is not valid or the certificate no longer exists. Please use the link from your certificate email.' : errorText(e)); });
    return () => { dead = true; };
  }, [token]);

  const active = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/api/public/tickets', { json: { token, category, suggested: suggested.trim(), note: note.trim() }, noRedirect: true });
      setDone(true);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold sm:text-2xl" data-testid="report-title">Report a problem with your certificate</h1>

        {!info && !loadError && <div className="mt-6"><PageLoading label="Opening your certificate" /></div>}
        {loadError && <div className="mt-4"><Alert type="error" title="We could not open this link">{loadError}</Alert></div>}

        {info && (
          <>
            <dl className="mt-4 grid gap-1 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4" data-testid="cert-summary">
              <dt className="text-slate-500">Name</dt><dd className="font-medium">{info.name}</dd>
              <dt className="text-slate-500">Event</dt><dd className="font-medium">{info.event || '-'}</dd>
              <dt className="text-slate-500">Award</dt><dd className="font-medium">{info.award}</dd>
              {info.date && <><dt className="text-slate-500">Date</dt><dd className="font-medium">{info.date}</dd></>}
              <dt className="text-slate-500">Issued by</dt><dd className="font-medium">{info.organizationName}</dd>
            </dl>

            {done ? (
              <div className="mt-5" role="status" data-testid="report-done">
                <Alert type="success" title="Thank you, we have your report">
                  Thanks, the organizers will fix it and email you the corrected certificate.
                </Alert>
              </div>
            ) : info.openTicket ? (
              <div className="mt-5"><Alert type="info" title="You already reported this">You already reported a problem with this certificate. The organizers will get back to you by email.</Alert></div>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-4" noValidate data-testid="report-form">
                <p className="text-sm text-slate-600">Spotted a typo or a wrong detail? Tell us what should be corrected. The organizers will check it and send you a new certificate.</p>
                <SelectField label="What is wrong?" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="report-category">
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </SelectField>
                <TextField label={active.ask} value={suggested} onChange={(e) => setSuggested(e.target.value)} placeholder={active.placeholder} maxLength={300} data-testid="report-suggested" />
                <TextAreaField label="Anything else the organizers should know? (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} data-testid="report-note" />
                {error && <div role="alert"><Alert type="error">{error}</Alert></div>}
                <Button type="submit" loading={busy} disabled={!suggested.trim() && !note.trim()} className="w-full" data-testid="report-submit">Send my report</Button>
                {!suggested.trim() && !note.trim() && <p className="text-xs text-slate-500">Type the correct value or a short note to send your report.</p>}
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
