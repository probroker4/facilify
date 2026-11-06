'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckIcon } from '../ui/icons';
import { STEPS, missingBefore } from './draft';
import { useWizard } from './wizard-context';

export const WIZARD_PATHS = STEPS.map((s) => s.href);

export function isWizardPath(pathname: string): boolean {
  return WIZARD_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function StepperHeader() {
  const pathname = usePathname();
  const { draft } = useWizard();
  const current = STEPS.findIndex((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  const active = STEPS[current];

  return (
    <div className="border-b border-slate-200 bg-white" data-testid="stepper">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="md:hidden">
          <p className="text-sm font-semibold text-slate-900" aria-live="polite">
            Step {current + 1} of {STEPS.length}: <span className="text-indigo-700">{active?.title}</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <div className="h-full rounded-full bg-indigo-600" style={{ width: `${((current + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
        <nav aria-label="Steps" className="hidden md:block">
          <ol className="flex items-center gap-1 overflow-x-auto">
            {STEPS.map((step, idx) => {
              const blocked = missingBefore(draft, step.id);
              const isCurrent = idx === current;
              const isPassed = idx < current;
              const inner = (
                <>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isCurrent ? 'bg-indigo-600 text-white' : isPassed ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isPassed ? <CheckIcon size={13} /> : step.id}
                  </span>
                  <span>{step.title}</span>
                </>
              );
              const cls = `flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                isCurrent ? 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200' : blocked ? 'text-slate-500' : 'text-slate-800 hover:bg-slate-100'
              }`;
              return (
                <li key={step.id} className="flex shrink-0 items-center" data-testid={`step-${step.slug}`}>
                  {blocked && !isCurrent ? (
                    <span className={cls} aria-disabled="true" title={`Finish "${blocked.title}" first`}>{inner}</span>
                  ) : (
                    <Link href={step.href} className={`${cls} focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`} aria-current={isCurrent ? 'step' : undefined}>{inner}</Link>
                  )}
                  {idx < STEPS.length - 1 && <span className="mx-0.5 h-px w-3 bg-slate-300" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
}
