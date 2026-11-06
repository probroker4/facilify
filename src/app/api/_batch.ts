import type { DB } from '@/lib/db/db';
import { getBatch, type BatchRow, type OrganizerRow } from '@/lib/db/repo';
import { sha256 } from '@/lib/hash';
import { getSetting } from '@/lib/db/repo';
import { notFound } from './_shared';

export function ownBatch(db: DB, org: OrganizerRow, id: string): BatchRow {
  const b = getBatch(db, org.id, id);
  if (!b) throw notFound('That batch was not found. It may have been deleted.');
  return b;
}

export function configFingerprint(batch: BatchRow): string {
  return sha256(batch.config_json);
}

export interface TestSentMark { fingerprint: string; at: string; to: string }
export const testSentKey = (batchId: string) => `testsent.${batchId}`;
export function readTestSent(db: DB, org: OrganizerRow, batch: BatchRow): TestSentMark | null {
  const m = getSetting<TestSentMark>(db, org.id, testSentKey(batch.id));
  return m && typeof m === 'object' && m.fingerprint === configFingerprint(batch) ? m : null;
}
