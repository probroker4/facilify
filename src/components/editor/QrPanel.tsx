'use client';

import React from 'react';
import type { CertTemplate } from '@/lib/contracts';
import { NumField, Section } from './Fields';
import { round1 } from './logic';

type Qr = NonNullable<CertTemplate['qr']>;

export function QrPanel({ qr, page, advanced, onChange, onRemove }: { qr: Qr; page: [number, number]; advanced: boolean; onChange: (qr: Qr) => void; onRemove: () => void }) {
  const clamp = (q: Qr): Qr => ({ size: q.size, x: Math.min(page[0] - q.size, Math.max(0, q.x)), y: Math.min(page[1] - q.size, Math.max(0, q.y)) });
  return (
    <div data-testid="qr-panel">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">QR code</div>
      <Section title="What it does" testid="section-qr-info">
        <p className="text-xs text-slate-600">Every certificate gets its own QR code. Scanning it opens a live page that shows the certificate is real, who earned it, when it was issued, and an <strong>Add to LinkedIn</strong> button.</p>
        <p className="text-[11px] text-slate-500">Drag the square on the certificate to move it, or drag its corner to resize. Leave a clear margin around it so phones can read it.</p>
      </Section>
      <Section title="Size and position" testid="section-qr-size">
        <div className="flex items-end gap-2">
          <button type="button" data-testid="qr-smaller" onClick={() => onChange(clamp({ ...qr, size: Math.max(40, round1(qr.size - 10)) }))} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50">Smaller</button>
          <button type="button" data-testid="qr-bigger" onClick={() => onChange(clamp({ ...qr, size: Math.min(Math.min(page[0], page[1]) - 10, round1(qr.size + 10)) }))} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50">Bigger</button>
        </div>
        {advanced && (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Size" unit="pt" testid="qr-size-input" value={qr.size} min={40} max={400} step={1} onCommit={(size) => onChange(clamp({ ...qr, size }))} />
            <NumField label="Left" unit="pt" testid="qr-x-input" value={qr.x} min={0} max={5000} step={0.5} onCommit={(x) => onChange(clamp({ ...qr, x }))} />
            <NumField label="Top" unit="pt" testid="qr-y-input" value={qr.y} min={0} max={5000} step={0.5} onCommit={(y) => onChange(clamp({ ...qr, y }))} />
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-testid="qr-center-h" onClick={() => onChange(clamp({ ...qr, x: round1((page[0] - qr.size) / 2) }))} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50">Centre left-to-right</button>
          <button type="button" data-testid="qr-corner" onClick={() => onChange(clamp({ ...qr, x: page[0] - qr.size - 50, y: page[1] - qr.size - 45 }))} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50">Bottom-right corner</button>
        </div>
      </Section>
      <div className="p-3">
        <button type="button" data-testid="qr-remove" onClick={onRemove} className="w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Remove the QR code</button>
        <p className="mt-1 text-[11px] text-slate-500">The QR code is optional. Without it, certificates are made without one.</p>
      </div>
    </div>
  );
}
