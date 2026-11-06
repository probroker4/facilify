import { fillPlaceholders } from '@/lib/text';

export const DEFAULT_FOLDER_PATTERN = 'Facilify/{{EVENT}}/{{CERTIFICATE_TYPE}}';
export const REPORTS_FOLDER = '_reports';

const MAX_NAME = 80;
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

function truncateGraphemes(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

function clean(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[‪-‮⁦-⁩​‎‏﻿]/g, '')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[/\\]+/g, '-')
    .replace(/[\u0000-\u001f\u007f<>"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function finish(s: string): string {
  return s.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
}

export function safeFolderName(s: string): string {
  let out = finish(clean(s));
  out = finish(truncateGraphemes(out, MAX_NAME));
  if (RESERVED.test(out)) out = out.replace(/^([^.]+)/, '$1_');
  return out;
}

export function safeFileName(name: string, fallback = 'file'): string {
  const raw = clean(name);
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(raw)!;
  const ext = (m[2] ?? '').toLowerCase();
  let base = finish(truncateGraphemes(finish(m[1]), 120));
  if (!base) base = fallback;
  if (RESERVED.test(base)) base = base.replace(/^([^.]+)/, '$1_');
  return `${base}${ext}`;
}

function segments(pattern: string): string[] {
  return (pattern || DEFAULT_FOLDER_PATTERN).split(/[\\/]+/).map((s) => s.trim()).filter(Boolean);
}

function fillSegment(seg: string, vals: Record<string, string>): string {
  if (!/\{\{/.test(seg)) return safeFolderName(seg);
  const filled = safeFolderName(safeFolderName(fillPlaceholders(seg, vals)).replace(/^[\s\-\u2013\u2014_,]+|[\s\-\u2013\u2014_,]+$/g, ''));
  return filled || 'Other';
}

export function folderPathFor(pattern: string, values: Record<string, string>, categoryFolder?: string): string[] {
  const vals = { ...values, ...(categoryFolder ? { CERTIFICATE_TYPE: categoryFolder, CATEGORY: categoryFolder } : {}) };
  return segments(pattern).map((seg) => fillSegment(seg, vals)).filter(Boolean);
}

export function reportFolderPathFor(pattern: string, values: Record<string, string>): string[] {
  const segs = segments(pattern);
  const cut = segs.findIndex((s) => /\{\{\s*(certificate[ _]?type|category)\s*\}\}/i.test(s));
  const kept = cut === -1 ? segs : segs.slice(0, cut);
  return [...kept.map((seg) => fillSegment(seg, values)).filter(Boolean), REPORTS_FOLDER];
}
