'use client';

import React, { useId } from 'react';

const control =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  hideLabel?: boolean;
}

function Shell({ id, label, hint, error, required, className = '', hideLabel, children }: FieldShellProps & { id: string; children: React.ReactNode }) {
  return (
    <div className={`w-full ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-sm font-medium text-slate-800 mb-1.5'}>
        {label}
        {required && <span className="text-rose-600" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-rose-700">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-600">{hint}</p>
      ) : null}
    </div>
  );
}

export type SelectFieldProps = FieldShellProps & React.SelectHTMLAttributes<HTMLSelectElement>;
export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, required, className, hideLabel, id, children, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} required={required} className={className} hideLabel={hideLabel}>
      <select ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} className={control} {...rest}>
        {children}
      </select>
    </Shell>
  );
});

export type TextFieldProps = FieldShellProps & React.InputHTMLAttributes<HTMLInputElement>;
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, required, className, hideLabel, id, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} required={required} className={className} hideLabel={hideLabel}>
      <input ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} className={control} {...rest} />
    </Shell>
  );
});

export type TextAreaFieldProps = FieldShellProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, hint, error, required, className, hideLabel, id, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} required={required} className={className} hideLabel={hideLabel}>
      <textarea ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} className={`${control} leading-relaxed`} {...rest} />
    </Shell>
  );
});

export function CheckboxField({ label, hint, className = '', ...rest }: { label: React.ReactNode; hint?: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-400 text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1" {...rest} />
      <label htmlFor={id} className="text-sm text-slate-800">
        {label}
        {hint && <span className="block text-xs text-slate-600 mt-0.5">{hint}</span>}
      </label>
    </div>
  );
}

export function RadioCard({ name, value, checked, onChange, title, description, testId }: {
  name: string; value: string; checked: boolean; onChange: (v: string) => void; title: string; description?: string; testId?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${checked ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
      <input id={id} type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} data-testid={testId}
        className="mt-1 h-4 w-4 text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1" />
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {description && <span className="block text-xs text-slate-600 mt-0.5 leading-relaxed">{description}</span>}
      </span>
    </label>
  );
}
