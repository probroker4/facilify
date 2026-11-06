'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CertTemplate, TextLayer } from '@/lib/contracts';
import { loadSampler, type Sampler } from './client';
import { backgroundRefOf, contrastInk, HANDLES, resizeBox, snapToGuides, type Handle } from './logic';

interface Props {
  template: CertTemplate;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onGesture: (layer: TextLayer, gesture: string) => void;
  renderUrl: string | null;
  renderState: 'loading' | 'ready' | 'error';
  scale: number;
  showBoxes: boolean;
  templateOnly: boolean;
  sampling: boolean;
  onSample: (hex: string) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  qr?: CertTemplate['qr'];
  qrSelected?: boolean;
  onQrSelect?: () => void;
  onQrChange?: (qr: NonNullable<CertTemplate['qr']>, gesture: string) => void;
}

const HANDLE_POS: Record<Handle, React.CSSProperties> = {
  nw: { left: -7, top: -7, cursor: 'nwse-resize' }, n: { left: 'calc(50% - 7px)', top: -7, cursor: 'ns-resize' }, ne: { right: -7, top: -7, cursor: 'nesw-resize' },
  e: { right: -7, top: 'calc(50% - 7px)', cursor: 'ew-resize' }, se: { right: -7, bottom: -7, cursor: 'nwse-resize' }, s: { left: 'calc(50% - 7px)', bottom: -7, cursor: 'ns-resize' },
  sw: { left: -7, bottom: -7, cursor: 'nesw-resize' }, w: { left: -7, top: 'calc(50% - 7px)', cursor: 'ew-resize' },
};

interface Drag { mode: 'move' | Handle; id: string; startX: number; startY: number; orig: TextLayer; gesture: string }

export function Canvas(p: Props) {
  const { template, scale } = p;
  const [pw, ph] = template.pageSize;
  const ref = backgroundRefOf(template);
  const drag = useRef<Drag | null>(null);
  const gestureCount = useRef(0);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [hover, setHover] = useState<{ hex: string; x: number; y: number } | null>(null);
  const [sampler, setSampler] = useState<Sampler | null>(null);
  const [samplerError, setSamplerError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const qrDrag = useRef<{ mode: 'move' | 'size'; startX: number; startY: number; orig: NonNullable<CertTemplate['qr']>; gesture: string } | null>(null);

  function qrStart(e: React.PointerEvent<HTMLElement>, mode: 'move' | 'size') {
    if (e.button !== 0 || !p.qr) return;
    e.stopPropagation();
    p.onQrSelect?.();
    e.currentTarget.setPointerCapture(e.pointerId);
    qrDrag.current = { mode, startX: e.clientX, startY: e.clientY, orig: p.qr, gesture: `q${++gestureCount.current}` };
  }
  function qrMove(e: React.PointerEvent<HTMLElement>) {
    const d = qrDrag.current;
    if (!d || !p.onQrChange) return;
    const dx = (e.clientX - d.startX) / scale, dy = (e.clientY - d.startY) / scale;
    if (d.mode === 'move') {
      const x = Math.min(pw - d.orig.size, Math.max(0, d.orig.x + dx)), y = Math.min(ph - d.orig.size, Math.max(0, d.orig.y + dy));
      p.onQrChange({ ...d.orig, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, d.gesture);
    } else {
      const size = Math.min(Math.min(pw, ph) - 10, Math.max(40, d.orig.size + Math.max(dx, dy)));
      const x = Math.min(pw - size, d.orig.x), y = Math.min(ph - size, d.orig.y);
      p.onQrChange({ x, y, size: Math.round(size * 10) / 10 }, d.gesture);
    }
  }
  function qrEnd(e: React.PointerEvent<HTMLElement>) {
    if (!qrDrag.current) return;
    qrDrag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  useEffect(() => {
    if (!p.sampling) { setHover(null); return; }
    let live = true;
    setSamplerError('');
    loadSampler(ref).then((s) => { if (live) setSampler(s); }).catch((e) => { if (live) setSamplerError(e instanceof Error ? e.message : 'Could not read the template.'); });
    return () => { live = false; };
  }, [p.sampling, ref]);

  function start(e: React.PointerEvent<HTMLElement>, layer: TextLayer, mode: Drag['mode']) {
    if (e.button !== 0) return;
    e.stopPropagation();
    p.onSelect(layer.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, id: layer.id, startX: e.clientX, startY: e.clientY, orig: layer, gesture: `g${++gestureCount.current}` };
  }

  function move(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale, dy = (e.clientY - d.startY) / scale;
    if (d.mode === 'move') {
      const others = template.layers.filter((l) => l.id !== d.id);
      const x = d.orig.x + dx, y = d.orig.y + dy;
      const s = e.altKey ? { x, y, guideX: null, guideY: null } : snapToGuides(d.orig, x, y, template.pageSize, others, 6 / scale);
      setGuides({ x: s.guideX, y: s.guideY });
      p.onGesture({ ...d.orig, x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 }, d.gesture);
    } else {
      p.onGesture({ ...d.orig, ...resizeBox(d.orig, d.mode, dx, dy, d.orig.style.rotation) }, d.gesture);
    }
  }

  function end(e: React.PointerEvent<HTMLElement>) {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: null, y: null });
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function key(e: React.KeyboardEvent<HTMLElement>, layer: TextLayer) {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); p.onNudge(layer.id, ...moves[e.key]); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); p.onDelete(layer.id); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); p.onDuplicate(layer.id); }
  }

  function sampleAt(e: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>): string | null {
    const el = box.current;
    if (!el || !sampler) return null;
    const r = el.getBoundingClientRect();
    return sampler.hexAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  const bg = `/api/editor/background/${encodeURIComponent(ref)}?scale=1.5`;
  return (
    <div
      ref={box} data-testid="canvas" data-scale={scale} data-page-w={pw} data-page-h={ph}
      className="relative select-none bg-white shadow-lg ring-1 ring-slate-300"
      style={{ width: pw * scale, height: ph * scale, touchAction: 'none' }}
      onPointerDown={() => p.onSelect(null)}
    >
      <img data-testid="canvas-background" src={bg} alt="Your certificate template, untouched" draggable={false} className="absolute inset-0 h-full w-full" />
      {!p.templateOnly && p.renderUrl && (
        <img data-testid="canvas-render" src={p.renderUrl} alt="Certificate preview drawn by the same engine that makes the PDFs" draggable={false} className="absolute inset-0 h-full w-full" />
      )}

      {p.showBoxes && template.layers.map((l) => {
        const sel = l.id === p.selectedId;
        return (
          <div
            key={l.id} role="button" tabIndex={0} aria-label={`Text box: ${l.content.slice(0, 40) || 'empty'}`} aria-pressed={sel}
            data-testid={`layer-box-${l.id}`} data-layer-id={l.id} data-selected={sel ? '1' : '0'}
            data-x={l.x} data-y={l.y} data-w={l.width} data-h={l.height}
            onPointerDown={(e) => start(e, l, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onFocus={() => p.onSelect(l.id)} onKeyDown={(e) => key(e, l)}
            className="absolute outline-none"
            style={{
              left: l.x * scale, top: l.y * scale, width: l.width * scale, height: l.height * scale,
              transform: l.style.rotation ? `rotate(${l.style.rotation}deg)` : undefined, transformOrigin: 'center',
              border: sel ? '2px solid #4f46e5' : '1px dashed rgba(79,70,229,0.55)', cursor: p.sampling ? 'crosshair' : 'move',
              boxShadow: sel ? '0 0 0 3px rgba(79,70,229,0.18)' : undefined,
            }}
          >
            {sel && HANDLES.map((h) => (
              <span
                key={h} role="presentation" data-testid={`handle-${h}`}
                onPointerDown={(e) => start(e, l, h)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                className="absolute h-3.5 w-3.5 rounded-sm border-2 border-indigo-600 bg-white shadow" style={HANDLE_POS[h]}
              />
            ))}
          </div>
        );
      })}

      {p.showBoxes && p.qr && (
        <div
          role="button" tabIndex={0} aria-label="QR code that opens the verification page" aria-pressed={!!p.qrSelected} data-testid="qr-box" data-selected={p.qrSelected ? '1' : '0'}
          data-x={p.qr.x} data-y={p.qr.y} data-size={p.qr.size}
          onPointerDown={(e) => qrStart(e, 'move')} onPointerMove={qrMove} onPointerUp={qrEnd} onPointerCancel={qrEnd}
          onFocus={() => p.onQrSelect?.()}
          className="absolute outline-none"
          style={{
            left: p.qr.x * scale, top: p.qr.y * scale, width: p.qr.size * scale, height: p.qr.size * scale, cursor: 'move',
            border: p.qrSelected ? '2px solid #4f46e5' : '1px dashed rgba(79,70,229,0.55)',
            boxShadow: p.qrSelected ? '0 0 0 3px rgba(79,70,229,0.18)' : undefined,
          }}
        >
          {p.qrSelected && (
            <span role="presentation" data-testid="qr-handle" onPointerDown={(e) => qrStart(e, 'size')} onPointerMove={qrMove} onPointerUp={qrEnd} onPointerCancel={qrEnd}
              className="absolute h-3.5 w-3.5 rounded-sm border-2 border-indigo-600 bg-white shadow" style={{ right: -7, bottom: -7, cursor: 'nwse-resize' }} />
          )}
        </div>
      )}

      {guides.x !== null && <div data-testid="guide-x" className="pointer-events-none absolute top-0 h-full border-l border-dashed border-fuchsia-500" style={{ left: guides.x * scale }} />}
      {guides.y !== null && <div data-testid="guide-y" className="pointer-events-none absolute left-0 w-full border-t border-dashed border-fuchsia-500" style={{ top: guides.y * scale }} />}

      {p.renderState === 'loading' && <div data-testid="canvas-busy" className="pointer-events-none absolute right-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-slate-600 shadow">Drawing…</div>}

      {p.sampling && (
        <div
          role="button" tabIndex={0} aria-label="Click the template to pick a colour" data-testid="sample-overlay" data-ready={sampler ? '1' : '0'}
          className="absolute inset-0 z-40" style={{ cursor: 'crosshair' }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => { const hex = sampleAt(e); if (hex) setHover({ hex, x: e.clientX - (box.current?.getBoundingClientRect().left ?? 0), y: e.clientY - (box.current?.getBoundingClientRect().top ?? 0) }); }}
          onClick={(e) => { e.stopPropagation(); const hex = sampleAt(e); if (hex) p.onSample(hex); }}
        >
          {hover && (
            <span data-testid="sample-readout" className="pointer-events-none absolute rounded-md border border-white px-1.5 py-0.5 font-mono text-[11px] shadow" style={{ left: hover.x + 14, top: hover.y + 14, backgroundColor: hover.hex, color: contrastInk(hover.hex) }}>{hover.hex}</span>
          )}
          {samplerError && <span role="alert" className="absolute left-2 top-2 rounded bg-red-600 px-2 py-1 text-xs text-white">{samplerError}</span>}
        </div>
      )}
    </div>
  );
}
