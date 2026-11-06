'use client';

import React, { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, PageLoading, Spinner, StepFooter } from '@/components/ui/card';
import { CheckboxField, RadioCard, SelectField, TextField } from '@/components/ui/form';
import { ArrowRightIcon } from '@/components/ui/icons';
import { api, errorText } from '@/components/wizard/api';
import { awardsDone, buildScheme, categoriesFromDiscovery, type DraftRule } from '@/components/wizard/draft';
import { StepGate } from '@/components/wizard/gate';
import { RulesEditor } from '@/components/wizard/rules-editor';
import { thumbUrl, useTemplateChoices, type TemplateChoice } from '@/components/wizard/templates';
import { useWizard } from '@/components/wizard/wizard-context';
import type { AwardScheme } from '@/lib/contracts';
import { canonicalAward, mergeCategories, splitValue, type DiscoveredCategory } from '@/lib/routing/discover';

function TemplateSelect({ label, value, onChange, choices, none, testId, hideLabel }: {
  label: string; value: string; onChange: (id: string) => void; choices: TemplateChoice[]; none?: string; testId: string; hideLabel?: boolean;
}) {
  const builtins = choices.filter((c) => c.builtin);
  const mine = choices.filter((c) => !c.builtin);
  return (
    <SelectField label={label} hideLabel={hideLabel} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {none && <option value="">{none}</option>}
      <optgroup label="Ready-made designs">{builtins.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      {mine.length > 0 && <optgroup label="Your designs">{mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
    </SelectField>
  );
}

function AwardsInner() {
  const { draft, update } = useWizard();
  const { choices, loading: loadingTemplates } = useTemplateChoices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemes, setSchemes] = useState<AwardScheme[]>([]);
  const [schemeName, setSchemeName] = useState(draft.schemeName);
  const [schemeMsg, setSchemeMsg] = useState<string | null>(null);
  const headers = draft.sheet?.headers ?? [];

  useEffect(() => {
    if (!draft.awardColumns.length && draft.mapping.CERTIFICATE_TYPE) update({ awardColumns: [draft.mapping.CERTIFICATE_TYPE] });
  }, []);

  useEffect(() => {
    api<{ schemes: AwardScheme[] }>('/api/schemes').then((r) => setSchemes(r.schemes)).catch(() => setSchemes([]));
  }, []);

  const sig = `${draft.upload?.id}|${draft.awardColumns.join('|')}|${draft.skipRows.join(',')}`;
  useEffect(() => {
    if (!draft.upload) return;
    if (!draft.awardColumns.length) { update({ discovered: [], categories: [], discoverSig: sig }); return; }
    if (draft.discoverSig === sig && draft.categories.length) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    api<{ categories: DiscoveredCategory[] }>('/api/awards/discover', { json: { uploadId: draft.upload.id, awardColumns: draft.awardColumns, skipRows: draft.skipRows } })
      .then((r) => {
        if (cancelled) return;
        update((d) => ({ discovered: r.categories, categories: categoriesFromDiscovery(r.categories, d.categories), discoverSig: sig, prepared: undefined }));
      })
      .catch((e) => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [sig]);

  const patchCategory = (id: string, p: Partial<(typeof draft.categories)[number]>) =>
    update((d) => ({ categories: d.categories.map((c) => (c.id === id ? { ...c, ...p } : c)), prepared: undefined }));

  const rebuild = (found: DiscoveredCategory[]) =>
    update((d) => ({ discovered: found, categories: categoriesFromDiscovery(found, d.categories), prepared: undefined }));

  const toggleAwardColumn = (col: string, on: boolean) => {
    const next = on ? [...draft.awardColumns, col] : draft.awardColumns.filter((c) => c !== col);
    update({ awardColumns: next, prepared: undefined });
  };

  const loadScheme = (id: string) => {
    const s = schemes.find((x) => x.id === id);
    if (!s) return;
    const known = new Set(choices.map((c) => c.id));
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cols = s.awardColumns.map((c) => headers.find((h) => norm(h) === norm(c))).filter((c): c is string => !!c);
    const keyTemplate = new Map<string, string>();
    for (const c of s.categories) if (c.values && known.has(c.templateId)) for (const v of c.values) keyTemplate.set(canonicalAward(v), c.templateId);
    const rules: DraftRule[] = s.categories.filter((c) => c.match).map((c) => ({
      id: c.id, label: c.label, mode: c.match?.any ? 'any' : 'all', conditions: [...(c.match?.all ?? c.match?.any ?? [])],
      templateId: known.has(c.templateId) ? c.templateId : 'builtin:classic', driveSubfolder: c.driveSubfolder, linkedInTitle: c.linkedInTitle,
    }));
    update((d) => ({
      awardColumns: cols.length ? cols : d.awardColumns,
      categories: d.categories.map((c) => ({ ...c, templateId: keyTemplate.get(c.key) ?? c.templateId })),
      rules, multiAward: s.multiAward, delivery: s.delivery,
      defaultTemplateId: s.defaultTemplateId && known.has(s.defaultTemplateId) ? s.defaultTemplateId : d.defaultTemplateId,
      schemeName: s.name, prepared: undefined,
    }));
    setSchemeName(s.name);
    const fresh = draft.categories.filter((c) => !keyTemplate.has(c.key)).length;
    setSchemeMsg(`Applied "${s.name}".${fresh ? ` ${fresh} award${fresh === 1 ? ' is' : 's are'} new, so please check ${fresh === 1 ? 'its' : 'their'} design.` : ''}`);
  };

  const saveScheme = async () => {
    setError(null);
    try {
      const r = await api<{ scheme: AwardScheme }>('/api/schemes', { json: { scheme: { ...buildScheme(draft), name: schemeName } } });
      setSchemes((s) => [r.scheme, ...s]);
      update({ schemeName });
      setSchemeMsg(`Saved as "${r.scheme.name}". Next time, choose it under "Use a saved setup".`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (loadingTemplates) return <PageLoading label="Loading designs" />;
  const total = draft.categories.reduce((a, c) => a + c.count, 0);
  const done = awardsDone(draft);
  const templateOf = (id: string) => choices.find((c) => c.id === id)?.template;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <PageHeader step="Step 4 of 8" title="Awards and certificate designs" help="awards"
        subtitle="Facilify found every different award in your sheet. Choose which certificate design each one gets." />

      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}

      <Card aria-labelledby="award-col-heading">
        <h2 id="award-col-heading" className="text-base font-semibold text-slate-900">Which column says what award each student gets?</h2>
        <p className="mt-0.5 text-sm text-slate-600">Usually one column such as "Award". If awards are spread over several columns, tick them all.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Award columns" data-testid="award-columns">
          {headers.map((h) => (
            <CheckboxField key={h} label={h} checked={draft.awardColumns.includes(h)} onChange={(e) => toggleAwardColumn(h, e.target.checked)} data-testid={`award-col-${h}`} />
          ))}
        </div>
      </Card>

      <Card className="!p-0" aria-labelledby="cats-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h2 id="cats-heading" className="text-base font-semibold text-slate-900">Awards found in your sheet</h2>
            <p className="mt-0.5 text-sm text-slate-600">{draft.categories.length ? `${draft.categories.length} different award${draft.categories.length === 1 ? '' : 's'} for ${total} row${total === 1 ? '' : 's'}.` : ' '}</p>
          </div>
          {busy && <Spinner label="Reading your awards..." />}
        </div>
        {!draft.awardColumns.length ? (
          <p className="p-5 text-sm text-slate-700">No award column is chosen, so every student gets the same certificate. Pick the design under "Everyone else" below, or tick the award column above.</p>
        ) : draft.categories.length === 0 && !busy ? (
          <p className="p-5 text-sm text-slate-700">No award values were found in that column. Check that it is the right column.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="category-list">
            {draft.categories.map((c) => {
              const tpl = templateOf(c.templateId);
              const thumb = thumbUrl(tpl);
              const group = draft.discovered.find((d) => d.key === c.key);
              const others = draft.discovered.filter((d) => d.key !== c.key);
              return (
                <li key={c.id} className="p-4 sm:p-5" data-testid={`cat-${c.key}`}>
                  <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_auto] md:items-start">
                    <div>
                      <TextField label={`Name of the award ${c.label}`} hideLabel value={c.label} onChange={(e) => patchCategory(c.id, { label: e.target.value })} data-testid={`cat-label-${c.key}`} maxLength={80} />
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                        <Badge variant="indigo" size="sm">{c.count} student{c.count === 1 ? '' : 's'}</Badge>
                        {c.values.length > 1 && <span>Also written as: {c.values.filter((v) => v !== c.label).join(', ')}</span>}
                      </p>
                    </div>
                    <TemplateSelect label={`Certificate design for ${c.label}`} hideLabel value={c.templateId} choices={choices} onChange={(id) => patchCategory(c.id, { templateId: id })} testId={`cat-template-${c.key}`} />
                    {thumb ? <img src={thumb} alt={`Design: ${tpl?.name}`} width={96} height={68} className="hidden h-[68px] w-24 rounded border border-slate-200 object-cover md:block" /> : <div className="hidden md:block" />}
                  </div>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-indigo-800">More options for this award</summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <TextField label="Folder name in Drive (optional)" value={c.driveSubfolder ?? ''} onChange={(e) => patchCategory(c.id, { driveSubfolder: e.target.value })} hint="Leave empty to use the award name." />
                      <TextField label="Title on LinkedIn (optional)" value={c.linkedInTitle ?? ''} onChange={(e) => patchCategory(c.id, { linkedInTitle: e.target.value })} hint="Leave empty for 'Award - Event'." />
                      {others.length > 0 && (
                        <SelectField label="Combine with another award" value="" onChange={(e) => e.target.value && rebuild(mergeCategories(draft.discovered, c.key, e.target.value))} data-testid={`merge-${c.key}`}>
                          <option value="">Choose an award to combine into this one...</option>
                          {others.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </SelectField>
                      )}
                      {group && group.values.length > 1 && (
                        <div>
                          <p className="mb-1.5 text-sm font-medium text-slate-800">Treat a spelling as its own award</p>
                          <div className="flex flex-wrap gap-2">
                            {group.values.filter((v) => v !== c.label).map((v) => (
                              <Button key={v} variant="outline" size="sm" onClick={() => rebuild(splitValue(draft.discovered, v))} data-testid={`split-${v}`}>{v}</Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="else-heading">
        <h2 id="else-heading" className="text-base font-semibold text-slate-900">Everyone else</h2>
        <p className="mt-0.5 text-sm text-slate-600">Students whose award cell is empty, or whose award is not in the list above. If you choose nothing, Facilify will list them before sending so nobody is missed.</p>
        <div className="mt-3 max-w-md">
          <TemplateSelect label="Design for everyone else" value={draft.defaultTemplateId} choices={choices} none="Do not make a certificate (warn me)" onChange={(id) => update({ defaultTemplateId: id, prepared: undefined })} testId="default-template" />
        </div>
      </Card>

      <Card aria-labelledby="deliver-heading">
        <h2 id="deliver-heading" className="text-base font-semibold text-slate-900">When a student earns more than one award</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="How to deliver several certificates">
          <RadioCard name="delivery" value="one-email" checked={draft.delivery === 'one-email'} onChange={() => update({ delivery: 'one-email', prepared: undefined })} title="One email with all their certificates" description="Best for most events. Each certificate is attached as its own PDF." testId="delivery-one" />
          <RadioCard name="delivery" value="email-per-certificate" checked={draft.delivery === 'email-per-certificate'} onChange={() => update({ delivery: 'email-per-certificate', prepared: undefined })} title="A separate email for each certificate" description="Each award gets its own message, with its own wording if you set one." testId="delivery-many" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Several awards from one row">
          <RadioCard name="multi" value="all-matches" checked={draft.multiAward === 'all-matches'} onChange={() => update({ multiAward: 'all-matches', prepared: undefined })} title="Make a certificate for every award" description='A cell like "Participation; Best UI" gives two certificates.' testId="multi-all" />
          <RadioCard name="multi" value="first-match" checked={draft.multiAward === 'first-match'} onChange={() => update({ multiAward: 'first-match', prepared: undefined })} title="Only the first matching award per row" description="Use this if each row should give just one certificate." testId="multi-first" />
        </div>
      </Card>

      <Card aria-labelledby="rules-heading">
        <details data-testid="advanced-rules" open={draft.rules.length > 0}>
          <summary className="cursor-pointer text-base font-semibold text-slate-900" id="rules-heading">Special rules (advanced, optional)</summary>
          <p className="mb-4 mt-2 text-sm text-slate-600">For cases a list cannot cover, such as "Score is at least 90" or "Rank is between 1 and 3". Rules are checked first, in the order shown.</p>
          <RulesEditor rules={draft.rules} columns={headers} choices={choices} onChange={(rules) => update({ rules, prepared: undefined })} />
        </details>
      </Card>

      <Card aria-labelledby="saved-heading">
        <h2 id="saved-heading" className="text-base font-semibold text-slate-900">Save this for the next event</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="flex items-end gap-2">
            <TextField label="Name for this award setup" placeholder="Hackathon prizes" value={schemeName} onChange={(e) => setSchemeName(e.target.value)} data-testid="scheme-name" />
            <Button variant="outline" onClick={saveScheme} disabled={!schemeName.trim() || !done} data-testid="scheme-save">Save</Button>
          </div>
          <SelectField label="Use a saved setup" value="" onChange={(e) => e.target.value && loadScheme(e.target.value)} disabled={!schemes.length} data-testid="scheme-use">
            <option value="">{schemes.length ? 'Choose a saved setup...' : 'Nothing saved yet'}</option>
            {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
        </div>
        {schemeMsg && <p role="status" className="mt-3 text-sm text-emerald-800" data-testid="scheme-msg">{schemeMsg}</p>}
      </Card>

      <StepFooter
        back={<ButtonLink href="/fix" variant="ghost">Back</ButtonLink>}
        note={done ? undefined : 'Choose a design for every award to continue.'}
        next={done ? <ButtonLink href="/design" icon={<ArrowRightIcon size={16} />} data-testid="next">Next: design</ButtonLink> : <Button disabled data-testid="next">Next: design</Button>}
      />
    </div>
  );
}

export default function AwardsPage() {
  return <StepGate step={4}><AwardsInner /></StepGate>;
}
