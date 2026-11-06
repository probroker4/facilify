'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import type { TextLayer, TextStyle } from '@/lib/contracts';
import type { TemplateFontSuggestion } from './client';
import { ColourPicker } from './ColourPicker';
import { NumField, Section, ToggleButton } from './Fields';
import { FontPicker } from './FontPicker';
import { friendlyField } from './friendly';
import { insertAtCaret, round1 } from './logic';

interface Props {
  layer: TextLayer | null;
  page: [number, number];
  placeholders: string[];
  onChange: (layer: TextLayer, key: string) => void;
  previewText: string;
  templateFonts: TemplateFontSuggestion[];
  usedFontIds: string[];
  palette: string[];
  sampling: boolean;
  onSampleTemplate: () => void;
  onColourCommit: (hex: string) => void;
  advanced: boolean;
  onFindFont?: () => void;
}

export function StylePanel({ layer, page, placeholders, onChange, previewText, templateFonts, usedFontIds, palette, sampling, onSampleTemplate, onColourCommit, advanced, onFindFont }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState<1 | 10>(1);
  const all = advanced;
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !area.current) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    area.current.focus();
    area.current.setSelectionRange(at, at);
  });

  if (!layer) {
    return (
      <div className="p-4 text-sm text-slate-500" data-testid="style-empty">
        <p className="font-semibold text-slate-700">Nothing selected</p>
        <p className="mt-1">Click any text on the certificate to change it, or press <strong>Add text</strong> to put new words on it.</p>
      </div>
    );
  }

  const st = layer.style;
  const setStyle = (patch: Partial<TextStyle>, field: string) => onChange({ ...layer, style: { ...st, ...patch } }, `style:${layer.id}:${field}`);
  const setFit = (patch: Partial<TextStyle['fit']>, field: string) => setStyle({ fit: { ...st.fit, ...patch } }, field);
  const setBox = (patch: Partial<TextLayer>, field: string) => onChange({ ...layer, ...patch }, `box:${layer.id}:${field}`);

  function addPlaceholder(name: string) {
    const el = area.current;
    const token = `{{${name}}}`;
    const r = insertAtCaret(layer!.content, el?.selectionStart ?? layer!.content.length, el?.selectionEnd ?? layer!.content.length, token);
    pendingCaret.current = r.caret;
    onChange({ ...layer!, content: r.text }, `chip:${layer!.id}:${Date.now()}`);
  }

  return (
    <div data-testid="style-panel" data-layer-id={layer.id}>
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">Change this text</div>
      <Section title="Words" testid="section-text">
        <label className="block text-[11px] text-slate-500">
          What this box says
          <textarea
            ref={area} aria-label="Text content" data-testid="content-input" value={layer.content} rows={3}
            onChange={(e) => onChange({ ...layer, content: e.target.value }, `content:${layer.id}`)}
            className="mt-0.5 w-full resize-y rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
          />
        </label>
        <div>
          <div className="mb-1 text-[11px] text-slate-500">Click to add a detail from your sheet. Each certificate shows that student's own detail.</div>
          <div className="flex flex-wrap gap-1" data-testid="placeholder-chips">
            {placeholders.map((p) => (
              <button
                key={p} type="button" aria-label={`Insert ${p} field`} data-testid={`placeholder-chip-${p}`} onClick={() => addPlaceholder(p)}
                title={`Adds {{${p}}}`}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-800 hover:bg-indigo-100"
              >+ {friendlyField(p)}</button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Font" testid="section-font">
        <FontPicker fontId={st.fontId} onPick={(fontId) => setStyle({ fontId }, 'fontId')} previewText={previewText} templateFonts={templateFonts} usedFontIds={usedFontIds} onFindFont={onFindFont} />
      </Section>

       <Section title="Size and style" testid="section-style">
        <div className="flex items-end gap-2">
          <button type="button" aria-label="Make text smaller" data-testid="size-down" onClick={() => { const size = Math.max(1, round1(st.size - (st.size > 40 ? 4 : 2))); setStyle({ size, minSize: Math.min(st.minSize, size) }, 'size'); }} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50">A&minus; Smaller</button>
          <button type="button" aria-label="Make text bigger" data-testid="size-up" onClick={() => { const size = Math.min(400, round1(st.size + (st.size > 40 ? 4 : 2))); setStyle({ size }, 'size'); }} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50">A+ Bigger</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Font size" unit="pt" testid="size-input" value={st.size} min={1} max={400} step={0.5} onCommit={(size) => setStyle({ size, minSize: Math.min(st.minSize, size) }, 'size')} />
          {all && <NumField label="Smallest size" unit="pt" testid="min-size-input" value={st.minSize} min={1} max={st.size} step={0.5} onCommit={(minSize) => setStyle({ minSize }, 'minSize')} />}
        </div>
        {!all && <p className="text-[11px] text-slate-500">Long names shrink on their own to fit the box. Make the box wider if a name still looks cramped.</p>}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Text style">
          <ToggleButton label="Bold" testid="bold-toggle" pressed={st.bold} onToggle={() => setStyle({ bold: !st.bold }, 'bold')}><b>B</b></ToggleButton>
          <ToggleButton label="Italic" testid="italic-toggle" pressed={st.italic} onToggle={() => setStyle({ italic: !st.italic }, 'italic')}><i>I</i></ToggleButton>
          <ToggleButton label="Underline" testid="underline-toggle" pressed={st.underline} onToggle={() => setStyle({ underline: !st.underline }, 'underline')}><u>U</u></ToggleButton>
          <ToggleButton label="UPPERCASE" testid="uppercase-toggle" pressed={st.uppercase} onToggle={() => setStyle({ uppercase: !st.uppercase }, 'uppercase')}>AA</ToggleButton>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Alignment">
          {(['left', 'center', 'right'] as const).map((a) => (
            <ToggleButton key={a} label={`Align ${a}`} testid={`align-${a}`} pressed={st.align === a} onToggle={() => setStyle({ align: a }, 'align')}>{a[0].toUpperCase() + a.slice(1)}</ToggleButton>
          ))}
        </div>
      </Section>

      {all && <Section title="Spacing" testid="section-spacing">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Letter spacing" unit="pt" testid="letter-spacing-input" value={st.letterSpacing} min={-10} max={50} step={0.1} onCommit={(letterSpacing) => setStyle({ letterSpacing }, 'letterSpacing')} />
          <NumField label="Line height" testid="line-height-input" value={st.lineHeight} min={0.8} max={4} step={0.05} onCommit={(lineHeight) => setStyle({ lineHeight }, 'lineHeight')} />
          <NumField label="Opacity" unit="%" testid="opacity-input" value={Math.round(st.opacity * 100)} min={0} max={100} onCommit={(p) => setStyle({ opacity: p / 100 }, 'opacity')} />
          <NumField label="Rotation" unit="deg" testid="rotation-input" value={st.rotation} min={-180} max={180} step={1} onCommit={(rotation) => setStyle({ rotation }, 'rotation')} />
          <NumField label="Max lines" testid="max-lines-input" value={st.maxLines} min={1} max={10} onCommit={(maxLines) => setStyle({ maxLines: Math.round(maxLines) }, 'maxLines')} />
        </div>
      </Section>}

      <Section title="Colour" testid="section-colour">
        <ColourPicker value={st.color} onChange={(color) => setStyle({ color }, 'color')} palette={palette} sampling={sampling} onSampleTemplate={onSampleTemplate} onCommit={onColourCommit} />
      </Section>

      {all && <Section title="Long names (auto-fit)" testid="section-fit" defaultOpen={false}>
        <label className="block text-[11px] text-slate-500">
          When a name does not fit
          <select
            aria-label="Fit mode" data-testid="fit-mode" value={st.fit.mode} onChange={(e) => setFit({ mode: e.target.value as TextStyle['fit']['mode'] }, 'fitMode')}
            className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="shrink-then-wrap">Shrink, then use two lines</option>
            <option value="shrink">Only shrink</option>
            <option value="wrap">Prefer two lines</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" aria-label="Shorten middle names to initials" data-testid="fit-abbreviate" checked={st.fit.allowAbbreviate} onChange={(e) => setFit({ allowAbbreviate: e.target.checked }, 'abbr')} />
          Shorten middle names to initials as a last resort
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" aria-label="Use one size for every certificate" data-testid="fit-uniform" checked={st.fit.uniformAcrossBatch} onChange={(e) => setFit({ uniformAcrossBatch: e.target.checked }, 'uniform')} />
          Use the same size on every certificate (fits the longest name)
        </label>
        <NumField label="Tightest letter spacing" unit="pt" testid="fit-min-spacing" value={st.fit.minLetterSpacing} min={-10} max={50} step={0.1} onCommit={(minLetterSpacing) => setFit({ minLetterSpacing }, 'minLs')} />
      </Section>}

      <Section title="Position" testid="section-position">
        {!all && <p className="text-[11px] text-slate-500">Drag the box on the certificate to move it. Drag its corners to make it bigger.</p>}
        {all && <div className="grid grid-cols-2 gap-2">
          <NumField label="Left" unit="pt" testid="x-input" value={layer.x} min={-2000} max={5000} step={0.5} onCommit={(x) => setBox({ x }, 'x')} />
          <NumField label="Top" unit="pt" testid="y-input" value={layer.y} min={-2000} max={5000} step={0.5} onCommit={(y) => setBox({ y }, 'y')} />
          <NumField label="Width" unit="pt" testid="w-input" value={layer.width} min={10} max={5000} step={0.5} onCommit={(width) => setBox({ width }, 'w')} />
          <NumField label="Height" unit="pt" testid="h-input" value={layer.height} min={5} max={5000} step={0.5} onCommit={(height) => setBox({ height }, 'h')} />
        </div>}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-testid="center-h" onClick={() => setBox({ x: round1((page[0] - layer.width) / 2) }, 'cx')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50">Centre left-to-right</button>
          <button type="button" data-testid="center-v" onClick={() => setBox({ y: round1((page[1] - layer.height) / 2) }, 'cy')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50">Centre top-to-bottom</button>
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Nudge">
          {([['left', '←', -step, 0], ['up', '↑', 0, -step], ['down', '↓', 0, step], ['right', '→', step, 0]] as const).map(([name, glyph, dx, dy]) => (
            <button key={name} type="button" aria-label={`Nudge ${name}`} data-testid={`nudge-${name}`} onClick={() => onChange({ ...layer, x: round1(layer.x + dx), y: round1(layer.y + dy) }, `nudge:${layer.id}:${name}`)} className="h-8 w-8 rounded-md border border-slate-300 text-sm hover:bg-slate-50">{glyph}</button>
          ))}
          <ToggleButton label="Nudge by 10 points" testid="nudge-step" pressed={step === 10} onToggle={() => setStep(step === 10 ? 1 : 10)}>{step} pt</ToggleButton>
        </div>
      </Section>
    </div>
  );
}
