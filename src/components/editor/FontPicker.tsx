'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ensureFontCss, fontStore, searchFontsApi, uploadFontApi, type CatalogFontLite, type TemplateFontSuggestion } from './client';
import { cssFamilyFor } from './logic';

interface Props {
  fontId: string;
  onPick: (fontId: string) => void;
  previewText: string;
  templateFonts: TemplateFontSuggestion[];
  usedFontIds: string[];
  onFindFont?: () => void;
}

const CATEGORIES = [['', 'All'], ['serif', 'Serif'], ['sans-serif', 'Sans'], ['display', 'Display'], ['handwriting', 'Script'], ['monospace', 'Mono']] as const;
const FALLBACK: Record<string, string> = { serif: 'serif', 'sans-serif': 'sans-serif', display: 'sans-serif', handwriting: 'cursive', monospace: 'monospace' };

export function Option({ id, label, category, selected, text, onPick, testid, hint }: { id: string; label: string; category?: string; selected: boolean; text: string; onPick: (id: string) => void; testid: string; hint?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setFamily(ensureFontCss(id)); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setFamily(ensureFontCss(id)); io.disconnect(); }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [id]);
  return (
    <button
      ref={ref} type="button" role="option" aria-selected={selected} aria-label={`Use font ${label}`} data-testid={testid} data-font-id={id}
      data-font-loaded={family ? '1' : '0'} title={hint}
      onClick={() => onPick(id)}
      className={`block w-full rounded-md border px-2.5 py-1.5 text-left ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-transparent hover:bg-slate-50'}`}
    >
      <span className="flex items-baseline justify-between gap-2 text-[11px] text-slate-500">
        <span className="truncate">{label}</span>
        {hint && <span className="shrink-0 text-indigo-600">{hint}</span>}
      </span>
      <span className="block truncate text-[22px] leading-tight text-slate-900" data-testid="font-preview" style={{ fontFamily: `"${family ?? cssFamilyFor(id)}", ${FALLBACK[category ?? 'serif'] ?? 'serif'}` }}>
        {text}
      </span>
    </button>
  );
}

export function FontPicker({ fontId, onPick, previewText, templateFonts, usedFontIds, onFindFont }: Props) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<CatalogFontLite[]>([]);
  const [total, setTotal] = useState(0);
  const [fuzzy, setFuzzy] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [mine, setMine] = useState<{ fontId: string; family: string }[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMine(fontStore.mine()), []);

  useEffect(() => {
    const ctl = new AbortController();
    setState('loading');
    const t = setTimeout(() => {
      searchFontsApi({ q: q.trim(), category, limit: 40 }, ctl.signal)
        .then((r) => { setResults(r.fonts); setTotal(r.total); setFuzzy(!!r.fuzzy); setState('ready'); setError(''); })
        .catch((e) => { if (ctl.signal.aborted) return; setState('error'); setError(e instanceof Error ? e.message : 'The font list could not be loaded.'); });
    }, q ? 160 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, category]);

  const unknown = [fontId, ...usedFontIds].filter((id) => id && !id.startsWith('upload:') && !labels[id]);
  const unknownKey = [...new Set(unknown)].join(',');
  useEffect(() => {
    if (!unknownKey) return;
    searchFontsApi({ ids: unknownKey.split(','), limit: 50 }).then((r) => {
      setLabels((cur) => ({ ...cur, ...Object.fromEntries(r.fonts.map((f) => [f.id, f.family])) }));
    }).catch(() => {  });
  }, [unknownKey]);

  const nameOf = (id: string): string => {
    if (id.startsWith('upload:')) return mine.find((m) => m.fontId === id)?.family ?? 'Uploaded font';
    return labels[id] ?? results.find((f) => f.id === id)?.family ?? id.replace(/-/g, ' ');
  };

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploadMsg('Uploading…');
    try {
      const f = await uploadFontApi(file);
      fontStore.add(f);
      setMine(fontStore.mine());
      setUploadMsg(`Added ${f.family}.`);
      onPick(f.fontId);
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : 'The font could not be uploaded.');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const matched = templateFonts.filter((s) => s.match);
  const usedUploads = usedFontIds.filter((id) => id.startsWith('upload:') && !mine.some((m) => m.fontId === id));

  return (
    <div className="space-y-2" data-testid="font-picker">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-500">Current font</span>
        <span className="truncate font-medium text-slate-900" data-testid="font-current" data-font-id={fontId}>{nameOf(fontId)}</span>
      </div>

      {onFindFont && (
        <button type="button" onClick={onFindFont} data-testid="find-font" className="flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100">
          Find the font in my template
        </button>
      )}
      <input
        type="search" aria-label="Search fonts" data-testid="font-search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={total ? `Search ${total.toLocaleString('en-US')} Google Fonts…` : 'Search Google Fonts…'} autoComplete="off" spellCheck={false}
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Font style filter">
        {CATEGORIES.map(([id, label]) => (
          <button
            key={id || 'all'} type="button" aria-pressed={category === id} data-testid={`font-category-${id || 'all'}`} onClick={() => setCategory(id)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${category === id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >{label}</button>
        ))}
      </div>

      {matched.length > 0 && (
        <div data-testid="template-fonts">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Fonts in this template</div>
          <div role="listbox" aria-label="Fonts in this template" className="space-y-0.5">
            {matched.map((s) => (
              <Option
                key={`${s.pdfName}`} id={s.match!.id} label={s.match!.family} category={s.match!.category} text={previewText}
                selected={fontId === s.match!.id} onPick={onPick} testid="template-font-option"
                hint={`${s.pdfName.replace(/^[A-Z]{6}\+/, '')}${s.bold ? ' · bold' : ''}${s.italic ? ' · italic' : ''}`}
              />
            ))}
          </div>
        </div>
      )}

      {(mine.length > 0 || usedUploads.length > 0) && (
        <div data-testid="my-fonts">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Your uploaded fonts</div>
          <div role="listbox" aria-label="Your uploaded fonts" className="space-y-0.5">
            {[...mine.map((m) => ({ id: m.fontId, label: m.family })), ...usedUploads.map((id) => ({ id, label: 'Uploaded font' }))].map((m) => (
              <Option key={m.id} id={m.id} label={m.label} text={previewText} selected={fontId === m.id} onPick={onPick} testid="my-font-option" />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <span>{q.trim() ? 'Matching fonts' : 'Popular for certificates'}</span>
          <span data-testid="font-result-count" data-count={results.length} data-state={state} className="normal-case tracking-normal">{state === 'loading' ? 'Searching…' : `${results.length} shown`}</span>
        </div>
        {fuzzy && <p className="mb-1 text-[11px] text-slate-500" data-testid="font-fuzzy">No exact match, showing the closest names.</p>}
        {state === 'error' && <p className="text-xs text-red-600" role="alert">{error}</p>}
        {state === 'ready' && results.length === 0 && <p className="text-xs text-slate-500" data-testid="font-empty">No font matches &ldquo;{q}&rdquo;. Try fewer letters.</p>}
        <div role="listbox" aria-label="Font search results" data-testid="font-results" className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
          {results.map((f) => (
            <Option key={f.id} id={f.id} label={f.family} category={f.category} text={previewText} selected={fontId === f.id} onPick={onPick} testid={`font-option-${f.id}`} />
          ))}
        </div>
      </div>

      <div>
        <input ref={fileRef} type="file" accept=".ttf,.otf,font/ttf,font/otf" aria-label="Upload your own font file" data-testid="font-upload" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" data-testid="font-upload-button" onClick={() => fileRef.current?.click()} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Upload your own font (.ttf / .otf)
        </button>
        {uploadMsg && <p className="mt-1 text-[11px] text-slate-600" role="status" data-testid="font-upload-status">{uploadMsg}</p>}
      </div>
    </div>
  );
}
