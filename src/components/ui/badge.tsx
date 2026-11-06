import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'blue';
  size?: 'sm' | 'md';
  className?: string;
  dot?: boolean;
}

export function Badge({
  children,
  variant = 'slate',
  size = 'md',
  className = '',
  dot = false,
}: BadgeProps) {
  const variants = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  const dots = {
    slate: 'bg-slate-500',
    indigo: 'bg-indigo-600',
    emerald: 'bg-emerald-600',
    amber: 'bg-amber-600',
    rose: 'bg-rose-600',
    purple: 'bg-purple-600',
    blue: 'bg-blue-600',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 gap-1 font-medium',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-semibold',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[variant]}`} />}
      {children}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting', GENERATED: 'Created', SAVED: 'Saved', SENDING: 'Sending', SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Skipped',
  OPEN: 'Open', RESOLVED: 'Fixed', REJECTED: 'Declined',
};

export function StatusBadge({ status, testId }: { status: string; testId?: string }) {
  const s = status.toUpperCase();
  const label = STATUS_LABEL[s] ?? status;
  const variant: BadgeProps['variant'] =
    s === 'SENT' || s === 'RESOLVED' ? 'emerald'
      : s === 'FAILED' || s === 'REJECTED' ? 'rose'
      : s === 'SENDING' || s === 'GENERATED' || s === 'SAVED' ? 'indigo'
      : s === 'PENDING' || s === 'OPEN' ? 'amber'
      : 'slate';
  return <span data-testid={testId ?? 'status-badge'} data-status={s}><Badge variant={variant} dot>{label}</Badge></span>;
}
