'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, PageLoading, Spinner, StepFooter } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/form';
import { ArrowRightIcon } from '@/components/ui/icons';
import { api, ApiError, errorText } from '@/components/wizard/api';
import { toDraftConfig } from '@/components/wizard/draft';
import { StepGate } from '@/components/wizard/gate';
import { useWizard } from '@/components/wizard/wizard-context';
import type { Issue } from '@/lib/contracts';

interface SampleGroup { categoryId: string; templateId: string; label: string; count: number; sample: { index: number; rowNumber: number; name: string; email: string } }
interface Samples {
  categories: SampleGroup[]; people: number; certificates: number; emails: number; delivery: string;
  unmatchedValues: string[]; routingIssues: Issue[]; rowsChecked: number; rowsInvalid: number;
}
interface FitItem { rowNumber: number; name: string; award: string; text: string; fit: { lines: string[]; fontSize: number; shrunk: boolean; wrapped: boolean; abbreviated: boolean; overflow?: boolean } }
interface Fits { items: FitItem[]; checked: number; changed: number; truncated: boolean }
interface PrepareResult {
  certificates: number; people: number; emails: number; validRows: number; invalidRows: number; unmatchedValues: string[];
  routingIssues: Issue[]; alreadySent: { certId: string; category: string }[]; skippedAlreadySent: number;
}
interface EmailPreview { subject: string; html: string; to: string; from: string; attachments: string[]; name: string }

function SampleImage({ body, label }: { body: unknown; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(body);
  useEffect(() => {
    let dead = false; let made: string | null = null;
    (async () => {
      try {
        const res = await fetch('/api/preview/certificate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: key });
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || 'The sample could not be drawn.');
        made = URL.createObjectURL(await res.blob());
        if (!dead) setUrl(made);
      } catch (e) { if (!dead) setErr(errorText(e)); }
    })();
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [key]);
  if (err) return <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{err}</p>;
  if (!url) return <div className="flex aspect-[1.414] items-center justify-center rounded-lg border border-slate-200 bg-slate-50"><Spinner label="Drawing sample" /></div>;
  return <img src={url} alt={label} className="w-full rounded-lg border border-slate-200 shadow-xs" />;
}

function PreviewInner() {
  const { draft, update } = useWizard();
  const upload = draft.upload!;
  const [batchName, setBatchName] = useState(draft.batchName || upload.name.replace(/\.[^.]+$/, ''));
  const [preparing, setPreparing] = useState(false);
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [samples, setSamples] = useState<Samples | null>(null);
  const [fits, setFits] = useState<Fits | null>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needNewBatch, setNeedNewBatch] = useState(false);
  const [repeatReason, setRepeatReason] = useState(draft.allowRepeat?.reason ?? '');
  const [emailIdx, setEmailIdx] = useState(0);
  const [email, setEmail] = useState<EmailPreview | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const seq = useRef(0);

  const config = useCallback(() => toDraftConfig(draft), [draft]);

  const loadSamples = useCallback(async () => {
    const mine = ++seq.current;
    setLoadingSamples(true); setError(null);
    try {
      const body = { uploadId: upload.id, draft: config() };
      const s = await api<Samples>('/api/preview/samples', { json: body });
      if (mine !== seq.current) return;
      setSamples(s);
      setEmailIdx(s.categories[0]?.sample.index ?? 0);
      api<Fits>('/api/preview/fits', { json: body }).then((f) => { if (mine === seq.current) setFits(f); }).catch(() => setFits(null));
    } catch (e) { if (mine === seq.current) setError(errorText(e)); } finally { if (mine === seq.current) setLoadingSamples(false); }
  }, [upload.id, config]);

  useEffect(() => { void loadSamples(); }, []);

  useEffect(() => {
    if (!samples?.categories.length) { setEmail(null); return; }
    let dead = false;
    setEmailErr(null);
    api<EmailPreview>('/api/preview/email', { json: { uploadId: upload.id, draft: config(), index: emailIdx } })
      .then((r) => { if (!dead) setEmail(r); })
      .catch((e) => { if (!dead) { setEmail(null); setEmailErr(errorText(e)); } });
    return () => { dead = true; };
  }, [samples, emailIdx]);

  const prepare = async (fresh = false) => {
    setPreparing(true); setError(null); setNeedNewBatch(false);
    try {
      const allowRepeat = repeatReason.trim() ? { reason: repeatReason.trim() } : undefined;
      const next = { ...draft, allowRepeat };
      let batchId = fresh ? undefined : draft.batchId;
      if (!batchId) {
        const b = await api<{ id: string }>('/api/batches', { json: { name: batchName.trim() || 'New batch' } });
        batchId = b.id;
      }
      const r = await api<PrepareResult>(`/api/batches/${encodeURIComponent(batchId)}/prepare`, { json: { uploadId: upload.id, draft: toDraftConfig(next) } });
      setResult(r);
      update({
        batchId, batchName, allowRepeat,
        prepared: { at: new Date().toISOString(), certificates: r.certificates, people: r.people, emails: r.emails },
      });
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 409) setNeedNewBatch(true);
    } finally { setPreparing(false); }
  };

  const total = samples?.certificates ?? draft.prepared?.certificates ?? 0;
  const prepared = !!draft.prepared;
  const overflow = fits?.items.filter((i) => i.fit.overflow) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <PageHeader step="Step 7 of 8" title="Preview before anything is sent" help="preview"
        subtitle="This is exactly what each student will receive. Nothing is emailed from this page." />

      {error && (
        <Alert type="error" onDismiss={() => setError(null)}>
          {error}
          {needNewBatch && <div className="mt-2"><Button size="sm" variant="outline" onClick={() => prepare(true)} data-testid="new-batch-prepare">Start a new batch with these settings</Button></div>}
        </Alert>
      )}

      {loadingSamples && !samples && <PageLoading label="Drawing your certificates" />}

      {samples && (
        <>
          <Card aria-labelledby="sum-heading">
            <h2 id="sum-heading" className="text-base font-semibold text-slate-900">What will happen</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4" data-testid="summary">
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">People</dt><dd className="text-2xl font-bold text-slate-900" data-testid="sum-people">{samples.people}</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Certificates</dt><dd className="text-2xl font-bold text-slate-900" data-testid="sum-certs">{samples.certificates}</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Emails</dt><dd className="text-2xl font-bold text-slate-900" data-testid="sum-emails">{samples.emails}</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Rows left out</dt><dd className="text-2xl font-bold text-slate-900">{samples.rowsInvalid}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-slate-600">
              {samples.delivery === 'one-email' ? 'Each person gets one email with all of their own certificates attached.' : 'Each certificate is sent in its own email.'} Nobody receives anyone else&apos;s certificate.
            </p>
          </Card>

          {samples.rowsInvalid > 0 && <Alert type="warning" title={`${samples.rowsInvalid} row${samples.rowsInvalid === 1 ? '' : 's'} will not get a certificate`}>These rows still have a problem (for example a missing name or a bad email). <a className="font-semibold underline" href="/fix">Go back to Fix problems</a> to correct or skip them.</Alert>}
          {samples.unmatchedValues.length > 0 && <Alert type="warning" title="Some awards have no design">These awards were not matched to a design, so those students would not get a certificate: <strong>{samples.unmatchedValues.join(', ')}</strong>. Go back to Awards and choose a design under &quot;Everyone else&quot; or for each award.</Alert>}
          {samples.routingIssues.length > 0 && (
            <Alert type="warning" title="Please review">
              <ul className="list-disc pl-5">{samples.routingIssues.slice(0, 6).map((i, n) => <li key={n}>Row {i.row}: {i.message}</li>)}</ul>
            </Alert>
          )}

          <Card aria-labelledby="samples-heading">
            <h2 id="samples-heading" className="text-base font-semibold text-slate-900">One sample from every award</h2>
            <p className="mt-0.5 text-sm text-slate-600">Each picture uses a real student from your sheet and the same drawing code as the final certificates.</p>
            <ul className="mt-4 grid gap-5 md:grid-cols-2" data-testid="sample-list">
              {samples.categories.map((g) => (
                <li key={`${g.categoryId}-${g.label}`} data-testid={`sample-${g.label}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{g.label}</strong><Badge variant="indigo" size="sm">{g.count} certificate{g.count === 1 ? '' : 's'}</Badge></div>
                  <SampleImage body={{ uploadId: upload.id, draft: config(), index: g.sample.index }} label={`Sample ${g.label} certificate for ${g.sample.name}`} />
                  <p className="mt-1.5 text-xs text-slate-600">Sample: {g.sample.name} ({g.sample.email})</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card aria-labelledby="fit-heading">
            <h2 id="fit-heading" className="text-base font-semibold text-slate-900">Long names and auto-fit</h2>
            {!fits ? <Spinner label="Checking every name" /> : fits.items.length === 0 ? (
              <p className="mt-1 text-sm text-emerald-800" data-testid="fit-none">All {fits.checked} certificates fit without changes.</p>
            ) : (
              <>
                <p className="mt-0.5 text-sm text-slate-600">{fits.changed} of {fits.checked} certificates needed the text adjusted so it stays inside its box. Please look over these.</p>
                {overflow.length > 0 && <Alert type="warning" className="mt-3">{overflow.length} still do not fit. Make the text box bigger in the Design step.</Alert>}
                <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm" data-testid="fit-table">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-3 py-2">Row</th><th scope="col" className="px-3 py-2">Text</th><th scope="col" className="px-3 py-2">What Facilify did</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {fits.items.map((i, n) => (
                        <tr key={n}>
                          <td className="px-3 py-2 text-slate-500">{i.rowNumber}</td>
                          <td className="px-3 py-2"><div className="font-medium text-slate-900">{i.text}</div><div className="text-xs text-slate-500">{i.award}</div></td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {[i.fit.abbreviated && `shortened to "${i.fit.lines.join(' ')}"`, i.fit.wrapped && `on ${i.fit.lines.length} lines`, i.fit.shrunk && `shrunk to ${Math.round(i.fit.fontSize * 10) / 10} pt`, i.fit.overflow && 'still too long'].filter(Boolean).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card aria-labelledby="email-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="email-heading" className="text-base font-semibold text-slate-900">The email a student receives</h2>
              <div className="w-64"><SelectField label="Show the email for" value={String(emailIdx)} onChange={(e) => setEmailIdx(Number(e.target.value))} data-testid="email-sample">
                {samples.categories.map((g) => <option key={`${g.categoryId}-${g.label}`} value={g.sample.index}>{g.label}: {g.sample.name}</option>)}
              </SelectField></div>
            </div>
            {emailErr && <Alert type="error" className="mt-3">{emailErr}</Alert>}
            {email && (
              <div className="mt-3" data-testid="email-preview">
                <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3"><dt className="text-slate-500">To</dt><dd>{email.to}</dd><dt className="text-slate-500">Subject</dt><dd className="font-medium">{email.subject}</dd><dt className="text-slate-500">Attached</dt><dd>{email.attachments.join(', ') || 'nothing'}</dd></dl>
                <iframe title="Email preview" sandbox="" srcDoc={email.html} className="mt-3 h-96 w-full rounded-lg border border-slate-200 bg-white" />
              </div>
            )}
          </Card>

          {!prepared && (
            <Card aria-labelledby="prep-heading">
              <h2 id="prep-heading" className="text-base font-semibold text-slate-900">Looks right? Prepare the batch</h2>
              <p className="mt-0.5 text-sm text-slate-600">Facilify saves the list of certificates (still nothing is sent). You will send a test email to yourself on the next step.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <TextField label="Name for this batch" value={batchName} onChange={(e) => setBatchName(e.target.value)} maxLength={100} data-testid="batch-name" />
                <TextField label="Sending again to people who already got it? Say why (optional)" value={repeatReason} onChange={(e) => setRepeatReason(e.target.value)} hint="Leave empty to skip anyone who already received the same award in an earlier batch." data-testid="repeat-reason" />
              </div>
              <div className="mt-4"><Button onClick={() => prepare()} loading={preparing} disabled={!total || preparing} data-testid="prepare">Prepare {total} certificate{total === 1 ? '' : 's'}</Button></div>
            </Card>
          )}

          {prepared && (
            <Alert type="success" title="Batch prepared">
              <span data-testid="prepared">{draft.prepared!.certificates} certificates for {draft.prepared!.people} people are ready ({draft.prepared!.emails} email{draft.prepared!.emails === 1 ? '' : 's'}).</span>
              {result && result.skippedAlreadySent > 0 && <> {result.skippedAlreadySent} were skipped because those students already received them in an earlier batch.</>}
            </Alert>
          )}
        </>
      )}

      <StepFooter
        back={<ButtonLink href="/email" variant="ghost">Back</ButtonLink>}
        note={prepared ? undefined : 'Prepare the batch to continue.'}
        next={prepared ? <ButtonLink href="/send" icon={<ArrowRightIcon size={16} />} data-testid="next">Next: test and send</ButtonLink> : <Button disabled data-testid="next">Next: test and send</Button>}
      />
    </div>
  );
}

export default function PreviewPage() {
  return <StepGate step={7}><PreviewInner /></StepGate>;
}
