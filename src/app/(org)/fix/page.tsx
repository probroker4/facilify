'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, PageLoading, StepFooter } from '@/components/ui/card';
import { ArrowRightIcon } from '@/components/ui/icons';
import { api, errorText } from '@/components/wizard/api';
import { mappingList } from '@/components/wizard/draft';
import { StepGate } from '@/components/wizard/gate';
import { useWizard } from '@/components/wizard/wizard-context';
import type { Issue } from '@/lib/contracts';

interface Problem { rowNumber: number; values: Record<string, string>; issues: Issue[]; blocking: boolean }
interface Check {
  total: number; skipped: number; validCount: number; errorRows: number; rows: Problem[]; headers: string[];
  skippedRows: { rowNumber: number; values: Record<string, string> }[];
}

const keyOf = (row: number, col: string) => `${row}::${col}`;

function FixInner() {
  const { draft, update } = useWizard();
  const [check, setCheck] = useState<Check | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const seq = useRef(0);

  const nameCol = draft.mapping.NAME;
  const emailCol = draft.mapping.EMAIL;
  const backupCol = draft.mapping.PERSONAL_EMAIL;
  const idCol = draft.mapping.ID;

  const run = useCallback(async (uploadId: string, skipRows: number[]) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api<Check>('/api/sheets/validate', {
        json: { uploadId, mapping: mappingList(draft), email: { primary: draft.mapping.EMAIL, fallback: draft.mapping.PERSONAL_EMAIL || undefined }, required: ['NAME'], awardColumns: draft.awardColumns, skipRows },
      });
      if (mine !== seq.current) return;
      setCheck(r);
      update({ checked: { validCount: r.validCount, total: r.total, blockingRows: r.errorRows, skipped: r.skipped }, prepared: undefined });
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [draft.mapping, draft.awardColumns]);

  useEffect(() => { if (draft.upload) void run(draft.upload.id, draft.skipRows); }, []);

  const columnsFor = (p: Problem): string[] => {
    const cols = [nameCol, emailCol, backupCol].filter((c): c is string => !!c);
    for (const i of p.issues) if (i.column && !cols.includes(i.column)) cols.push(i.column);
    return cols;
  };

  const dirty = useMemo(() => {
    if (!check) return [] as { rowNumber: number; column: string; value: string }[];
    const out: { rowNumber: number; column: string; value: string }[] = [];
    for (const p of check.rows) for (const c of columnsFor(p)) {
      const v = edits[keyOf(p.rowNumber, c)];
      if (v !== undefined && v.trim() !== (p.values[c] ?? '').trim()) out.push({ rowNumber: p.rowNumber, column: c, value: v });
    }
    return out;
  }, [edits, check]);

  const saveEdits = async () => {
    if (!draft.upload || !dirty.length) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const r = await api<{ uploadId: string }>('/api/sheets/fix', { json: { uploadId: draft.upload.id, edits: dirty } });
      update({ upload: { ...draft.upload, id: r.uploadId } });
      const count = new Set(dirty.map((d) => d.rowNumber)).size;
      setEdits({});
      await run(r.uploadId, draft.skipRows);
      setSaved(`Saved your corrections to ${count} row${count === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const setSkip = (rowNumber: number, skip: boolean) => {
    const skipRows = skip ? [...new Set([...draft.skipRows, rowNumber])] : draft.skipRows.filter((n) => n !== rowNumber);
    update({ skipRows });
    setSaved(null);
    if (draft.upload) void run(draft.upload.id, skipRows);
  };

  if (!check && loading) return <PageLoading label="Checking every row" />;

  const blocking = check?.rows.filter((r) => r.blocking) ?? [];
  const warnings = check?.rows.filter((r) => !r.blocking) ?? [];
  const ready = !!check && check.errorRows === 0 && check.validCount > 0 && dirty.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <PageHeader step="Step 3 of 8" title="Fix any problems" help="fix"
        subtitle="Facilify checked every row. Rows with a red problem would not get a certificate, so correct them here or leave them out." />

      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {saved && <Alert type="success" onDismiss={() => setSaved(null)} testId="fix-saved">{saved}</Alert>}

      {check && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="fix-summary" aria-busy={loading}>
          <Stat label="Ready" value={check.validCount} tone="emerald" testId="stat-ready" />
          <Stat label="Need fixing" value={check.errorRows} tone={check.errorRows ? 'rose' : 'slate'} testId="stat-bad" />
          <Stat label="Left out" value={check.skipped} tone="slate" testId="stat-skipped" />
          <Stat label="To double-check" value={warnings.length} tone={warnings.length ? 'amber' : 'slate'} testId="stat-warn" />
        </div>
      )}

      {check && check.errorRows === 0 && check.validCount > 0 && (
        <Alert type="success" title="Every row looks good" testId="fix-all-good">
          {check.validCount} student{check.validCount === 1 ? '' : 's'} are ready{check.skipped ? ` (${check.skipped} left out)` : ''}. Press Next to choose awards.
        </Alert>
      )}
      {check && check.validCount === 0 && check.errorRows === 0 && (
        <Alert type="warning">There are no students left. Include a row again or go back and upload a different sheet.</Alert>
      )}

      {blocking.length > 0 && (
        <Card className="!p-0" aria-labelledby="bad-heading">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <h2 id="bad-heading" className="text-base font-semibold text-slate-900">{blocking.length} row{blocking.length === 1 ? '' : 's'} need attention</h2>
            <p className="mt-0.5 text-sm text-slate-600">Type the correct value, then press Save corrections. Or leave a row out (for example a repeated student).</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void saveEdits(); }}>
            <div className="overflow-x-auto" role="region" aria-label="Rows that need fixing" tabIndex={0}>
              <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="fix-table">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Row</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate-700">What is wrong</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Correct it here</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate-700"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {blocking.map((p) => (
                    <tr key={p.rowNumber} data-testid={`fix-row-${p.rowNumber}`}>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">Row {p.rowNumber}</td>
                      <td className="min-w-56 px-3 py-3">
                        <ul className="space-y-1">
                          {p.issues.map((i, n) => (
                            <li key={n} className={`flex items-start gap-1.5 text-xs ${i.severity === 'error' ? 'font-medium text-rose-800' : 'text-amber-900'}`}>
                              <span aria-hidden="true">{i.severity === 'error' ? '●' : '○'}</span><span>{i.message}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="min-w-64 px-3 py-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          {columnsFor(p).map((c) => (
                            <label key={c} className="block text-xs text-slate-700">
                              <span className="mb-0.5 block font-medium">{c}</span>
                              <input
                                type="text"
                                value={edits[keyOf(p.rowNumber, c)] ?? p.values[c] ?? ''}
                                onChange={(e) => setEdits((x) => ({ ...x, [keyOf(p.rowNumber, c)]: e.target.value }))}
                                aria-label={`${c}, row ${p.rowNumber}`}
                                data-testid={`fix-input-${p.rowNumber}-${c}`}
                                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                              />
                            </label>
                          ))}
                        </div>
                        {idCol && p.values[idCol] && <p className="mt-1 text-[11px] text-slate-600">Student ID {p.values[idCol]}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <Button type="button" variant="outline" size="sm" onClick={() => setSkip(p.rowNumber, true)} data-testid={`skip-${p.rowNumber}`}>Leave this row out</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
              <p className="text-sm text-slate-600" role="status">{dirty.length ? `${dirty.length} unsaved correction${dirty.length === 1 ? '' : 's'}` : 'Nothing changed yet.'}</p>
              <Button type="submit" loading={saving} disabled={!dirty.length} data-testid="save-fixes">Save corrections</Button>
            </div>
          </form>
        </Card>
      )}

      {warnings.length > 0 && (
        <details className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="fix-warnings">
          <summary className="cursor-pointer text-sm font-semibold text-amber-950">{warnings.length} thing{warnings.length === 1 ? '' : 's'} to double-check (these rows still get certificates)</summary>
          <ul className="mt-3 space-y-2 text-sm text-amber-950">
            {warnings.map((p) => (
              <li key={p.rowNumber}><span className="font-mono text-xs">Row {p.rowNumber}</span> {nameCol ? <strong>{p.values[nameCol]}</strong> : null}: {p.issues.map((i) => i.message).join(' ')}</li>
            ))}
          </ul>
        </details>
      )}

      {check && check.skippedRows.length > 0 && (
        <Card data-testid="fix-skipped">
          <h2 className="text-base font-semibold text-slate-900">Left out of this batch</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {check.skippedRows.map((r) => (
              <li key={r.rowNumber} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><span className="font-mono text-xs text-slate-600">Row {r.rowNumber}</span> {nameCol ? r.values[nameCol] : ''} <Badge variant="slate" size="sm">Left out</Badge></span>
                <Button variant="ghost" size="sm" onClick={() => setSkip(r.rowNumber, false)} data-testid={`unskip-${r.rowNumber}`}>Include again</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <StepFooter
        back={<ButtonLink href="/columns" variant="ghost">Back</ButtonLink>}
        note={ready ? undefined : dirty.length ? 'Save your corrections to continue.' : check && check.errorRows > 0 ? 'Fix or leave out the red rows to continue.' : undefined}
        next={ready ? <ButtonLink href="/awards" icon={<ArrowRightIcon size={16} />} data-testid="next">Next: awards</ButtonLink> : <Button disabled data-testid="next">Next: awards</Button>}
      />
    </div>
  );
}

function Stat({ label, value, tone, testId }: { label: string; value: number; tone: 'emerald' | 'rose' | 'amber' | 'slate'; testId: string }) {
  const tones = { emerald: 'text-emerald-800', rose: 'text-rose-800', amber: 'text-amber-900', slate: 'text-slate-800' };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid={testId}>
      <p className={`text-2xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="text-xs font-medium text-slate-600">{label}</p>
    </div>
  );
}

export default function FixPage() {
  return <StepGate step={3}><FixInner /></StepGate>;
}
