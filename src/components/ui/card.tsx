'use client';

import React from 'react';
import { HelpButton } from './help-modal';
import type { HelpKey } from '@/content/help';

export function Card({ children, className = '', as: Tag = 'section', ...rest }: { children: React.ReactNode; className?: string; as?: 'section' | 'div' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={`rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ${className}`} {...rest}>{children}</Tag>;
}

export function PageHeader({ title, subtitle, step, help, actions }: { title: string; subtitle?: React.ReactNode; step?: string; help?: HelpKey; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {step && <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">{step}</p>}
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900" data-testid="page-title">{title}</h1>
          {help && <HelpButton helpKey={help} />}
        </div>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center" data-testid="empty-state">
      {icon && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">{icon}</div>}
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <svg aria-hidden="true" className="h-4 w-4 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </span>
  );
}

export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return <div className="flex justify-center py-16" data-testid="page-loading"><Spinner label={`${label}...`} /></div>;
}

export function ProgressBar({ value, max, label, tone = 'indigo' }: { value: number; max: number; label: string; tone?: 'indigo' | 'emerald' | 'rose' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === 'emerald' ? 'bg-emerald-600' : tone === 'rose' ? 'bg-rose-600' : 'bg-indigo-600';
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StepFooter({ back, next, note }: { back?: React.ReactNode; next?: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">{back}</div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
        {note && <p className="text-sm text-slate-600" role="status">{note}</p>}
        {next}
      </div>
    </div>
  );
}
