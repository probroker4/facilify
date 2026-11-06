'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { TextLayer } from '@/lib/contracts';
import { identifyFontApi, type IdentifyResult } from './client';
import { Option } from './FontPicker';
import { friendlyText } from './friendly';

interface Props {
  backgroundRef: string;
  layers: TextLayer[];
  selectedId: string | null;
  onApply: (fontId: string, bold: boolean, target: string) => void;
  onClose: () => void;
}

interface Rect { x: number; y: number; w: number; h: number }

const STYLES = [['', 'Any style'], ['serif', 'Serif'], ['sans-serif', 'Sans serif'], ['handwriting', 'Script / handwriting'], ['display', 'Display / decorative'], ['monospace', 'Monospace']] as const;

export function FontFinder({ backgroundRef, layers, selectedId, onApply, onClose }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [text, setText] = useState('');
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState<'popular' | 'more' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [target, setTarget] = useState<string>(selectedId ?? layers[0]?.id ?? 'all');
  const [applied, setApplied] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); abort.current?.abort(); };
  }, []);

  const frac = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = frac(e);
    setRect(null); setResult(null); setError('');
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = frac(e), s = drag.current;
    setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = () => { drag.current = null; };

  const ready = !!rect && rect.w > 0.01 && rect.h > 0.005 && text.trim().length > 0;

  async function find(scope: 'popular' | 'more') {
    if (!rect) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(scope); setError(''); setApplied('');
    try {
      setResult(await identifyFontApi({ ref: backgroundRef, box: rect, text, scope, category: style || undefined }, ctl.signal));
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : 'The font could not be identified.');
    } finally {
      if (abort.current === ctl) setBusy(null);
    }
  }

  const apply = (id: string) => {
    const m = result?.matches.find((x) => x.id === id);
    onApply(id, !!m?.bold, target);
    setApplied(`${m?.family ?? 'The font'} is now used for ${target === 'all' ? 'every text box' : `"${friendlyText(layers.find((l) => l.id === target)?.content ?? '')}"`}.`);
  };
  const preview = text.trim() || 'Sample text';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Find the font in my template" data-testid="font-finder">
      <div className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Find the font in my template</h2>
            <p className="mt-0.5 text-sm text-slate-600">Show Facilify a line of text from your template and it will find the closest fonts. You can then use that font for any text you like.</p>
          </div>
          <button type="button" onClick={onClose} data-testid="font-finder-close" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-800"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-700 text-xs text-white">1</span>Drag a box around one line of text on the template</p>
            <div
              ref={box} data-testid="finder-image" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              className="relative cursor-crosshair select-none overflow-hidden rounded-lg border border-slate-300 bg-slate-100" style={{ touchAction: 'none' }}
            >
              <img src={`/api/editor/background/${encodeURIComponent(backgroundRef)}?scale=1.5`} alt="Your certificate template" draggable={false} className="block w-full" />
              {rect && <div data-testid="finder-rect" className="pointer-events-none absolute border-2 border-indigo-600 bg-indigo-500/15" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
            </div>
            <p className="mt-1 text-xs text-slate-500">Tip: box just one line, with a little space around it. Longer text gives a better match.</p>
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-800"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-700 text-xs text-white">2</span>Type the words you boxed</p>
              <input
                type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} data-testid="finder-text" aria-label="The words inside the box"
                placeholder="For example: Certificate of Achievement" autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
              />
              <label className="mt-2 block text-xs text-slate-600">
                Kind of font (optional, makes it faster)
                <select value={style} onChange={(e) => setStyle(e.target.value)} data-testid="finder-style" className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
                  {STYLES.map(([v, l]) => <option key={v || 'any'} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-800"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-700 text-xs text-white">3</span>Find it</p>
              <button type="button" disabled={!ready || !!busy} onClick={() => find('popular')} data-testid="finder-go"
                className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-40">
                {busy === 'popular' ? 'Comparing fonts…' : 'Find the font'}
              </button>
              {!ready && <p className="mt-1 text-xs text-slate-500">{!rect ? 'Draw a box on the template first.' : 'Now type the words inside the box.'}</p>}
              {busy && <p className="mt-1 text-xs text-slate-600" role="status">Comparing letter shapes. The first search can take up to a minute while fonts are fetched.</p>}
            </div>
            {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="finder-error">{error}</p>}
          </div>
        </div>

        {result && (
          <div className="mt-5 border-t border-slate-200 pt-4" data-testid="finder-results">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Closest fonts</h3>
                <p className="text-xs text-slate-600">Checked {result.searched} of the {result.catalogSize.toLocaleString('en-US')} fonts{result.searched < result.total ? ' (stopped early)' : ''}. A score near 100% is almost identical.</p>
              </div>
              <label className="text-xs text-slate-600">
                Use the font I click for
                <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="finder-target" className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
                  {layers.map((l) => <option key={l.id} value={l.id}>{friendlyText(l.content).slice(0, 48)}</option>)}
                  <option value="all">Every text box</option>
                </select>
              </label>
            </div>
            <div className="mt-2 flex items-center gap-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              <img src={result.seen} alt="The text I compared, cleaned up" className="max-h-12 max-w-[60%] rounded border border-slate-200 bg-white" data-testid="finder-seen" />
              <span>This is what I compared. If it looks wrong, draw the box again, tighter around the text.</span>
            </div>
            {applied && <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status" data-testid="finder-applied">{applied}</p>}
            {result.matches.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600" data-testid="finder-none">No close match found. Try a different kind of font, or search more fonts below.</p>
            ) : (
              <div role="listbox" aria-label="Closest fonts" className="mt-2 grid gap-1 sm:grid-cols-2">
                {result.matches.map((m, i) => (
                  <Option key={m.id} id={m.id} label={`${i === 0 ? 'Best match: ' : ''}${m.family}`} category={m.category} text={preview} selected={false} onPick={apply} testid="finder-match" hint={`${m.score}% similar${m.bold ? ' · bold' : ''}`} />
                ))}
              </div>
            )}
            {result.total < result.catalogSize && (
              <button type="button" disabled={!!busy} onClick={() => find('more')} data-testid="finder-more" className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                {busy === 'more' ? 'Searching more fonts…' : 'Search more fonts (slower)'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
