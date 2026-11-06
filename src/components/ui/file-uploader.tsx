'use client';

import React, { useId, useRef, useState } from 'react';
import { UploadCloudIcon, FileSpreadsheetIcon, CheckCircleIcon, XIcon } from './icons';

export interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSizeMb?: number;
  selectedFile?: { name: string; detail?: string } | null;
  onClear?: () => void;
  loading?: boolean;
  testId?: string;
  title?: string;
  hint?: React.ReactNode;
}

export function FileUploader({
  onFileSelect, accept = '.xlsx,.xls,.csv', maxSizeMb = 15, selectedFile, onClear, loading = false,
  testId = 'upload-input', title = 'Drag your student sheet here', hint,
}: FileUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const errId = useId();

  const take = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    const allowed = accept.split(',').map((s) => s.trim().toLowerCase());
    if (!allowed.includes(ext)) { setError(`"${file.name}" is not a type Facilify can read here. Please choose one of: ${allowed.join(', ')}.`); return; }
    if (file.size > maxSizeMb * 1024 * 1024) { setError(`That file is larger than ${maxSizeMb} MB. Try removing unused sheets or columns.`); return; }
    if (file.size === 0) { setError('That file is empty.'); return; }
    onFileSelect(file);
  };

  const hiddenInput = (
    <input
      ref={input} type="file" accept={accept} data-testid={testId} aria-label="Choose a file from your computer" aria-describedby={error ? errId : undefined}
      className="sr-only" tabIndex={-1} disabled={loading}
      onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
    />
  );

  if (selectedFile) {
    return (
      <div className="w-full">
        {hiddenInput}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4" data-testid="uploaded-file">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800"><FileSpreadsheetIcon size={22} /></div>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="truncate">{selectedFile.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800"><CheckCircleIcon size={12} />Ready</span>
              </p>
              {selectedFile.detail && <p className="mt-0.5 text-xs text-slate-600">{selectedFile.detail}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => input.current?.click()} data-testid="upload-replace" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Use a different file</button>
            {onClear && (
              <button type="button" onClick={onClear} data-testid="upload-clear" aria-label="Remove this file" className="rounded-lg p-2 text-slate-600 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><XIcon size={16} /></button>
            )}
          </div>
        </div>
        {error && <p id={errId} role="alert" className="mt-2 text-sm font-medium text-rose-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-full">
      {hiddenInput}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${dragging ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300 bg-white'}`}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
          {loading ? (
            <svg aria-hidden="true" className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          ) : <UploadCloudIcon size={28} />}
        </div>
        <p className="text-base font-semibold text-slate-900">{loading ? 'Reading your sheet...' : title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">{hint ?? 'Excel (.xlsx, .xls) or CSV. One row per student.'}</p>
        <button
          type="button" disabled={loading} onClick={() => input.current?.click()} data-testid="upload-browse"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          Choose a file
        </button>
      </div>
      {error && <p id={errId} role="alert" className="mt-2 text-sm font-medium text-rose-700">{error}</p>}
    </div>
  );
}
