'use client';

import React, { createContext, useContext, useMemo } from 'react';

export interface Me {
  organizer: { id: string; email: string; name: string };
  organization: string;
  google: { configured: boolean; connected: boolean; email: string | null };
  openTickets: number;
  sender: 'capture' | 'smtp' | 'gmail';
  storage: 'local' | 'drive' | 'none';
}

interface MeContextType { me: Me; refresh: () => Promise<void> }
const MeContext = createContext<MeContextType | null>(null);

export function MeProvider({ me, refresh, children }: { me: Me; refresh: () => Promise<void>; children: React.ReactNode }) {
  const value = useMemo(() => ({ me, refresh }), [me, refresh]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeContextType {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe must be used inside the organizer area.');
  return ctx;
}

export const SENDER_LABEL: Record<Me['sender'], string> = {
  capture: 'Test outbox (nothing is really sent)',
  smtp: 'Your email server (SMTP)',
  gmail: 'Your Gmail account',
};
export const STORAGE_LABEL: Record<Me['storage'], string> = {
  local: 'A folder on this computer',
  drive: 'Google Drive',
  none: 'Not saved (email only)',
};
