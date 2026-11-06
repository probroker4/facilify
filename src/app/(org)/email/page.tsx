'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader, Spinner, StepFooter } from '@/components/ui/card';
import { CheckboxField, TextAreaField, TextField } from '@/components/ui/form';
import { ArrowRightIcon, EyeIcon } from '@/components/ui/icons';
import { api, errorText } from '@/components/wizard/api';
import { bodyToHtml, placeholdersFor, toDraftConfig, type Draft, type DraftCategory } from '@/components/wizard/draft';
import { StepGate } from '@/components/wizard/gate';
import { useWizard } from '@/components/wizard/wizard-context';

interface Wording { subject: string; body: string }

function WordingEditor({ idPrefix, value, onChange, fields }: {
  idPrefix: string; value: Wording; onChange: (v: Wording) => void; fields: string[];
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const insert = (field: string) => {
    const el = bodyRef.current;
    const tag = `{{${field}}}`;
    const start = el?.selectionStart ?? value.body.length;
    const end = el?.selectionEnd ?? value.body.length;
    const next = value.body.slice(0, start) + tag + value.body.slice(end);
    onChange({ ...value, body: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  };
  return (
    <div className="space-y-3">
      <TextField label="Subject line" value={value.subject} maxLength={200} onChange={(e) => onChange({ ...value, subject: e.target.value })} data-testid={`${idPrefix}-subject`} />
      <TextAreaField label="Message" rows={9} value={value.body} ref={bodyRef} onChange={(e) => onChange({ ...value, body: e.target.value })} data-testid={`${idPrefix}-body`}
        hint="Write it like a normal email. Click a field below to put the student's own detail in that spot." />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert a field into the message">
        {fields.map((f) => (
          <button key={f} type="button" onClick={() => insert(f)} data-testid={`${idPrefix}-chip-${f}`}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
            {`{{${f}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmailInner() {
  const router = useRouter();
  const { draft, update } = useWizard();
  const [busy, setBusy] = useState<'preview' | 'next' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowIndex, setRowIndex] = useState(0);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string; from: string; attachments: string[]; name: string } | null>(null);
  const saved = useRef(new Map<string, string>());

  const fields = useMemo(() => {
    const set = new Set<string>(placeholdersFor(draft));
    set.add('AWARDS');
    set.add('ORGANIZATION');
    return [...set];
  }, [draft]);

  const std: Wording = { subject: draft.email.subject, body: draft.email.body };

  const setStd = (v: Wording) => update((d) => ({ email: { ...d.email, ...v, savedId: undefined }, prepared: undefined }));
  const setFlag = (p: Partial<Draft['email']>) => update((d) => ({ email: { ...d.email, ...p, savedId: undefined }, categories: d.categories.map((c) => (c.customEmail ? { ...c, customEmail: { ...c.customEmail, savedId: undefined } } : c)), prepared: undefined }));
  const patchCat = (id: string, p: Partial<DraftCategory>) => update((d) => ({ categories: d.categories.map((c) => (c.id === id ? { ...c, ...p } : c)), prepared: undefined }));

  const saveAll = async (): Promise<Draft> => {
    const post = async (key: string, w: Wording, existing: string | undefined, name: string): Promise<string> => {
      const sig = JSON.stringify([w.subject, w.body, draft.email.includeDriveLink, draft.email.includeLinkedIn]);
      if (existing && saved.current.get(key) === sig) return existing;
      const r = await api<{ id: string }>('/api/email-templates', {
        json: { name, template: { subject: w.subject, html: bodyToHtml(w.body), includeDriveLink: draft.email.includeDriveLink, includeLinkedIn: draft.email.includeLinkedIn } },
      });
      saved.current.set(key, sig);
      return r.id;
    };
    const stdId = await post('std', std, draft.email.savedId, 'Standard wording');
    const categories: DraftCategory[] = [];
    for (const c of draft.categories) {
      if (!c.customEmail) { categories.push(c); continue; }
      const id = await post(c.id, c.customEmail, c.customEmail.savedId, `${c.label} wording`);
      categories.push({ ...c, customEmail: { ...c.customEmail, savedId: id } });
    }
    const next: Draft = { ...draft, email: { ...draft.email, savedId: stdId }, categories, prepared: undefined };
    update({ email: next.email, categories, prepared: undefined });
    return next;
  };

  const showPreview = async () => {
    if (!draft.upload) return;
    setBusy('preview');
    setError(null);
    try {
      const next = await saveAll();
      const r = await api<{ subject: string; html: string; to: string; from: string; attachments: string[]; name: string }>('/api/preview/email', {
        json: { uploadId: draft.upload.id, draft: toDraftConfig(next), index: Math.max(0, rowIndex) },
      });
      setPreview(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const next = async () => {
    setBusy('next');
    setError(null);
    try {
      await saveAll();
      router.push('/preview');
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const valid = std.subject.trim() && std.body.trim() && draft.categories.every((c) => !c.customEmail || (c.customEmail.subject.trim() && c.customEmail.body.trim()));

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <PageHeader step="Step 6 of 8" title="Email wording" help="email"
        subtitle="This is the message each student receives with their certificate attached. Every student gets only their own certificate." />

      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}

      <Card aria-labelledby="std-heading">
        <h2 id="std-heading" className="text-base font-semibold text-slate-900">Standard wording</h2>
        <p className="mb-4 mt-0.5 text-sm text-slate-600">Used for every award unless you give an award its own wording below.</p>
        <WordingEditor idPrefix="std" value={std} onChange={setStd} fields={fields} />
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <CheckboxField label="Add an &quot;Add to LinkedIn&quot; button" checked={draft.email.includeLinkedIn} onChange={(e) => setFlag({ includeLinkedIn: e.target.checked })}
            hint="Opens LinkedIn with the certificate details filled in. The student can edit them before saving." data-testid="include-linkedin" />
          <CheckboxField label="Include a link to the saved copy" checked={draft.email.includeDriveLink} onChange={(e) => setFlag({ includeDriveLink: e.target.checked })}
            hint="Adds a link to the certificate in your Google Drive or folder." data-testid="include-drive" />
        </div>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="auto-note">
          Every email also gets a <strong>Report a problem</strong> button (so a student can flag a typo and you see it in Tickets) and a link to verify the certificate. You do not need to write these.
        </p>
      </Card>

      {draft.categories.length > 0 && (
        <Card aria-labelledby="cat-heading">
          <h2 id="cat-heading" className="text-base font-semibold text-slate-900">Different wording for an award (optional)</h2>
          <p className="mb-3 mt-0.5 text-sm text-slate-600">For example a warmer message for winners. Awards without their own wording use the standard one.</p>
          <ul className="divide-y divide-slate-100">
            {draft.categories.map((c) => (
              <li key={c.id} className="py-3" data-testid={`email-cat-${c.key}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <CheckboxField label={`Use different wording for ${c.label}`} checked={!!c.customEmail}
                    onChange={(e) => patchCat(c.id, { customEmail: e.target.checked ? { subject: std.subject, body: std.body } : null })} data-testid={`email-custom-${c.key}`} />
                  <Badge variant="indigo" size="sm">{c.count} student{c.count === 1 ? '' : 's'}</Badge>
                </div>
                {c.customEmail && (
                  <div className="mt-3 rounded-lg border border-slate-200 p-3">
                    <WordingEditor idPrefix={`cat-${c.key}`} value={c.customEmail} fields={fields}
                      onChange={(v) => patchCat(c.id, { customEmail: { ...v } })} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card aria-labelledby="prev-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="prev-heading" className="text-base font-semibold text-slate-900">See the email as a student sees it</h2>
            <p className="mt-0.5 text-sm text-slate-600">Uses a real row from your sheet. Nothing is sent.</p>
          </div>
          <div className="flex items-end gap-2">
            <div className="w-28">
              <TextField label="Student number" type="number" min={1} value={rowIndex + 1} onChange={(e) => setRowIndex(Math.max(0, (Number(e.target.value) || 1) - 1))} data-testid="preview-index" />
            </div>
            <Button variant="outline" onClick={showPreview} disabled={!valid || busy !== null || !draft.upload} icon={<EyeIcon size={16} />} data-testid="preview-email">Preview email</Button>
          </div>
        </div>
        {busy === 'preview' && <div className="mt-3"><Spinner label="Preparing preview..." /></div>}
        {preview && (
          <div className="mt-4 space-y-2" data-testid="email-preview">
            <p className="text-sm text-slate-700"><strong>To:</strong> {preview.to} ({preview.name}) &nbsp; <strong>Subject:</strong> {preview.subject}</p>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-lg border border-slate-200 bg-white" />
            <p className="text-sm text-slate-700"><strong>Attached:</strong> {preview.attachments.length ? preview.attachments.join(', ') : 'nothing'}</p>
          </div>
        )}
      </Card>

      <StepFooter
        back={<ButtonLink href="/design" variant="ghost">Back</ButtonLink>}
        note={valid ? undefined : 'Every wording needs a subject and a message.'}
        next={<Button onClick={next} disabled={!valid || busy !== null} icon={<ArrowRightIcon size={16} />} data-testid="next">{busy === 'next' ? 'Saving...' : 'Next: preview'}</Button>}
      />
    </div>
  );
}

export default function EmailPage() {
  return <StepGate step={6}><EmailInner /></StepGate>;
}
