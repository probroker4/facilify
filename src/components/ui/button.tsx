import Link from 'next/link';
import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'primary', size = 'md', loading = false, disabled, icon, className = '', type = 'button', ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

    const sizes = {
      sm: 'text-xs px-2.5 py-1.5 gap-1.5',
      md: 'text-sm px-4 py-2 gap-2',
      lg: 'text-base px-5 py-2.5 gap-2.5',
    };

    const variants = {
      primary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow focus-visible:ring-indigo-500 border border-transparent',
      secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 focus-visible:ring-slate-500 border border-slate-200',
      outline: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-xs focus-visible:ring-indigo-500',
      ghost: 'bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-900 focus-visible:ring-slate-500',
      danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm focus-visible:ring-rose-500 border border-transparent',
      success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm focus-visible:ring-emerald-500 border border-transparent',
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {loading ? (
          <svg aria-hidden="true" className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export interface ButtonLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  icon?: React.ReactNode;
}

export function ButtonLink({ href, variant = 'primary', size = 'md', icon, className = '', children, ...props }: ButtonLinkProps) {
  const sizes = { sm: 'text-xs px-2.5 py-1.5 gap-1.5', md: 'text-sm px-4 py-2 gap-2', lg: 'text-base px-5 py-2.5 gap-2.5' };
  const variants = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border border-transparent',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200',
    outline: 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-700',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white border border-transparent',
    success: 'bg-emerald-700 hover:bg-emerald-800 text-white border border-transparent',
  };
  const cls = `inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${sizes[size]} ${variants[variant]} ${className}`;
  const external = /^https?:\/\//.test(href) || href.startsWith('/api/');
  if (external) {
    return <a href={href} className={cls} {...props}>{icon && <span className="shrink-0">{icon}</span>}{children}</a>;
  }
  return <Link href={href} className={cls} {...props}>{icon && <span className="shrink-0">{icon}</span>}{children}</Link>;
}
