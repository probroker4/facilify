'use client';

import React, { useEffect, useState } from 'react';

export function Section({ title, children, testid, defaultOpen = true }: { title: string; children: React.ReactNode; testid: string; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} data-testid={testid} className="group border-b border-slate-200 px-3 py-2">
      <summary className="cursor-pointer select-none py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</summary>
      <div className="space-y-2.5 pb-2 pt-1.5">{children}</div>
    </details>
  );
}

interface NumProps {
  label: string; testid: string; value: number; min: number; max: number; step?: number; unit?: string;
  onCommit: (n: number) => void;
}

export function NumField({ label, testid, value, min, max, step = 1, unit, onCommit }: NumProps) {
  const [draft, setDraft] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setDraft(String(Math.round(value * 100) / 100)); setBad(false); }, [value]);
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
      <span>{label}{unit ? ` (${unit})` : ''}</span>
      <input
        type="number" inputMode="decimal" aria-label={label} data-testid={testid} value={draft} min={min} max={max} step={step}
        aria-invalid={bad}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          const ok = e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max;
          setBad(!ok);
          if (ok) onCommit(n);
        }}
        onBlur={() => { setDraft(String(Math.round(value * 100) / 100)); setBad(false); }}
        className={`w-full rounded border px-2 py-1.5 text-sm text-slate-900 ${bad ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
      />
    </label>
  );
}

export function ToggleButton({ label, testid, pressed, onToggle, children, title }: { label: string; testid: string; pressed: boolean; onToggle: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button" aria-label={label} aria-pressed={pressed} data-testid={testid} title={title ?? label} onClick={onToggle}
      className={`min-w-9 rounded-md border px-2.5 py-1.5 text-sm ${pressed ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
    >{children}</button>
  );
}
