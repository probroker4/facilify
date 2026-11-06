'use client';

import React from 'react';
import { ButtonLink } from '../ui/button';
import { EmptyState, PageLoading } from '../ui/card';
import { missingBefore } from './draft';
import { useWizard } from './wizard-context';

export function StepGate({ step, children }: { step: number; children: React.ReactNode }) {
  const { draft, ready } = useWizard();
  if (!ready) return <PageLoading />;
  const missing = missingBefore(draft, step);
  if (missing) {
    return (
      <EmptyState
        title={`Please finish "${missing.title}" first`}
        action={<ButtonLink href={missing.href} data-testid="gate-link">Go to step {missing.id}: {missing.title}</ButtonLink>}
      >
        This step needs what you choose in step {missing.id}. Your progress so far is saved.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
