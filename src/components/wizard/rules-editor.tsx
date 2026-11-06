'use client';

import React from 'react';
import type { CondOp, Condition } from '@/lib/contracts';
import { Button } from '../ui/button';
import { SelectField, TextField } from '../ui/form';
import { PlusIcon, Trash2Icon } from '../ui/icons';
import type { DraftRule } from './draft';
import type { TemplateChoice } from './templates';

const OPS: { op: CondOp; label: string }[] = [
  { op: 'equals', label: 'is exactly' },
  { op: 'contains', label: 'contains' },
  { op: 'startsWith', label: 'starts with' },
  { op: 'oneOf', label: 'is one of (separate with commas)' },
  { op: 'isEmpty', label: 'is empty' },
  { op: 'gte', label: 'is at least (a number)' },
  { op: 'lte', label: 'is at most (a number)' },
  { op: 'between', label: 'is between (two numbers)' },
];

function valueText(c: Condition): string {
  const v = c.value;
  if (Array.isArray(v)) return v.join(c.op === 'between' ? ' to ' : ', ');
  return v === undefined ? '' : String(v);
}

function parseValue(op: CondOp, text: string): Condition['value'] {
  if (op === 'isEmpty') return undefined;
  if (op === 'oneOf') return text.split(',').map((s) => s.trim()).filter(Boolean);
  if (op === 'gte' || op === 'lte') return text.trim() === '' || Number.isNaN(Number(text)) ? undefined : Number(text);
  if (op === 'between') {
    const nums = text.split(/\s*(?:to|-|,)\s*/i).map((s) => Number(s)).filter((n) => !Number.isNaN(n));
    return nums.length === 2 ? ([nums[0], nums[1]] as [number, number]) : undefined;
  }
  return text;
}

export function RulesEditor({ rules, columns, choices, onChange }: {
  rules: DraftRule[]; columns: string[]; choices: TemplateChoice[]; onChange: (rules: DraftRule[]) => void;
}) {
  const patch = (id: string, p: Partial<DraftRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    const n = rules.length + 1;
    onChange([...rules, {
      id: `r_${Date.now().toString(36)}${n}`, label: `Special award ${n}`, mode: 'all',
      conditions: [{ column: columns[0] ?? '', op: 'gte', value: undefined }], templateId: choices[0]?.id ?? 'builtin:classic',
    }]);
  };

  return (
    <div className="space-y-4">
      {rules.length === 0 && <p className="text-sm text-slate-600">No special rules. Most events do not need any.</p>}
      {rules.map((r, ri) => (
        <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid={`rule-${ri}`}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="Name of this award" value={r.label} onChange={(e) => patch(r.id, { label: e.target.value })} data-testid={`rule-${ri}-label`} />
            <SelectField label="Certificate design" value={r.templateId} onChange={(e) => patch(r.id, { templateId: e.target.value })} data-testid={`rule-${ri}-template`}>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
          <fieldset className="mt-3">
            <legend className="text-sm font-medium text-slate-800">A student gets this certificate when</legend>
            <div className="mt-1 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" name={`mode-${r.id}`} checked={r.mode === 'all'} onChange={() => patch(r.id, { mode: 'all' })} />all of these are true</label>
              <label className="flex items-center gap-1.5"><input type="radio" name={`mode-${r.id}`} checked={r.mode === 'any'} onChange={() => patch(r.id, { mode: 'any' })} />any of these is true</label>
            </div>
          </fieldset>
          <div className="mt-3 space-y-3">
            {r.conditions.map((c, ci) => (
              <div key={ci} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <SelectField label={`Column for condition ${ci + 1}`} hideLabel value={c.column} onChange={(e) => patch(r.id, { conditions: r.conditions.map((x, i) => (i === ci ? { ...x, column: e.target.value } : x)) })} data-testid={`rule-${ri}-cond-${ci}-column`}>
                  <option value="">Choose a column...</option>
                  {columns.map((h) => <option key={h} value={h}>{h}</option>)}
                </SelectField>
                <SelectField label={`Comparison for condition ${ci + 1}`} hideLabel value={c.op} onChange={(e) => patch(r.id, { conditions: r.conditions.map((x, i) => (i === ci ? { ...x, op: e.target.value as CondOp, value: parseValue(e.target.value as CondOp, valueText(x)) } : x)) })} data-testid={`rule-${ri}-cond-${ci}-op`}>
                  {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </SelectField>
                {c.op === 'isEmpty' ? <div /> : (
                  <TextField label={`Value for condition ${ci + 1}`} hideLabel placeholder={c.op === 'between' ? 'e.g. 1 to 3' : c.op === 'oneOf' ? 'e.g. Gold, Silver' : c.op === 'gte' || c.op === 'lte' ? 'e.g. 90' : 'Type a value'}
                    defaultValue={valueText(c)} key={`${ci}-${c.op}`}
                    onChange={(e) => patch(r.id, { conditions: r.conditions.map((x, i) => (i === ci ? { ...x, value: parseValue(x.op, e.target.value) } : x)) })} data-testid={`rule-${ri}-cond-${ci}-value`} />
                )}
                <Button variant="ghost" size="md" aria-label={`Remove condition ${ci + 1}`} onClick={() => patch(r.id, { conditions: r.conditions.filter((_, i) => i !== ci) })} disabled={r.conditions.length < 2}><Trash2Icon size={16} /></Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" icon={<PlusIcon size={14} />} onClick={() => patch(r.id, { conditions: [...r.conditions, { column: columns[0] ?? '', op: 'equals', value: '' }] })}>Add a condition</Button>
            <Button variant="ghost" size="sm" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} data-testid={`rule-${ri}-remove`}>Remove this rule</Button>
          </div>
        </div>
      ))}
      <Button variant="outline" icon={<PlusIcon size={16} />} onClick={add} data-testid="add-rule">Add a special rule</Button>
    </div>
  );
}
