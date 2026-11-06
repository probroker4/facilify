'use client';

import React, { useEffect, useRef, useState } from 'react';
import { colourStore } from './client';
import { contrastInk, hexToHsl, hexToRgb, hslToHex, normalizeHex, parseColour, rgbToHex } from './logic';

interface Props {
  value: string;
  onChange: (hex: string) => void;
  palette: string[];
  onSampleTemplate: () => void;
  sampling: boolean;
  onCommit?: (hex: string) => void;
}

const BASIC = ['#000000', '#1f2937', '#475569', '#ffffff', '#991b1b', '#c2410c', '#b8860b', '#15803d', '#0f766e', '#1d4ed8', '#4f46e5', '#7e22ce'];

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };

function Swatch({ hex, label, testid, onPick, active }: { hex: string; label: string; testid: string; onPick: (h: string) => void; active: boolean }) {
  return (
    <button
      type="button" title={`${label} ${hex}`} aria-label={`${label} ${hex}`} data-testid={testid} data-hex={hex}
      onClick={() => onPick(hex)}
      className={`h-6 w-6 rounded-md border ${active ? 'ring-2 ring-indigo-500 ring-offset-1' : 'border-slate-300'}`}
      style={{ backgroundColor: hex }}
    />
  );
}

function Row({ title, hexes, kind, value, onPick }: { title: string; hexes: string[]; kind: string; value: string; onPick: (h: string) => void }) {
  if (!hexes.length) return null;
  return (
    <div data-testid={`${kind}-row`}>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {hexes.map((h) => <Swatch key={h} hex={h} label={title} testid={`${kind}-swatch`} onPick={onPick} active={h === value} />)}
      </div>
    </div>
  );
}

function Num({ label, testid, value, min, max, onCommit }: { label: string; testid: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="flex flex-col items-center gap-0.5 text-[11px] text-slate-500">
      {label}
      <input
        type="number" inputMode="numeric" aria-label={label} data-testid={testid} value={draft} min={min} max={max}
        onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onCommit(n); }}
        onBlur={() => setDraft(String(value))}
        className="w-full rounded border border-slate-300 px-1 py-1 text-center text-xs text-slate-900"
      />
    </label>
  );
}

export function ColourPicker({ value, onChange, palette, onSampleTemplate, sampling, onCommit }: Props) {
  const hex = normalizeHex(value) ?? '#000000';
  const rgb = hexToRgb(hex);
  const hsl = hexToHsl(hex);
  const [text, setText] = useState(hex);
  const [textBad, setTextBad] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [hasNative, setHasNative] = useState(false);
  const [note, setNote] = useState('');

  const typed = useRef(false);
  useEffect(() => {
    if (typed.current) { typed.current = false; return; }
    setText(hex); setTextBad(false);
  }, [hex]);
  useEffect(() => {
    setRecent(colourStore.recent());
    setSaved(colourStore.saved());
    setHasNative(typeof window !== 'undefined' && 'EyeDropper' in window);
  }, []);

  const apply = (next: string) => { const n = normalizeHex(next); if (n) onChange(n); };
  const settle = (next: string) => {
    const n = normalizeHex(next);
    if (!n) return;
    onChange(n);
    setRecent(colourStore.addRecent(n));
    onCommit?.(n);
  };

  async function pickFromScreen() {
    setNote('');
    try {
      const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
      if (!Ctor) return;
      const r = await new Ctor().open();
      settle(r.sRGBHex);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setNote('The screen colour picker could not be used. Use "Pick from template" instead.');
    }
  }

  const isSaved = saved.includes(hex);
  return (
    <div className="space-y-3" data-testid="colour-picker">
      <div className="flex items-center gap-2">
        <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-slate-300" style={{ backgroundColor: hex }} title="Open the colour chooser">
          <input
            type="color" aria-label="Colour chooser" data-testid="color-native" value={hex}
            onChange={(e) => apply(e.target.value)} onBlur={(e) => settle(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <label className="flex-1 text-[11px] text-slate-500">
          Hex
          <input
            type="text" aria-label="Hex colour" data-testid="color-hex" value={text} spellCheck={false} maxLength={22}
            onChange={(e) => {
              setText(e.target.value);
              const v = e.target.value.trim();
              setTextBad(!parseColour(v) && v !== '' && !/^#?[0-9a-f]{0,5}$/i.test(v) && !/^(rgb|hsl)a?\(?[\d\s,.%]*\)?$/i.test(v));
              if (/^#?[0-9a-f]{6}$/i.test(v)) { typed.current = normalizeHex(v) !== hex; apply(v); }
            }}
            onBlur={() => { const c = parseColour(text); if (c) { typed.current = false; settle(c); setText(c); } else { setText(hex); setTextBad(false); } }}
            onKeyDown={(e) => { if (e.key === 'Enter') { const c = parseColour(text); if (c) { typed.current = false; settle(c); setText(c); } } }}
            aria-invalid={textBad}
            className={`mt-0.5 w-full rounded border px-2 py-1.5 font-mono text-sm text-slate-900 ${textBad ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
          />
        </label>
        <button
          type="button" aria-label={isSaved ? 'Remove from saved colours' : 'Save this colour'} aria-pressed={isSaved} data-testid="color-save"
          title={isSaved ? 'Remove from saved colours' : 'Save this colour for later'}
          onClick={() => setSaved(colourStore.toggleSaved(hex))}
          className={`mt-4 rounded-md border px-2 py-1.5 text-sm ${isSaved ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}
        >
          {isSaved ? '★' : '☆'}
        </button>
      </div>
      {textBad && <p className="text-[11px] text-red-600" role="alert">Use a hex like #1f3a5f, or rgb(31, 58, 95), or hsl(214, 51%, 25%).</p>}

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="RGB">
        <Num label="R" testid="color-r" value={rgb.r} min={0} max={255} onCommit={(r) => settle(rgbToHex(r, rgb.g, rgb.b))} />
        <Num label="G" testid="color-g" value={rgb.g} min={0} max={255} onCommit={(g) => settle(rgbToHex(rgb.r, g, rgb.b))} />
        <Num label="B" testid="color-b" value={rgb.b} min={0} max={255} onCommit={(b) => settle(rgbToHex(rgb.r, rgb.g, b))} />
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="HSL">
        <Num label="H" testid="color-h" value={hsl.h} min={0} max={359} onCommit={(h) => settle(hslToHex(h, hsl.s, hsl.l))} />
        <Num label="S %" testid="color-s" value={hsl.s} min={0} max={100} onCommit={(s) => settle(hslToHex(hsl.h, s, hsl.l))} />
        <Num label="L %" testid="color-l" value={hsl.l} min={0} max={100} onCommit={(l) => settle(hslToHex(hsl.h, hsl.s, l))} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button" data-testid="eyedropper-template" aria-pressed={sampling} onClick={onSampleTemplate}
          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${sampling ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          {sampling ? 'Click the template…' : 'Pick from template'}
        </button>
        {hasNative && (
          <button type="button" data-testid="eyedropper-screen" onClick={pickFromScreen} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Pick from screen
          </button>
        )}
      </div>
      {note && <p className="text-[11px] text-amber-700" role="status">{note}</p>}

      <Row title="Colours in this template" kind="palette" hexes={palette} value={hex} onPick={settle} />
      <Row title="Saved colours" kind="saved" hexes={saved} value={hex} onPick={settle} />
      <Row title="Recent colours" kind="recent" hexes={recent} value={hex} onPick={settle} />
      <Row title="Basic colours" kind="basic" hexes={BASIC} value={hex} onPick={settle} />
      <div className="sr-only" aria-live="polite" data-testid="color-current" data-hex={hex} style={{ color: contrastInk(hex) }}>{hex}</div>
    </div>
  );
}
