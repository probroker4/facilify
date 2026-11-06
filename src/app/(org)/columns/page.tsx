'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, StepFooter } from '@/components/ui/card';
import { CheckboxField, SelectField, TextField } from '@/components/ui/form';
import { ArrowRightIcon, CheckCircleIcon } from '@/components/ui/icons';
import { api, errorText } from '@/components/wizard/api';
import { FIELD_SPECS, columnsDone } from '@/components/wizard/draft';
import { StepGate } from '@/components/wizard/gate';
import { useWizard } from '@/components/wizard/wizard-context';
import type { ColumnProfile, HeaderMatch } from '@/lib/contracts';

type Note = { tone: 'ok' | 'warn' | 'bad'; text: string };

function ColumnsInner() {
  const { draft, update } = useWizard();
  const headers = draft.sheet?.headers ?? [];
  const sample = draft.sheet?.sampleRows ?? [];
  const [ambiguous, setAmbiguous] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const s of draft.suggestions) if (s.ambiguous && !draft.mapping[s.placeholder]) out[s.placeholder] = s.candidates;
    return out;
  });
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [busyField, setBusyField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ profiles: ColumnProfile[] }>('/api/profiles').then((r) => setProfiles(r.profiles)).catch(() => setProfiles([]));
  }, []);

  const setColumn = (ph: string, column: string) => {
    update((d) => {
      const mapping = { ...d.mapping };
      if (column) mapping[ph] = column; else delete mapping[ph];
      const awardColumns = ph === 'CERTIFICATE_TYPE' ? (column ? [column, ...d.awardColumns.slice(1).filter((c) => c !== column)] : d.awardColumns.slice(1)) : d.awardColumns;
      return { mapping, awardColumns, checked: undefined, prepared: undefined, discoverSig: undefined };
    });
    setAmbiguous((a) => { const n = { ...a }; delete n[ph]; return n; });
  };

  const applyMatches = (matches: HeaderMatch[], only?: string) => {
    const nextAmb: Record<string, string[]> = {};
    const nextNotes: Record<string, Note> = {};
    let found = 0;
    for (const m of matches) {
      if (only && m.placeholder !== only) continue;
      if (m.column) { setColumn(m.placeholder, m.column); found++; nextNotes[m.placeholder] = { tone: 'ok', text: `Matched to "${m.column}".` }; }
      else if (m.ambiguous) { nextAmb[m.placeholder] = m.candidates; nextNotes[m.placeholder] = { tone: 'warn', text: 'More than one column fits. Please choose below.' }; }
      else if (m.typed) nextNotes[m.placeholder] = { tone: 'bad', text: `Nothing in your sheet looks like "${m.typed}". Check the spelling, or choose from the list.` };
    }
    setAmbiguous((a) => ({ ...a, ...nextAmb }));
    setNotes((n) => ({ ...n, ...nextNotes }));
    return found;
  };

  const findTyped = async (ph: string) => {
    const text = (draft.typed[ph] ?? '').trim();
    if (!text) return;
    setBusyField(ph);
    setError(null);
    try {
      const r = await api<{ matches: HeaderMatch[] }>('/api/sheets/match', { json: { uploadId: draft.upload!.id, typed: { [ph]: text } } });
      applyMatches(r.matches, ph);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyField(null);
    }
  };

  const applyProfile = async (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setError(null);
    try {
      const r = await api<{ matches: HeaderMatch[] }>('/api/sheets/match', { json: { uploadId: draft.upload!.id, typed: p.matches } });
      const wanted = r.matches.filter((m) => p.matches[m.placeholder]);
      const found = applyMatches(wanted);
      setProfileMsg(`Used "${p.name}": ${found} of ${wanted.length} columns matched.`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const saveProfile = async () => {
    setError(null);
    try {
      const r = await api<{ profile: ColumnProfile }>('/api/profiles', { json: { name: profileName, matches: draft.mapping } });
      setProfiles((p) => [r.profile, ...p]);
      setProfileMsg(`Saved as "${r.profile.name}". Use it next time you upload a similar sheet.`);
      setProfileName('');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const valueOf = (col: string) => (sample.find((r) => r[col])?.[col] ?? '').slice(0, 40);

  const usedTwice = useMemo(() => {
    const byCol = new Map<string, string[]>();
    for (const [ph, col] of Object.entries(draft.mapping)) if (col) byCol.set(col, [...(byCol.get(col) ?? []), ph]);
    return [...byCol.entries()].filter(([, v]) => v.length > 1);
  }, [draft.mapping]);

  const done = columnsDone(draft);
  const mappedFields = FIELD_SPECS.filter((f) => draft.mapping[f.key]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <PageHeader step="Step 2 of 8" title="Match your columns" help="columns"
        subtitle="Facilify read your headings and guessed which column is which. Check the guesses. If your sheet uses its own heading, type it and press Find." />

      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="space-y-4">
        {FIELD_SPECS.map((spec) => {
          const col = draft.mapping[spec.key] ?? '';
          const amb = ambiguous[spec.key];
          const note = notes[spec.key];
          const auto = draft.suggestions.find((s) => s.placeholder === spec.key);
          return (
            <Card key={spec.key} data-testid={`field-${spec.key}`} className="!p-4 sm:!p-5">
              <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">{spec.label}</h2>
                    {spec.required && <Badge variant="rose" size="sm">Needed</Badge>}
                    {col && auto?.column === col && !note && <Badge variant="emerald" size="sm">Matched automatically</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">{spec.help}</p>
                  {col && <p className="mt-2 text-xs text-slate-700">First student: <span className="font-medium">{valueOf(col) || '(empty)'}</span></p>}
                </div>
                <div className="space-y-3">
                  <SelectField
                    label={`Column for ${spec.label}`}
                    hideLabel
                    value={col}
                    onChange={(e) => setColumn(spec.key, e.target.value)}
                    data-testid={`select-${spec.key}`}
                  >
                    <option value="">{spec.required ? 'Choose a column...' : 'My sheet does not have this'}</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </SelectField>
                  <div className="flex items-end gap-2">
                    <TextField
                      label={`The heading you used for ${spec.label}`}
                      hideLabel
                      placeholder="Or type your own heading, e.g. Person name"
                      value={draft.typed[spec.key] ?? ''}
                      onChange={(e) => update((d) => ({ typed: { ...d.typed, [spec.key]: e.target.value } }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void findTyped(spec.key); } }}
                      data-testid={`typed-${spec.key}`}
                    />
                    <Button variant="outline" size="md" aria-label={`Find the heading you typed for ${spec.label}`} loading={busyField === spec.key} onClick={() => findTyped(spec.key)} disabled={!(draft.typed[spec.key] ?? '').trim()} data-testid={`find-${spec.key}`}>Find</Button>
                  </div>
                  {note && (
                    <p role="status" className={`flex items-start gap-1.5 text-xs font-medium ${note.tone === 'ok' ? 'text-emerald-800' : note.tone === 'warn' ? 'text-amber-900' : 'text-rose-700'}`} data-testid={`note-${spec.key}`}>
                      {note.tone === 'ok' && <CheckCircleIcon size={14} className="mt-px shrink-0" />}{note.text}
                    </p>
                  )}
                </div>
              </div>

              {amb && (
                <fieldset className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid={`ambiguous-${spec.key}`}>
                  <legend className="px-1 text-sm font-semibold text-amber-950">Which column is the {spec.label.toLowerCase().replace(' (optional)', '')}?</legend>
                  <p className="text-xs text-amber-950">More than one column could be right, so we are asking instead of guessing.</p>
                  <div className="mt-3 space-y-2">
                    {amb.map((c) => (
                      <label key={c} className="flex cursor-pointer items-center gap-3 rounded-lg border border-amber-200 bg-white p-2.5 text-sm">
                        <input type="radio" name={`amb-${spec.key}`} className="h-4 w-4" onChange={() => setColumn(spec.key, c)} data-testid={`choose-${spec.key}-${c}`} />
                        <span><span className="font-medium text-slate-900">{c}</span> <span className="text-xs text-slate-600">e.g. {valueOf(c) || '(empty)'}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {spec.key === 'EMAIL' && col && !draft.mapping.PERSONAL_EMAIL && headers.length > 1 && (
                <div className="mt-3">
                  {(auto?.candidates ?? []).filter((c) => c !== col).slice(0, 1).map((other) => (
                    <CheckboxField key={other} label={<>Use <strong>{other}</strong> as the backup email</>} hint="If the main email is empty or invalid, Facilify uses this one instead." onChange={(e) => e.target.checked && setColumn('PERSONAL_EMAIL', other)} data-testid="use-backup-email" />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {usedTwice.length > 0 && (
        <Alert type="warning">
          {usedTwice.map(([c, phs]) => <span key={c} className="block">The column "{c}" is used for more than one field ({phs.map((p) => FIELD_SPECS.find((f) => f.key === p)?.label ?? p).join(', ')}). That is allowed, but check it is what you meant.</span>)}
        </Alert>
      )}

      <Card aria-labelledby="profiles-heading">
        <h2 id="profiles-heading" className="text-base font-semibold text-slate-900">Reuse your choices next time</h2>
        <p className="mt-0.5 text-sm text-slate-600">If you run similar events, save these column choices once and apply them in one click on the next sheet.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="flex items-end gap-2">
            <TextField label="Name for this setup" placeholder="Hackathon sheet" value={profileName} onChange={(e) => setProfileName(e.target.value)} data-testid="profile-name" />
            <Button variant="outline" onClick={saveProfile} disabled={!profileName.trim() || !done} data-testid="profile-save">Save</Button>
          </div>
          <SelectField label="Use a saved setup" value="" onChange={(e) => e.target.value && applyProfile(e.target.value)} data-testid="profile-use" disabled={!profiles.length}>
            <option value="">{profiles.length ? 'Choose a saved setup...' : 'Nothing saved yet'}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        </div>
        {profileMsg && <p role="status" className="mt-3 text-sm text-emerald-800" data-testid="profile-msg">{profileMsg}</p>}
      </Card>

      {mappedFields.length > 0 && (
        <Card aria-labelledby="read-heading">
          <h2 id="read-heading" className="text-base font-semibold text-slate-900">How Facilify reads your first students</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label="Your first students as Facilify reads them" tabIndex={0}>
            <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="read-preview">
              <thead className="bg-slate-50"><tr>{mappedFields.map((f) => <th key={f.key} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-700">{f.label.replace(' (optional)', '')}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sample.slice(0, 3).map((r, i) => <tr key={i}>{mappedFields.map((f) => <td key={f.key} className="whitespace-nowrap px-3 py-2 text-slate-800">{r[draft.mapping[f.key]]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <StepFooter
        back={<ButtonLink href="/upload" variant="ghost">Back</ButtonLink>}
        note={done ? undefined : 'Choose the Student name and Email address columns to continue.'}
        next={done ? <ButtonLink href="/fix" icon={<ArrowRightIcon size={16} />} data-testid="next">Next: check the rows</ButtonLink> : <Button disabled data-testid="next">Next: check the rows</Button>}
      />
    </div>
  );
}

export default function ColumnsPage() {
  return <StepGate step={2}><ColumnsInner /></StepGate>;
}
