'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { StepperHeader, isWizardPath } from '@/components/wizard/stepper';
import { WizardProvider } from '@/components/wizard/wizard-context';
import { MeProvider, type Me } from '@/components/wizard/me-context';
import { api, errorText } from '@/components/wizard/api';
import { PageLoading } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { LayoutDashboardIcon, TicketIcon, SettingsIcon, LogOutIcon, HelpCircleIcon, PlusIcon } from '@/components/ui/icons';
import { AllHelpModal } from '@/components/ui/help-modal';

const navLink = (active: boolean) =>
  `relative flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
    active ? 'bg-slate-700 text-white' : 'text-slate-200 hover:bg-slate-800 hover:text-white'
  }`;

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/api/me'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [pathname, refresh]);

  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST', json: {}, noRedirect: true }); } catch {  }
    router.push('/login');
  };

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        {error ? <div className="max-w-md p-4"><Alert type="error" title="Could not open Facilify">{error}</Alert></div> : <PageLoading label="Opening Facilify" />}
      </div>
    );
  }

  const wizard = isWizardPath(pathname);
  return (
    <MeProvider me={me} refresh={refresh}>
      <WizardProvider organizerId={me.organizer.id}>
        <div className="flex min-h-screen flex-col bg-slate-50">
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-indigo-800">Skip to content</a>
          <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900 text-white">
            <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1.5 sm:px-6 lg:px-8">
              <Link href="/" className="flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white" data-testid="nav-home" aria-label="Facilify home">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-cyan-400 text-sm font-extrabold text-white" aria-hidden="true">C</span>
                <span className="text-base font-bold tracking-tight">Facilify</span>
              </Link>
              <nav aria-label="Main" className="flex flex-wrap items-center gap-0.5 sm:gap-1">
                <Link href="/upload" className={navLink(wizard)} data-testid="nav-new" aria-current={wizard ? 'page' : undefined}>
                  <PlusIcon size={16} /><span className="hidden sm:inline">New batch</span><span className="sr-only sm:hidden">New batch</span>
                </Link>
                <Link href="/dashboard" className={navLink(pathname.startsWith('/dashboard'))} data-testid="nav-dashboard" aria-current={pathname.startsWith('/dashboard') ? 'page' : undefined}>
                  <LayoutDashboardIcon size={16} /><span className="hidden sm:inline">Dashboard</span><span className="sr-only sm:hidden">Dashboard</span>
                </Link>
                <Link href="/tickets" className={navLink(pathname.startsWith('/tickets'))} data-testid="nav-tickets" aria-current={pathname.startsWith('/tickets') ? 'page' : undefined}>
                  <TicketIcon size={16} /><span className="hidden sm:inline">Tickets</span><span className="sr-only sm:hidden">Tickets</span>
                  {me.openTickets > 0 && (
                    <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-slate-950" data-testid="ticket-badge">
                      {me.openTickets}<span className="sr-only"> open</span>
                    </span>
                  )}
                </Link>
                <Link href="/settings" className={navLink(pathname.startsWith('/settings'))} data-testid="nav-settings" aria-current={pathname.startsWith('/settings') ? 'page' : undefined}>
                  <SettingsIcon size={16} /><span className="hidden sm:inline">Settings</span><span className="sr-only sm:hidden">Settings</span>
                </Link>
                <button type="button" onClick={() => setHelpOpen(true)} className={navLink(false)} data-testid="nav-help" aria-label="Help">
                  <HelpCircleIcon size={17} /><span className="hidden lg:inline">Help</span>
                </button>
                <button type="button" onClick={signOut} className={navLink(false)} data-testid="nav-signout" aria-label={`Sign out ${me.organizer.email}`}>
                  <LogOutIcon size={15} /><span className="hidden lg:inline">Sign out</span>
                </button>
              </nav>
            </div>
          </header>

          {wizard && <StepperHeader />}

          <main id="main" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 py-6 focus:outline-none sm:px-6 sm:py-8 lg:px-8 ${pathname?.startsWith('/design') ? 'max-w-[1800px]' : 'max-w-7xl'}`}>
            {children}
          </main>
          <AllHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
      </WizardProvider>
    </MeProvider>
  );
}
