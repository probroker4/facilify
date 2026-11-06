'use client';

import { useEffect, useState } from 'react';
import type { CertTemplate } from '@/lib/contracts';
import { api } from './api';
import { BUILTIN_CHOICES } from './draft';

export interface TemplateChoice { id: string; name: string; builtin: boolean; template: CertTemplate }

export function useTemplateChoices(): { choices: TemplateChoice[]; loading: boolean; reload: () => Promise<void> } {
  const [choices, setChoices] = useState<TemplateChoice[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const r = await api<{ builtins: CertTemplate[]; saved: CertTemplate[] }>('/api/templates');
      const order = new Map(BUILTIN_CHOICES.map((b, i) => [b.id, i]));
      const nameOf = new Map(BUILTIN_CHOICES.map((b) => [b.id, b.name]));
      const builtins = [...r.builtins].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
        .map((t) => ({ id: t.id, name: nameOf.get(t.id) ?? t.name, builtin: true, template: t }));
      const mine = r.saved.map((t) => ({ id: t.id, name: t.name, builtin: false, template: t }));
      setChoices([...builtins, ...mine]);
    } catch {
      setChoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);
  return { choices, loading, reload };
}

export function thumbUrl(t: CertTemplate | undefined, scale = 0.3): string | null {
  const ref = t?.backgroundRef;
  if (!t || !ref) return null;
  return `/api/editor/background/${encodeURIComponent(ref)}?scale=${scale}`;
}
