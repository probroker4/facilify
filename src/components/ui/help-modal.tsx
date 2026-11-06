'use client';

import React, { useState } from 'react';
import { HELP, type HelpKey, ALL_HELP_KEYS, WIZARD_STEP_KEYS } from '@/content/help';
import { HelpCircleIcon, XIcon, CheckCircleIcon } from './icons';
import { Modal } from './modal';

export interface HelpButtonProps {
  helpKey: HelpKey;
  label?: string;
  size?: 'sm' | 'md';
}

export function HelpButton({ helpKey, label, size = 'sm' }: HelpButtonProps) {
  const [open, setOpen] = useState(false);
  const entry = HELP[helpKey];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid={`help-${helpKey}`}
        aria-label={`Help: ${entry?.title || helpKey}`}
      >
        <HelpCircleIcon size={size === 'sm' ? 16 : 18} />
        {label && <span className="text-xs font-medium">{label}</span>}
      </button>

      {open && entry && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={entry.title}
          description="Quick help"
        >
          <div className="space-y-4">
            <p className="text-slate-700 leading-relaxed text-sm">{entry.body}</p>

            {entry.tips && entry.tips.length > 0 && (
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 mt-3">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">
                  Helpful tips
                </h4>
                <ul className="space-y-2">
                  {entry.tips.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-indigo-950">
                      <CheckCircleIcon size={14} className="text-indigo-600 mt-0.5 shrink-0" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function AllHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeKey, setActiveKey] = useState<HelpKey>('upload');
  const activeEntry = HELP[activeKey];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How Facilify works"
      description="Short answers for every step, in plain language."
      maxWidth="3xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-1 pr-2 max-h-[60vh] overflow-y-auto border-r border-slate-100">
          <p className="text-[11px] font-bold uppercase text-slate-600 tracking-wider px-2 py-1">Wizard Steps</p>
          {WIZARD_STEP_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={activeKey === k}
              onClick={() => setActiveKey(k)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeKey === k
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {HELP[k].title.split(':')[1]?.trim() || HELP[k].title}
            </button>
          ))}

          <p className="text-[11px] font-bold uppercase text-slate-600 tracking-wider px-2 pt-3 pb-1">Features & Settings</p>
          {(['dashboard', 'tickets', 'settings', 'googleSignIn', 'gmailLimit', 'smtp', 'drive', 'linkedin', 'reportProblem'] as HelpKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={activeKey === k}
              onClick={() => setActiveKey(k)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeKey === k
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {HELP[k].title}
            </button>
          ))}
        </div>

        <div className="md:col-span-2 space-y-4">
          <h3 className="text-base font-bold text-slate-900">{activeEntry.title}</h3>
          <p className="text-sm text-slate-700 leading-relaxed">{activeEntry.body}</p>

          {activeEntry.tips && activeEntry.tips.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Tips</h4>
              <ul className="space-y-2">
                {activeEntry.tips.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-indigo-950">
                    <CheckCircleIcon size={14} className="text-indigo-600 mt-0.5 shrink-0" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
