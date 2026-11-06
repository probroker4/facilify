'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CertificateEditor } from '@/components/editor';
import { DEFAULT_PLACEHOLDERS, DEFAULT_SAMPLE_ROWS } from '@/components/editor/sampleRows';
import type { CertTemplate } from '@/lib/contracts';
import { builtinTemplate } from '@/lib/render/builtin';

function Host() {
  const q = useSearchParams();
  const [template, setTemplate] = useState<CertTemplate | null>(null);
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const upload = q.get('upload');
    if (upload) {
      const t = builtinTemplate('classic');
      setTemplate({ ...t, id: 'dev-upload', name: 'Uploaded template', kind: q.get('kind') === 'image' ? 'image' : 'pdf', backgroundRef: upload, pageSize: [Number(q.get('w')) || 842, Number(q.get('h')) || 595] });
    } else {
      setTemplate(builtinTemplate(q.get('design') || 'classic'));
    }
  }, [q]);

  const save = useCallback(async () => {
    if (!template) return;
    setStatus('Saving…');
    try {
      const res = await fetch('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Save failed');
      const back = await fetch(`/api/templates/${encodeURIComponent(j.id)}`);
      const bj = await back.json();
      if (!back.ok) throw new Error(bj.error || 'Could not read the saved template back');
      setSaved(JSON.stringify(bj.template ?? bj, null, 2));
      setStatus('Saved');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
    }
  }, [template]);

  if (!template) return <p className="p-6 text-sm text-slate-500">Loading the editor…</p>;
  const n = Number(q.get('rows')) || DEFAULT_SAMPLE_ROWS.length;
  return (
    <main className="mx-auto max-w-[1600px] space-y-3 p-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Text layer editor (developer page)</h1>
        <button type="button" data-testid="dev-save" onClick={save} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">Save to my templates</button>
        <span data-testid="dev-status" className="text-xs text-slate-500" role="status">{status}</span>
      </div>
      <CertificateEditor template={template} onChange={setTemplate} sampleRows={DEFAULT_SAMPLE_ROWS.slice(0, n)} placeholders={DEFAULT_PLACEHOLDERS} />
      <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">CertTemplate JSON</summary>
        <pre data-testid="template-json" className="mt-2 max-h-96 overflow-auto text-[11px] text-slate-700">{JSON.stringify(template, null, 2)}</pre>
        {saved && <><h2 className="mt-3 text-xs font-semibold uppercase text-slate-600">Read back from the server</h2><pre data-testid="saved-json" className="mt-1 max-h-96 overflow-auto text-[11px] text-slate-700">{saved}</pre></>}
      </details>
    </main>
  );
}

export default function DevEditorPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading the editor…</p>}><Host /></Suspense>;
}
