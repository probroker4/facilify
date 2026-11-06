'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, ProgressBar, Spinner } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { AwardIcon, DownloadIcon, ArrowRightIcon, TicketIcon } from '@/components/ui/icons';
import { api } from '@/components/wizard/api';
import { STEPS, missingBefore } from '@/components/wizard/draft';
import { useMe } from '@/components/wizard/me-context';
import { useWizard } from '@/components/wizard/wizard-context';

interface BatchSummary { id: string; name: string; status: string; counts: Record<string, number>; total: number; created_at: string }

function resumeStep(d: ReturnType<typeof useWizard>['draft']) {
  for (const s of STEPS) {
    const blocked = missingBefore(d, s.id + 1);
    if (blocked) return blocked;
  }
  return STEPS[STEPS.length - 1];
}

export default function HomePage() {
  const { me } = useMe();
  const { draft, ready, reset } = useWizard();
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);

  useEffect(() => {
    api<{ batches: BatchSummary[] }>('/api/batches').then((r) => setBatches(r.batches.slice(0, 3))).catch(() => setBatches([]));
  }, []);

  const inProgress = ready && !!draft.upload;
  const step = inProgress ? resumeStep(draft) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${me.organizer.name.split(' ')[0] || 'organizer'}`} subtitle={`Certificates for ${me.organization}: from one spreadsheet to every student's inbox.`} />

      {me.openTickets > 0 && (
        <Alert type="warning" title={`${me.openTickets} student${me.openTickets === 1 ? '' : 's'} reported a problem`}>
          A student says something on their certificate is wrong. <Link href="/tickets" className="font-semibold underline">Open the tickets</Link> to fix it in one click.
        </Alert>
      )}

      {inProgress && step && (
        <Card data-testid="resume-card" className="border-indigo-200 bg-indigo-50/50">
          <h2 className="text-base font-semibold text-slate-900">Pick up where you left off</h2>
          <p className="mt-1 text-sm text-slate-700">
            You were working on <strong>{draft.batchName || draft.upload?.name}</strong>. Next up: <strong>{step.title}</strong>.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={step.href} icon={<ArrowRightIcon size={16} />} data-testid="resume-continue">Continue</ButtonLink>
            <Button variant="outline" onClick={reset} data-testid="resume-reset">Start over with a new sheet</Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><AwardIcon size={22} /></div>
            <h2 className="text-lg font-bold text-slate-900">Make certificates in three simple parts</h2>
            <ol className="mt-3 space-y-2 text-sm text-slate-700">
              <li><strong>1. Upload</strong> your Excel or CSV list of students. Facilify finds the columns and checks every row.</li>
              <li><strong>2. Choose</strong> a design for each award (1st Prize, Participation, Best UI...) and write the email.</li>
              <li><strong>3. Send.</strong> Everyone gets their own certificate by email, and you watch it happen live.</li>
            </ol>
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            <ButtonLink href="/upload" size="lg" icon={<ArrowRightIcon size={18} />} className="w-full" data-testid="home-start" onClick={() => { if (inProgress) reset(); }}>Start a new batch</ButtonLink>
            <a href="/api/sample-sheet" download="sample-students.csv" data-testid="home-sample"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <DownloadIcon size={16} />Download a sample sheet
            </a>
          </div>
        </div>
      </Card>

      <section aria-labelledby="recent-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-heading" className="text-base font-semibold text-slate-900">Recent batches</h2>
          <Link href="/dashboard" className="text-sm font-medium text-indigo-700 hover:underline">See all</Link>
        </div>
        {batches === null ? <Spinner label="Loading your batches..." /> : batches.length === 0 ? (
          <EmptyState title="No batches yet" icon={<TicketIcon size={22} />}>Your first batch will appear here once you send it. Start with the sample sheet if you just want to look around. Emails go to a safe test outbox until you choose a real sender in Settings.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/dashboard?batch=${b.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <p className="truncate text-sm font-semibold text-slate-900">{b.name}</p>
                  <p className="mt-0.5 text-xs text-slate-600">{b.counts.SENT ?? 0} of {b.total} sent</p>
                  <div className="mt-2"><ProgressBar value={b.counts.SENT ?? 0} max={b.total} label={`${b.name} progress`} tone="emerald" /></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
