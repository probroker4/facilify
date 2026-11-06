import React from 'react';
import { InfoIcon, CheckCircleIcon, AlertTriangleIcon, AlertCircleIcon, XIcon } from './icons';

export interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  testId?: string;
}

const configs = {
  info: { box: 'border-blue-200 bg-blue-50 text-blue-950', icon: 'text-blue-700', Icon: InfoIcon },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-950', icon: 'text-emerald-700', Icon: CheckCircleIcon },
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-950', icon: 'text-amber-700', Icon: AlertTriangleIcon },
  error: { box: 'border-rose-200 bg-rose-50 text-rose-950', icon: 'text-rose-700', Icon: AlertCircleIcon },
};

export function Alert({ type = 'info', title, children, onDismiss, className = '', testId }: AlertProps) {
  const cfg = configs[type];
  return (
    <div role={type === 'error' ? 'alert' : 'status'} data-testid={testId ?? `alert-${type}`} className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${cfg.box} ${className}`}>
      <cfg.Icon className={`mt-0.5 shrink-0 ${cfg.icon}`} size={18} />
      <div className="min-w-0 flex-1">
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="rounded p-1 text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="Dismiss message">
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}
