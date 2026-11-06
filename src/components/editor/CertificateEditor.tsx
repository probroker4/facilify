'use client';

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CertTemplate, TextLayer } from '@/lib/contracts';
import { A4_LANDSCAPE, BUILTIN_BACKGROUNDS } from '@/lib/render/builtin';
import { Canvas } from './Canvas';
import {
  colourStore, layoutApi, paletteApi, renderPreviewApi, templateFontsApi, uploadBackgroundApi, forgetSampler,
  type FitInfo, type TemplateFontSuggestion,
} from './client';
import { FontFinder } from './FontFinder';
import { friendlyText } from './friendly';
import { QrPanel } from './QrPanel';
import { StylePanel } from './StylePanel';
import {
  backgroundRefOf, duplicateLayer, History, longestRowIndex, makeLayer, replaceLayer, round1, sampleValuesFor,
} from './logic';

export interface CertificateEditorProps {
  template: CertTemplate;
  onChange: (t: CertTemplate) => void;
  sampleRows: Record<string, string>[];
  placeholders: string[];
  className?: string;
}

type RenderState = 'loading' | 'ready' | 'error';

const QR_ID = '__qr__';

const btn = 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

function describeFit(f: FitInfo): string[] {
  const out: string[] = [];
  if (f.fit.abbreviated) out.push(`shortened to "${f.fit.lines.join(' ')}"`);
  if (f.fit.wrapped) out.push(`on ${f.fit.lines.length} lines`);
  if (f.fit.shrunk) out.push(`shrunk to ${Math.round(f.fit.fontSize * 10) / 10} pt`);
  if (f.fit.overflow) out.push('still too long: make the box bigger');
  return out;
}

export function CertificateEditor({ template, onChange, sampleRows, placeholders, className = '' }: CertificateEditorProps) {
  const rows = sampleRows ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(template.layers[0]?.id ?? null);
  const [rowIndex, setRowIndex] = useState(0);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [wrapW, setWrapW] = useState(0);
  const [showBoxes, setShowBoxes] = useState(true);
  const [templateOnly, setTemplateOnly] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<RenderState>('loading');
  const [renderError, setRenderError] = useState('');
  const [renderCount, setRenderCount] = useState(0);
  const [fits, setFits] = useState<FitInfo[]>([]);
  const [palette, setPalette] = useState<string[]>([]);
  const [templateFonts, setTemplateFonts] = useState<TemplateFontSuggestion[]>([]);
  const [bgMsg, setBgMsg] = useState('');
  const [dpr, setDpr] = useState(1);
  const [big, setBig] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('facilify.editor.mode') === 'advanced') setAdvanced(true); } catch {  }
  }, []);
  const chooseMode = (adv: boolean) => {
    setAdvanced(adv);
    if (!adv) { setShowBoxes(true); setTemplateOnly(false); setZoomMode('fit'); }
    try { localStorage.setItem('facilify.editor.mode', adv ? 'advanced' : 'basic'); } catch {  }
  };
  const [hintOpen, setHintOpen] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem('facilify.editor.hint') === 'off') setHintOpen(false); } catch {  }
  }, []);
  const hideHint = () => {
    setHintOpen(false);
    try { localStorage.setItem('facilify.editor.hint', 'off'); } catch {  }
  };
  useEffect(() => {
    if (!big) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [big]);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const history = useRef(new History<CertTemplate>());
  const current = useRef(template);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (template === current.current) return;
    if (template.id !== current.current.id) history.current.clear();
    current.current = template;
  }, [template]);

  const apply = useCallback((next: CertTemplate, key: string | null) => {
    history.current.record(current.current, key);
    current.current = next;
    onChangeRef.current(next);
    bump();
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.undo(current.current);
    if (!prev) return;
    current.current = prev;
    onChangeRef.current(prev);
    bump();
  }, []);
  const redo = useCallback(() => {
    const next = history.current.redo(current.current);
    if (!next) return;
    current.current = next;
    onChangeRef.current(next);
    bump();
  }, []);

  const selected = template.layers.find((l) => l.id === selectedId) ?? null;
  const qrSelected = selectedId === QR_ID && !!template.qr;
  useEffect(() => {
    if (selectedId === QR_ID && template.qr) return;
    if (selectedId && !template.layers.some((l) => l.id === selectedId)) setSelectedId(template.layers[0]?.id ?? null);
  }, [template.layers, template.qr, selectedId]);

  const updateLayer = useCallback((layer: TextLayer, key: string | null) => apply(replaceLayer(current.current, layer), key), [apply]);

  const addLayer = useCallback(() => {
    const layer = makeLayer(current.current, { content: placeholders[0] ? `{{${placeholders[0]}}}` : 'New text' });
    apply({ ...current.current, layers: [...current.current.layers, layer] }, null);
    setSelectedId(layer.id);
  }, [apply, placeholders]);

  const addQr = useCallback(() => {
    const t = current.current;
    if (t.qr) { setSelectedId(QR_ID); return; }
    const size = 90;
    apply({ ...t, qr: { size, x: Math.round(t.pageSize[0] - size - 50), y: Math.round(t.pageSize[1] - size - 45) } }, null);
    setSelectedId(QR_ID);
  }, [apply]);
  const removeQr = useCallback(() => {
    const { qr: _gone, ...rest } = current.current;
    void _gone;
    apply(rest as CertTemplate, null);
    setSelectedId(current.current.layers[0]?.id ?? null);
  }, [apply]);
  const changeQr = useCallback((qr: NonNullable<CertTemplate['qr']>, key: string | null) => apply({ ...current.current, qr }, key ? `qr:${key}` : null), [apply]);

  const dupLayer = useCallback((id: string) => {
    const copy = duplicateLayer(current.current, id);
    if (!copy) return;
    apply({ ...current.current, layers: [...current.current.layers, copy] }, null);
    setSelectedId(copy.id);
  }, [apply]);

  const deleteLayer = useCallback((id: string) => {
    const t = current.current;
    const idx = t.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const layers = t.layers.filter((l) => l.id !== id);
    apply({ ...t, layers }, null);
    setSelectedId(layers[Math.min(idx, layers.length - 1)]?.id ?? null);
  }, [apply]);

  const nudge = useCallback((id: string, dx: number, dy: number) => {
    const l = current.current.layers.find((x) => x.id === id);
    if (l) updateLayer({ ...l, x: round1(l.x + dx), y: round1(l.y + dy) }, `nudge:${id}`);
  }, [updateLayer]);

  const fixOverflow = useCallback((id: string) => {
    const t = current.current;
    const l = t.layers.find((x) => x.id === id);
    if (!l) return;
    const [pageW] = t.pageSize;
    const width = Math.min(pageW - 40, round1(l.width * 1.25));
    const x = Math.max(20, Math.min(pageW - 20 - width, round1(l.x - (width - l.width) / 2)));
    updateLayer({ ...l, x, width, height: round1(l.height * 1.2), style: { ...l.style, maxLines: Math.min(10, l.style.maxLines + 1), fit: { ...l.style.fit, mode: 'shrink-then-wrap', allowAbbreviate: true } } }, null);
  }, [updateLayer]);

  const moveInOrder = (id: string, dir: -1 | 1) => {
    const layers = [...current.current.layers];
    const i = layers.findIndex((l) => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    [layers[i], layers[j]] = [layers[j], layers[i]];
    apply({ ...current.current, layers }, null);
  };

  const safeRow = Math.min(rowIndex, Math.max(0, rows.length - 1));
  const values = useMemo(() => sampleValuesFor(placeholders, rows, safeRow), [placeholders, rows, safeRow]);
  const valuesKey = JSON.stringify(values);
  const rowLabel = rows.length ? (values.NAME || values.Name || Object.values(values)[0] || '') : 'sample values';
  const previewText = values.NAME || rowLabel || 'Ada Lovelace';

  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [pw, ph] = template.pageSize;
  const fitScale = wrapW > 0 ? Math.min(2.5, Math.max(0.3, (wrapW - 4) / pw)) : 0.9;
  const scale = zoomMode === 'fit' ? fitScale : zoomMode;
  const renderScale = Math.min(3, Math.max(1, Math.ceil(scale * dpr * 2) / 2));

  const templateKey = JSON.stringify(template);
  const renderKey = `${templateKey}|${valuesKey}|${renderScale}|${rows.length}`;
  const [renderedKey, setRenderedKey] = useState('');
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setRenderState('loading');
    const t = setTimeout(async () => {
      const [img, fit] = await Promise.allSettled([
        renderPreviewApi(template, values, rows, renderScale, ctl.signal),
        layoutApi(template, values, rows, ctl.signal),
      ]);
      if (ctl.signal.aborted) return;
      if (fit.status === 'fulfilled') setFits(fit.value);
      if (img.status === 'fulfilled') {
        const url = URL.createObjectURL(img.value);
        const old = lastUrl.current;
        lastUrl.current = url;
        setRenderUrl(url);
        setRenderState('ready');
        setRenderedKey(`${templateKey}|${valuesKey}|${renderScale}|${rows.length}`);
        setRenderError('');
        setRenderCount((n) => n + 1);
        if (old) setTimeout(() => URL.revokeObjectURL(old), 3000);
      } else {
        setRenderState('error');
        setRenderError(img.reason instanceof Error ? img.reason.message : 'The preview could not be drawn.');
      }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [templateKey, valuesKey, renderScale, rows.length]);
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  const ref = backgroundRefOf(template);
  useEffect(() => {
    const ctl = new AbortController();
    setPalette([]);
    paletteApi(ref, ctl.signal).then((c) => setPalette(c.map((x) => x.hex))).catch(() => {  });
    return () => ctl.abort();
  }, [ref]);
  useEffect(() => {
    const ctl = new AbortController();
    setTemplateFonts([]);
    if (/^up_/.test(ref)) templateFontsApi(ref, ctl.signal).then(setTemplateFonts).catch(() => {  });
    return () => ctl.abort();
  }, [ref]);

  useEffect(() => {
    if (!sampling && !big) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (sampling) setSampling(false);
      else if (big && !typing) setBig(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [sampling, big]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable;
    if (e.key === 'Escape' && sampling) { setSampling(false); return; }
    if (e.key === 'Escape' && big && !typing) { setBig(false); return; }
    if (typing) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && qrSelected) { e.preventDefault(); removeQr(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteLayer(selected.id); }
  }

  async function uploadBackground(file: File | undefined) {
    if (!file) return;
    setBgMsg('Uploading…');
    try {
      const r = await uploadBackgroundApi(file);
      forgetSampler(r.uploadId);
      apply({ ...current.current, kind: r.mime === 'application/pdf' ? 'pdf' : 'image', backgroundRef: r.uploadId, pageSize: r.pageSize, name: current.current.name }, null);
      setBgMsg(`Using ${r.name}. The file itself is never changed: text is drawn on top of it.`);
    } catch (e) {
      setBgMsg(e instanceof Error ? e.message : 'The template could not be uploaded.');
    }
  }

  async function downloadPdf() {
    try {
      const res = await fetch('/api/editor/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template, values, format: 'pdf', rows: template.layers.some((l) => l.style.fit.uniformAcrossBatch) ? rows : undefined }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'The PDF could not be made.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'sample-certificate.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : 'The PDF could not be made.');
    }
  }

  const usedFontIds = [...new Set(template.layers.map((l) => l.style.fontId))];
  const fitNotes = fits.map((f) => ({ f, notes: describeFit(f) })).filter((x) => x.notes.length);
  const longest = rows.length ? longestRowIndex(rows, template) : 0;

  return (
    <div
      data-testid="editor-root" data-render-state={renderState} data-render-fresh={renderState === 'ready' && renderedKey === renderKey ? '1' : '0'} data-render-count={renderCount} data-row={safeRow + 1}
      className={`flex flex-col gap-3 text-slate-900 ${big ? 'fixed inset-0 z-50 overflow-auto bg-slate-100 p-3 sm:p-4' : ''} ${className}`} onKeyDown={onKeyDown}
    >
      {hintOpen && (
        <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950" data-testid="editor-hint">
          <ol className="flex-1 list-decimal space-y-0.5 pl-5">
            <li><strong>Click</strong> any words on the certificate to select them.</li>
            <li><strong>Drag</strong> the box to move it. Drag a corner to make it bigger or smaller.</li>
            <li>Use the panel on the right to change the <strong>font, size and colour</strong>. Every change shows straight away.</li>
          </ol>
          <button type="button" onClick={hideHint} data-testid="editor-hint-close" className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100">Got it</button>
        </div>
      )}
      {finderOpen && (
        <FontFinder
          backgroundRef={ref} layers={template.layers} selectedId={selectedId} onClose={() => setFinderOpen(false)}
          onApply={(fontId, bold, target) => {
            const t = current.current;
            const layers = t.layers.map((l) => (target === 'all' || l.id === target ? { ...l, style: { ...l.style, fontId, bold: bold || l.style.bold } } : l));
            apply({ ...t, layers }, null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2" role="toolbar" aria-label="Editor tools">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-xs" role="group" aria-label="Editor mode">
          <button type="button" data-testid="mode-basic" aria-pressed={!advanced} onClick={() => chooseMode(false)} title="Easy editing. The program fits long names and spaces the text for you." className={`px-3 py-1.5 font-medium ${!advanced ? 'bg-indigo-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Basic</button>
          <button type="button" data-testid="mode-advanced" aria-pressed={advanced} onClick={() => chooseMode(true)} title="Every control: exact positions, spacing, auto-fit rules and more." className={`px-3 py-1.5 font-medium ${advanced ? 'bg-indigo-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Advanced</button>
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" className={btn} data-testid="layer-add" onClick={addLayer}>+ Add text</button>
        <button type="button" className={`${btn} border-indigo-300 bg-indigo-50 text-indigo-800`} data-testid="open-font-finder" onClick={() => setFinderOpen(true)} title="Find the font used in your template and use it for any text">Find template font</button>
        <button type="button" className={btn} data-testid="qr-add" onClick={addQr} title="Optional: stamp a QR code that opens a live verification page">{template.qr ? 'Select QR code' : '+ Add QR code'}</button>
        <button type="button" className={btn} data-testid="layer-duplicate" disabled={!selected} onClick={() => selected && dupLayer(selected.id)}>Duplicate</button>
        <button type="button" className={btn} data-testid="layer-delete" disabled={!selected} onClick={() => selected && deleteLayer(selected.id)}>Delete</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" className={btn} data-testid="undo" aria-label="Undo" disabled={!history.current.canUndo} onClick={undo}>&larr; Undo</button>
        <button type="button" className={btn} data-testid="redo" aria-label="Redo" disabled={!history.current.canRedo} onClick={redo}>Redo &rarr;</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {advanced && <><label className="flex items-center gap-1 text-xs text-slate-600">
          Zoom
          <select
            aria-label="Zoom" data-testid="zoom" value={zoomMode === 'fit' ? 'fit' : String(zoomMode)}
            onChange={(e) => setZoomMode(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs"
          >
            <option value="fit">Fit to screen</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" data-testid="boxes-toggle" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> Show outlines around text
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" data-testid="template-only-toggle" checked={templateOnly} onChange={(e) => setTemplateOnly(e.target.checked)} /> Hide my text (see the plain template)
        </label></>}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <div className="flex items-center gap-1 text-xs text-slate-600" role="group" aria-label="Preview as row">
          <span>Show the certificate for student</span>
          <button type="button" className={btn} aria-label="Previous row" data-testid="row-prev" disabled={safeRow <= 0} onClick={() => setRowIndex(safeRow - 1)}>&lsaquo;</button>
          <input
            type="number" aria-label="Row number" data-testid="row-input" min={1} max={Math.max(1, rows.length)} value={safeRow + 1} disabled={!rows.length}
            onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n) && n >= 1 && n <= rows.length) setRowIndex(n - 1); }}
            className="w-14 rounded-md border border-slate-300 px-1.5 py-1 text-center text-xs"
          />
          <span data-testid="row-count">of {rows.length || 0}</span>
          <button type="button" className={btn} aria-label="Next row" data-testid="row-next" disabled={safeRow >= rows.length - 1} onClick={() => setRowIndex(safeRow + 1)}>&rsaquo;</button>
          {advanced && <button type="button" className={btn} data-testid="row-longest" disabled={!rows.length} onClick={() => setRowIndex(longest)} title="Jump to the student with the longest name, the hardest one to fit">Try the longest name</button>}
        </div>
        <span className="truncate text-xs text-slate-500" data-testid="row-label">{rowLabel}</span>
        <button type="button" className={`${btn} ml-auto`} data-testid="download-pdf" onClick={downloadPdf}>Download a sample PDF</button>
        <button type="button" className={`${btn} border-indigo-300 bg-indigo-50 text-indigo-800`} data-testid="fullscreen" aria-pressed={big} onClick={() => setBig((b) => !b)}>{big ? 'Close full screen (Esc)' : 'Full screen'}</button>
        {!hintOpen && <button type="button" className={btn} data-testid="editor-hint-open" onClick={() => setHintOpen(true)}>Help</button>}
      </div>

      <div className={`grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] ${big ? '' : 'xl:grid-cols-[210px_minmax(0,1fr)_320px]'}`}>
        <div className={`order-3 space-y-3 lg:col-span-2 xl:order-1 xl:col-span-1 ${big ? 'hidden' : ''}`}>
          <section className="rounded-lg border border-slate-200 bg-white" aria-label="Text boxes" data-testid="layer-list">
            <h3 className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Everything on the certificate</h3>
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {template.layers.map((l, i) => (
                <li key={l.id} className={`flex items-center gap-1 px-2 py-1 ${l.id === selectedId ? 'bg-indigo-50' : ''}`}>
                  <button
                    type="button" data-testid={`layer-item-${l.id}`} aria-pressed={l.id === selectedId} onClick={() => setSelectedId(l.id)}
                    className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs text-slate-800 hover:bg-slate-50"
                  >{friendlyText(l.content)}</button>
                  {advanced && <><button type="button" aria-label="Move up" data-testid={`layer-up-${l.id}`} disabled={i === 0} onClick={() => moveInOrder(l.id, -1)} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">&uarr;</button>
                  <button type="button" aria-label="Move down" data-testid={`layer-down-${l.id}`} disabled={i === template.layers.length - 1} onClick={() => moveInOrder(l.id, 1)} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">&darr;</button></>}
                </li>
              ))}
              {template.qr && (
                <li className={`flex items-center gap-1 px-2 py-1 ${qrSelected ? 'bg-indigo-50' : ''}`}>
                  <button type="button" data-testid="layer-item-qr" aria-pressed={qrSelected} onClick={() => setSelectedId(QR_ID)} className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs text-slate-800 hover:bg-slate-50">[QR code] Scan to verify</button>
                </li>
              )}
              {!template.layers.length && !template.qr && <li className="px-3 py-3 text-xs text-slate-500">Nothing here yet. Press + Add text.</li>}
            </ul>
          </section>

          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" aria-label="Template" data-testid="background-section">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Template</h3>
            <label className="block text-[11px] text-slate-500">
              Built-in design
              <select
                aria-label="Built-in design" data-testid="builtin-select"
                value={template.kind === 'builtin' ? backgroundRefOf(template) : ''}
                onChange={(e) => e.target.value && apply({ ...current.current, kind: 'builtin', backgroundRef: e.target.value, pageSize: A4_LANDSCAPE }, null)}
                className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
              >
                {template.kind !== 'builtin' && <option value="">Your uploaded template</option>}
                {BUILTIN_BACKGROUNDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="block text-[11px] text-slate-500">
              Or use your own design (PDF, PNG, JPG)
              <input type="file" accept="application/pdf,image/png,image/jpeg" aria-label="Upload a certificate template" data-testid="background-upload" onChange={(e) => uploadBackground(e.target.files?.[0])} className="mt-0.5 block w-full text-xs" />
            </label>
            {bgMsg && <p className="text-[11px] text-slate-600" role="status" data-testid="background-status">{bgMsg}</p>}
          </section>
        </div>

        <div className="order-1 min-w-0 xl:order-2">
          <div ref={wrapRef} className="overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-1.5" data-testid="canvas-wrap">
            <Canvas
              template={template} selectedId={selectedId} onSelect={setSelectedId} scale={scale}
              onGesture={(l, g) => updateLayer(l, g)} renderUrl={renderUrl} renderState={renderState}
              showBoxes={showBoxes} templateOnly={templateOnly} sampling={sampling}
              onSample={(hex) => {
                setSampling(false);
                colourStore.addRecent(hex);
                const l = current.current.layers.find((x) => x.id === selectedId);
                if (l) updateLayer({ ...l, style: { ...l.style, color: hex } }, null);
              }}
              onNudge={nudge} onDelete={deleteLayer} onDuplicate={dupLayer}
              qr={template.qr} qrSelected={qrSelected} onQrSelect={() => setSelectedId(QR_ID)} onQrChange={changeQr}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span data-testid="preview-status" data-state={renderState} role="status">
              {renderState === 'loading' ? 'Drawing the preview…' : renderState === 'ready' ? 'This is exactly how your PDF will look' : 'Preview failed'}
            </span>
            <span>{pw} x {ph} pt</span>
            <span>Tip: arrow keys nudge the selected text (hold Shift for bigger steps).</span>
          </div>
          {renderError && <p className="mt-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert" data-testid="render-error">{renderError}</p>}
          {fitNotes.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="fit-review" aria-label="Text that had to be fitted">
              {fitNotes.map(({ f, notes }) => (
                <li key={f.layerId} data-testid={`fit-note-${f.layerId}`} className={`rounded-md border px-2.5 py-1 text-xs ${f.fit.overflow ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  <strong>{f.text.length > 40 ? `${f.text.slice(0, 40)}…` : f.text}</strong>: {advanced ? notes.join(', ') : (f.fit.overflow ? 'is too long for its box.' : 'was fitted for you automatically.')}
                  {f.fit.overflow && <button type="button" data-testid={`fix-fit-${f.layerId}`} onClick={() => fixOverflow(f.layerId)} className="ml-2 rounded border border-red-300 bg-white px-2 py-0.5 font-medium text-red-800 hover:bg-red-100">Fix it for me</button>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className={`order-2 overflow-y-auto xl:order-3 ${big ? 'max-h-[calc(100vh-9rem)]' : 'max-h-[85vh]'}   rounded-lg border border-slate-200 bg-white`} aria-label="Text style" data-testid="style-aside">
          {qrSelected && template.qr ? (
            <QrPanel qr={template.qr} page={template.pageSize} advanced={advanced} onChange={(q) => changeQr(q, null)} onRemove={removeQr} />
          ) : <StylePanel
            advanced={advanced} onFindFont={() => setFinderOpen(true)} layer={selected} page={template.pageSize} placeholders={placeholders} onChange={updateLayer}
            previewText={previewText} templateFonts={templateFonts} usedFontIds={usedFontIds} palette={palette}
            sampling={sampling} onSampleTemplate={() => setSampling((s) => !s)} onColourCommit={() => undefined}
          />}
        </aside>
      </div>
    </div>
  );
}

export default CertificateEditor;
