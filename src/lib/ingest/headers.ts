import type { ColumnProfile, HeaderMatch } from '@/lib/contracts';
import { STANDARD_PLACEHOLDERS } from '@/lib/contracts';
import { levenshtein } from '@/lib/text';
import { normKey, normWords } from '@/lib/routing/norm';

export const SYNONYMS: Record<string, string[]> = {
  NAME: ['name', 'student name', 'full name', 'person name', 'participant', 'participant name', 'candidate', 'candidate name',
    'name of student', 'name of participant', 'student', 'recipient', 'recipient name', 'awardee', 'member name', 'attendee', 'attendee name'],
  ID: ['id', 'student id', 'roll no', 'roll number', 'registration no', 'registration number', 'reg no', 'enrollment no',
    'enrolment no', 'enrollment number', 'usn', 'prn', 'admission no', 'student no', 'participant id', 'register number'],
  EMAIL: ['email', 'email id', 'student email', 'college email', 'official email', 'email address', 'mail', 'mail id',
    'university email', 'institutional email', 'institute email', 'e mail', 'registered email'],
  PERSONAL_EMAIL: ['personal email', 'alternate email', 'alt email', 'other email', 'secondary email', 'personal mail', 'private email'],
  EVENT: ['event', 'event name', 'program', 'programme', 'workshop', 'hackathon', 'competition', 'activity', 'course', 'seminar', 'event title'],
  CERTIFICATE_TYPE: ['certificate type', 'cert type', 'type', 'award', 'award type', 'category', 'prize', 'position', 'result', 'award category', 'rank title'],
  ACHIEVEMENT: ['achievement', 'accomplishment', 'description', 'remarks', 'distinction', 'recognition', 'for', 'reason', 'citation'],
  DATE: ['date', 'event date', 'issue date', 'date of issue', 'completion date', 'award date', 'issued on'],
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const groupOf = new Map<string, string>();
for (const [ph, list] of Object.entries(SYNONYMS)) for (const s of list) if (!groupOf.has(normKey(s))) groupOf.set(normKey(s), ph);

export function headingScore(query: string, heading: string): number {
  const q = normKey(query);
  const h = normKey(heading);
  if (!q || !h) return 0;
  if (q === h) return 1;
  let best = 0;
  const maxLen = Math.max(q.length, h.length);
  const ratio = 1 - levenshtein(q, h) / maxLen;
  if (ratio >= 0.75) best = Math.max(best, 0.6 + 0.35 * ratio);
  if (q.length >= 3 && h.length >= 3 && (h.includes(q) || q.includes(h))) best = Math.max(best, 0.7);
  const gq = groupOf.get(q);
  const gh = groupOf.get(h);
  if (gq && gq === gh) best = Math.max(best, 0.85);
  const tq = new Set(normWords(query).split(' ').filter(Boolean));
  const th = new Set(normWords(heading).split(' ').filter(Boolean));
  const inter = [...tq].filter((t) => th.has(t)).length;
  if (inter) best = Math.max(best, (0.6 * inter) / new Set([...tq, ...th]).size);
  if (tq.size && th.size > tq.size && [...tq].every((t) => th.has(t))) best = Math.max(best, 0.88 - 0.01 * (th.size - tq.size));
  return Math.min(1, best);
}

function decide(placeholder: string, scored: { column: string; score: number }[], typed?: string, containing = 0): HeaderMatch {
  scored.sort((a, b) => b.score - a.score || cmp(a.column, b.column));
  const top = scored[0];
  const candidates = scored.filter((s) => s.score >= 0.5).slice(0, 5).map((s) => s.column);
  if (!top || top.score < 0.5) return { placeholder, typed, column: null, confidence: top?.score ?? 0, candidates, ambiguous: false };
  if (top.score >= 1) return { placeholder, typed, column: top.column, confidence: 1, candidates: [top.column], ambiguous: false };
  const second = scored[1];
  const ambiguous = (!!second && second.score >= 0.5 && second.score >= top.score - 0.1) || containing >= 2;
  return { placeholder, typed, column: ambiguous ? null : top.column, confidence: top.score, candidates, ambiguous };
}

export function matchTypedHeading(typed: string, headers: string[], placeholder = ''): HeaderMatch {
  const q = normKey(typed);
  const scored = headers.map((column) => ({ column, score: headingScore(typed, column) }));
  const containing = q.length >= 2 ? headers.filter((h) => normKey(h).includes(q)).length : 0;
  return decide(placeholder, scored, typed.trim() || undefined, containing);
}

export function suggestMappings(headers: string[], placeholders: readonly string[] = STANDARD_PLACEHOLDERS): HeaderMatch[] {
  const sortedHeaders = [...headers].sort(cmp);
  const pairs: { placeholder: string; column: string; score: number }[] = [];
  for (const ph of placeholders) {
    const aliases = [ph.replace(/_/g, ' '), ...(SYNONYMS[ph] ?? [])];
    for (const column of sortedHeaders) {
      let score = Math.max(...aliases.map((a) => headingScore(a, column)));
      const owner = groupOf.get(normKey(column));
      if (owner && owner !== ph && score < 1) score = Math.min(score, 0.55);
      pairs.push({ placeholder: ph, column, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || cmp(a.placeholder, b.placeholder) || cmp(a.column, b.column));
  const usedCols = new Set<string>();
  const result = new Map<string, HeaderMatch>();
  for (const p of pairs) {
    if (result.has(p.placeholder) || usedCols.has(p.column) || p.score < 0.6) continue;
    const others = pairs.filter((o) => o.placeholder === p.placeholder && o.column !== p.column && !usedCols.has(o.column));
    const runnerUp = others[0];
    const ambiguous = !!runnerUp && runnerUp.score >= p.score - 0.05 && runnerUp.score >= 0.6;
    if (ambiguous) {
      result.set(p.placeholder, { placeholder: p.placeholder, column: null, confidence: p.score, candidates: [p.column, runnerUp.column], ambiguous: true });
      continue;
    }
    usedCols.add(p.column);
    result.set(p.placeholder, { placeholder: p.placeholder, column: p.column, confidence: p.score, candidates: [p.column], ambiguous: false });
  }
  return placeholders.map((ph) => result.get(ph) ?? { placeholder: ph, column: null, confidence: 0, candidates: [], ambiguous: false });
}

export function applyProfile(profile: ColumnProfile, headers: string[]): HeaderMatch[] {
  return Object.entries(profile.matches).map(([placeholder, heading]) => matchTypedHeading(heading, headers, placeholder));
}

export function makeProfile(id: string, name: string, matches: HeaderMatch[]): ColumnProfile {
  const out: Record<string, string> = {};
  for (const m of matches) if (m.column) out[m.placeholder] = m.column;
  return { id, name, matches: out };
}
