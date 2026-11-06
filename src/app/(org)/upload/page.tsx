'use client';

import React, { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, StepFooter } from '@/components/ui/card';
import { FileUploader } from '@/components/ui/file-uploader';
import { TextField } from '@/components/ui/form';
import { ArrowRightIcon, DownloadIcon, SparklesIcon } from '@/components/ui/icons';
import { api, errorText, uploadFile } from '@/components/wizard/api';
import { emptyDraft, type Draft } from '@/components/wizard/draft';
import { useWizard } from '@/components/wizard/wizard-context';
import { PageLoading } from '@/components/ui/card';
import type { HeaderMatch } from '@/lib/contracts';

interface ParseResult {
  sourceName: string; headers: string[]; rows: Record<string, string>[]; rowCount: number; encoding: string; headerRowNumber: number; suggestions: HeaderMatch[];
}

const stem = (name: string) => name.replace(/\.[A-Za-z0-9]+$/, '').replace(/[_-]+/g, ' ').trim();

export default function UploadPage() {
  const { draft, ready, update, reset } = useWizard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <PageLoading />;

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const up = await uploadFile(file, 'sheet');
      const parsed = await api<ParseResult>('/api/sheets/parse', { json: { uploadId: up.id } });
      const mapping: Record<string, string> = {};
      for (const s of parsed.suggestions) if (s.column) mapping[s.placeholder] = s.column;
      const fresh: Draft = {
        ...emptyDraft(),
        email: draft.email,
        delivery: draft.delivery,
        multiAward: draft.multiAward,
        batchName: draft.batchName && draft.upload ? draft.batchName : stem(file.name) || 'My certificates',
        upload: { id: up.id, originalId: up.id, name: file.name },
        sheet: { headers: parsed.headers, rowCount: parsed.rowCount, headerRowNumber: parsed.headerRowNumber, encoding: parsed.encoding, sampleRows: parsed.rows.slice(0, 40) },
        suggestions: parsed.suggestions,
        mapping,
        awardColumns: mapping.CERTIFICATE_TYPE ? [mapping.CERTIFICATE_TYPE] : [],
      };
      update(() => fresh);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const loadSample = async (dirty: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sample-sheet${dirty ? '?type=dirty' : ''}`);
      if (!res.ok) throw new Error('The sample sheet could not be loaded.');
      const blob = await res.blob();
      await handleFile(new File([blob], dirty ? 'sample-with-mistakes.csv' : 'sample-students.csv', { type: 'text/csv' }));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const sheet = draft.sheet;
  const hasFile = !!draft.upload && !!sheet;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <PageHeader
        step="Step 1 of 8"
        title="Upload your student sheet"
        help="upload"
        subtitle="One Excel or CSV file with one row per student: at least a name and an email. Columns can be in any order."
      />

      {error && <Alert type="error" title="That file could not be read" onDismiss={() => setError(null)}>{error}</Alert>}

      <Card>
        <FileUploader
          loading={busy}
          onFileSelect={handleFile}
          selectedFile={hasFile ? { name: draft.upload!.name, detail: `${sheet!.rowCount} students found, ${sheet!.headers.length} columns` } : null}
          onClear={reset}
        />
        {!hasFile && (
          <div className="mt-5 rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">No file handy? Try it with a sample.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" icon={<SparklesIcon size={14} />} onClick={() => loadSample(false)} disabled={busy} data-testid="use-sample-clean">Use the sample sheet (25 students)</Button>
              <Button variant="outline" size="sm" onClick={() => loadSample(true)} disabled={busy} data-testid="use-sample-dirty">Use a sample with mistakes</Button>
              <a href="/api/sample-sheet" download="sample-students.csv" data-testid="download-sample"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <DownloadIcon size={14} />Download the sample sheet
              </a>
            </div>
          </div>
        )}
      </Card>

      {hasFile && sheet && (
        <>
          {sheet.headerRowNumber > 1 && (
            <Alert type="info">We skipped {sheet.headerRowNumber - 1} title row{sheet.headerRowNumber === 2 ? '' : 's'} at the top. Your headings start on row {sheet.headerRowNumber}.</Alert>
          )}
          <Card aria-labelledby="peek-heading">
            <h2 id="peek-heading" className="text-base font-semibold text-slate-900">Here is what we found</h2>
            <p className="mt-0.5 text-sm text-slate-600">Your first few students. Nothing has been changed in your file.</p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200" tabIndex={0} aria-label="Preview of the first rows of your sheet" role="region">
              <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="sheet-preview">
                <thead className="bg-slate-50"><tr>{sheet.headers.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-700">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {sheet.sampleRows.slice(0, 5).map((r, i) => (
                    <tr key={i}>{sheet.headers.map((h) => <td key={h} className="whitespace-nowrap px-3 py-2 text-slate-800">{r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <TextField
              label="Name this batch"
              hint="Only you see this name. It helps you find the batch on the dashboard."
              value={draft.batchName}
              onChange={(e) => update({ batchName: e.target.value })}
              maxLength={100}
              data-testid="batch-name"
            />
          </Card>
        </>
      )}

      <StepFooter
        back={<ButtonLink href="/" variant="ghost">Back to home</ButtonLink>}
        note={hasFile ? undefined : 'Choose a file or try a sample to continue.'}
        next={hasFile ? <ButtonLink href="/columns" icon={<ArrowRightIcon size={16} />} data-testid="next">Next: match columns</ButtonLink> : <Button disabled data-testid="next">Next: match columns</Button>}
      />
    </div>
  );
}
