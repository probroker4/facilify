'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, PageLoading, Spinner, StepFooter } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/form';
import { ArrowRightIcon, Edit3Icon, UploadCloudIcon } from '@/components/ui/icons';
import { CertificateEditor } from '@/components/editor';
import { uploadBackgroundApi } from '@/components/editor/client';
import { DEFAULT_PLACEHOLDERS, DEFAULT_SAMPLE_ROWS } from '@/components/editor/sampleRows';
import { api, errorText } from '@/components/wizard/api';
import { placeholdersFor, sampleRowsFor, templateIdsInUse } from '@/components/wizard/draft';
import { StepGate } from '@/components/wizard/gate';
import { thumbUrl, useTemplateChoices } from '@/components/wizard/templates';
import { useWizard } from '@/components/wizard/wizard-context';
import type { CertTemplate } from '@/lib/contracts';
import { builtinTemplate } from '@/lib/render/builtin';

interface Editing {
  template: CertTemplate;
  originalId: string;
  assignTo: string;
  isNew: boolean;
}

const A4: [number, number] = [842, 595];

function fitLayersTo(t: CertTemplate, size: [number, number]): CertTemplate {
  const sx = size[0] / A4[0];
  const sy = size[1] / A4[1];
  return {
    ...t,
    pageSize: size,
    layers: t.layers.map((l) => ({
      ...l, x: Math.round(l.x * sx), y: Math.round(l.y * sy), width: Math.round(l.width * sx), height: Math.round(l.height * sy),
      style: { ...l.style, size: Math.round(l.style.size * sx * 10) / 10, minSize: l.style.minSize ? Math.round(l.style.minSize * sx * 10) / 10 : l.style.minSize },
    })),
  };
}

function DesignInner() {
  const { draft, update } = useWizard();
  const { choices, loading, reload } = useTemplateChoices();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usedIds = templateIdsInUse(draft);
  const usage = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (id: string, label: string) => { if (id) m.set(id, [...(m.get(id) ?? []), label]); };
    draft.rules.forEach((r) => add(r.templateId, r.label || 'Special rule'));
    draft.categories.forEach((c) => add(c.templateId, c.label));
    if (draft.defaultTemplateId) add(draft.defaultTemplateId, 'Everyone else');
    return m;
  }, [draft.categories, draft.rules, draft.defaultTemplateId]);

  const sampleRows = useMemo(() => {
    const rows = sampleRowsFor(draft);
    return rows.length ? rows : DEFAULT_SAMPLE_ROWS;
  }, [draft]);
  const placeholders = useMemo(() => {
    const p = placeholdersFor(draft);
    return p.length ? p : DEFAULT_PLACEHOLDERS;
  }, [draft]);

  const swapTemplate = (oldId: string, newId: string) =>
    update((d) => ({
      categories: d.categories.map((c) => (c.templateId === oldId ? { ...c, templateId: newId } : c)),
      rules: d.rules.map((r) => (r.templateId === oldId ? { ...r, templateId: newId } : r)),
      defaultTemplateId: d.defaultTemplateId === oldId ? newId : d.defaultTemplateId,
      prepared: undefined,
    }));

  const useFor = (assignTo: string, id: string) => {
    if (!assignTo) return;
    if (assignTo === 'default') update({ defaultTemplateId: id, prepared: undefined });
    else update((d) => ({ categories: d.categories.map((c) => (c.id === assignTo ? { ...c, templateId: id } : c)), prepared: undefined }));
  };

  const startEdit = (id: string) => {
    const choice = choices.find((c) => c.id === id);
    if (!choice) return;
    setError(null);
    setNotice(null);
    setEditing({ template: structuredClone(choice.template), originalId: id, assignTo: '', isNew: false });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const name = editing.template.name.trim() || 'My certificate design';
      const tpl = { ...editing.template, name };
      let id = editing.originalId;
      if (editing.isNew || id.startsWith('builtin:')) {
        const r = await api<{ id: string }>('/api/templates', { json: { template: tpl } });
        id = r.id;
        if (!editing.isNew) swapTemplate(editing.originalId, id);
      } else {
        await api(`/api/templates/${encodeURIComponent(id)}`, { method: 'PUT', json: { template: tpl } });
      }
      useFor(editing.assignTo, id);
      await reload();
      setNotice(`Saved "${name}". Your awards now use it.`);
      setEditing(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const up = await uploadBackgroundApi(file);
      const base = builtinTemplate('classic');
      const draftTpl = fitLayersTo({
        ...base, id: 'new', name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'My certificate design',
        kind: up.mime === 'application/pdf' ? 'pdf' : 'image', backgroundRef: up.uploadId,
      }, up.pageSize);
      const r = await api<{ id: string; template: CertTemplate }>('/api/templates', { json: { template: draftTpl } });
      await reload();
      setEditing({ template: r.template, originalId: r.id, assignTo: '', isNew: false });
      setNotice('Your design is uploaded and saved. Place the text boxes on it, choose which award uses it, then press Save.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoading label="Loading designs" />;

  return (
    <div className={`mx-auto space-y-6 pb-10 ${editing ? 'max-w-none' : 'max-w-5xl'}`}>
      <PageHeader step="Step 5 of 8" title="Design your certificates" help="design"
        subtitle="Facilify only adds a text layer on top of your design. Your background is never changed. Change fonts, sizes and colours, or upload your own design." />

      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert type="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      {editing ? (
        <Card aria-labelledby="edit-heading" data-testid="editor-card">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-[14rem] flex-1">
              <h2 id="edit-heading" className="text-base font-semibold text-slate-900">Edit the text on this design</h2>
              <p className="mt-0.5 text-sm text-slate-600">Click any words on the certificate, then drag to move them or use the panel on the right to change the font, size and colour. Items like [Student name] are filled in with each student's own details. Press Full screen for the biggest view.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy} data-testid="editor-cancel">Cancel</Button>
              <Button onClick={save} loading={busy} data-testid="editor-save">Save design</Button>
            </div>
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <TextField label="Name of this design" value={editing.template.name} maxLength={80}
              onChange={(e) => setEditing({ ...editing, template: { ...editing.template, name: e.target.value } })} data-testid="design-name" />
            {(editing.isNew || !editing.template.id.startsWith('builtin:')) && !usedIds.includes(editing.originalId) && (
              <SelectField label="Use this design for" value={editing.assignTo} onChange={(e) => setEditing({ ...editing, assignTo: e.target.value })} data-testid="assign-to">
                <option value="">Choose later</option>
                {draft.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                <option value="default">Everyone else</option>
              </SelectField>
            )}
          </div>
          <CertificateEditor template={editing.template} onChange={(t) => setEditing((cur) => (cur ? { ...cur, template: t } : cur))}
            sampleRows={sampleRows} placeholders={placeholders} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} loading={busy} data-testid="editor-save-bottom">Save design</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="!p-0" aria-labelledby="used-heading">
            <div className="border-b border-slate-200 p-4 sm:p-5">
              <h2 id="used-heading" className="text-base font-semibold text-slate-900">Designs your awards use</h2>
              <p className="mt-0.5 text-sm text-slate-600">The ready-made designs work as they are. Press "Edit text" to change how the text looks. Ready-made designs stay untouched: Facilify saves your own copy.</p>
            </div>
            {usedIds.length === 0 ? (
              <p className="p-5 text-sm text-slate-700">No design is chosen yet. Go back to the Awards step and choose a design for each award.</p>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="design-list">
                {usedIds.map((id) => {
                  const choice = choices.find((c) => c.id === id);
                  if (!choice) return (
                    <li key={id} className="p-4 text-sm text-rose-800 sm:p-5">One of the chosen designs no longer exists. Go back to Awards and pick another.</li>
                  );
                  const thumb = thumbUrl(choice.template, 0.4);
                  const who = usage.get(id) ?? [];
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-4 p-4 sm:p-5" data-testid={`design-${id}`}>
                      {thumb ? <img src={thumb} alt={`Background of ${choice.name}`} width={144} height={102} className="h-[102px] w-36 rounded border border-slate-200 object-cover" /> : <div className="h-[102px] w-36 rounded border border-slate-200 bg-slate-100" />}
                      <div className="min-w-[12rem] flex-1">
                        <p className="font-medium text-slate-900">{choice.name} {choice.builtin && <Badge variant="slate" size="sm">Ready-made</Badge>}</p>
                        <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-600">
                          Used for: {who.map((w) => <Badge key={w} variant="indigo" size="sm">{w}</Badge>)}
                        </p>
                      </div>
                      <Button variant="outline" icon={<Edit3Icon size={16} />} onClick={() => startEdit(id)} data-testid={`edit-${id}`}>Edit text</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card aria-labelledby="own-heading">
            <h2 id="own-heading" className="text-base font-semibold text-slate-900">Use my own certificate design</h2>
            <p className="mt-0.5 text-sm text-slate-600">Upload a PDF, PNG or JPG from Canva, Word or anywhere else. Facilify keeps it exactly as it is and only draws the student text on top.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" className="sr-only" onChange={onUpload} aria-label="Choose your certificate design file" data-testid="own-design-input" />
              <Button variant="outline" icon={<UploadCloudIcon size={16} />} onClick={() => fileRef.current?.click()} disabled={busy} data-testid="own-design">Upload my design</Button>
              {busy && <Spinner label="Working..." />}
            </div>
          </Card>
        </>
      )}

      <StepFooter
        back={<ButtonLink href="/awards" variant="ghost">Back</ButtonLink>}
        note={editing ? 'Save or cancel your edit to continue.' : undefined}
        next={editing
          ? <Button disabled data-testid="next">Next: email wording</Button>
          : <ButtonLink href="/email" icon={<ArrowRightIcon size={16} />} data-testid="next">Next: email wording</ButtonLink>}
      />
    </div>
  );
}

export default function DesignPage() {
  return <StepGate step={5}><DesignInner /></StepGate>;
}
