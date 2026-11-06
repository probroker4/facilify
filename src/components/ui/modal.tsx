'use client';

import React, { useEffect, useId, useRef } from 'react';
import { XIcon } from './icons';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  testId?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, description, children, footer, maxWidth = 'lg', testId }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusables = () => (dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null) : []);
    const body = dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0];
    body?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const widthClasses = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
      <div className="fixed inset-0 bg-slate-900/50" onClick={() => onClose()} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId ?? 'modal'}
        className={`relative z-10 flex max-h-[90vh] w-full ${widthClasses[maxWidth]} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
            {description && <p id={descId} className="mt-1 text-xs text-slate-600">{description}</p>}
          </div>
          <button type="button" onClick={() => onClose()} data-testid="modal-close" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="Close dialog">
            <XIcon size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-sm text-slate-700 sm:p-6">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/70 p-4">{footer}</div>}
      </div>
    </div>
  );
}
