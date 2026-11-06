'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { emptyDraft, type Draft } from './draft';

interface WizardContextType {
  draft: Draft;
  ready: boolean;
  update: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;
  reset: () => void;
}

const WizardContext = createContext<WizardContextType | null>(null);

const KEY = (organizerId: string) => `certflow:draft:v2:${organizerId}`;

export function WizardProvider({ organizerId, children }: { organizerId: string; children: React.ReactNode }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    let next = emptyDraft();
    try {
      const raw = localStorage.getItem(KEY(organizerId));
      if (raw) {
        const parsed = JSON.parse(raw) as Draft;
        if (parsed && parsed.v === 2) next = { ...next, ...parsed };
      }
    } catch {
    }
    loadedFor.current = organizerId;
    setDraft(next);
    setReady(true);
  }, [organizerId]);

  useEffect(() => {
    if (!ready || loadedFor.current !== organizerId) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY(organizerId), JSON.stringify(draft));
      } catch {
      }
    }, 150);
    return () => clearTimeout(t);
  }, [draft, ready, organizerId]);

  const update = useCallback((patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    setDraft((d) => ({ ...d, ...(typeof patch === 'function' ? patch(d) : patch) }));
  }, []);

  const reset = useCallback(() => {
    const fresh = emptyDraft();
    setDraft(fresh);
    try {
      localStorage.setItem(KEY(organizerId), JSON.stringify(fresh));
    } catch {
    }
  }, [organizerId]);

  const value = useMemo(() => ({ draft, ready, update, reset }), [draft, ready, update, reset]);
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used inside the organizer area.');
  return ctx;
}
