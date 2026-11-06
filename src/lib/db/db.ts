import path from 'node:path';
import { dataDir } from '@/lib/paths';

type SqliteModule = typeof import('node:sqlite');
export type DB = InstanceType<SqliteModule['DatabaseSync']>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizers (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, password_hash TEXT,
  google_sub TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
  organizer_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, encrypted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organizer_id, key));
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, kind TEXT NOT NULL, original_name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schemes (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS column_profiles (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
  sheet_upload_id TEXT, config_json TEXT NOT NULL DEFAULT '{}', message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, row_number INTEGER NOT NULL, person_key TEXT NOT NULL,
  email TEXT NOT NULL, email_source TEXT NOT NULL, values_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_batch ON records(batch_id);
CREATE INDEX IF NOT EXISTS records_email ON records(email COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, organizer_id TEXT NOT NULL, record_id TEXT NOT NULL, person_key TEXT NOT NULL,
  category_id TEXT NOT NULL, category_label TEXT NOT NULL, template_id TEXT NOT NULL, dup_key TEXT NOT NULL,
  file_name TEXT, sha256 TEXT, verify_code TEXT NOT NULL, status TEXT NOT NULL, held_reason TEXT,
  error TEXT, error_transient INTEGER, attempts INTEGER NOT NULL DEFAULT 0, storage_id TEXT, web_link TEXT,
  folder_path TEXT, message_id TEXT, revoked INTEGER NOT NULL DEFAULT 0, sent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS certs_batch ON certificates(batch_id, status);
CREATE INDEX IF NOT EXISTS certs_dup ON certificates(organizer_id, dup_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS certs_verify ON certificates(verify_code);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cert_id TEXT, batch_id TEXT, from_status TEXT, to_status TEXT, note TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_cert ON events(cert_id);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, cert_id TEXT NOT NULL, batch_id TEXT NOT NULL, organizer_id TEXT NOT NULL, category TEXT NOT NULL,
  field TEXT, suggested TEXT, note TEXT, status TEXT NOT NULL, resolution_note TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE INDEX IF NOT EXISTS tickets_org ON tickets(organizer_id, status);
CREATE TABLE IF NOT EXISTS batch_locks (
  batch_id TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL, heartbeat INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS send_counts (
  organizer_id TEXT NOT NULL, transport TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organizer_id, transport, day));
`;

const handles = new Map<string, DB>();

export function openDb(file?: string): DB {
  const target = file ?? path.join(dataDir(), 'certflow.db');
  const existing = handles.get(target);
  if (existing) return existing;
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as SqliteModule;
  const db = new DatabaseSync(target);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  handles.set(target, db);
  return db;
}

export function closeDb(file?: string) {
  const target = file ?? path.join(dataDir(), 'certflow.db');
  handles.get(target)?.close();
  handles.delete(target);
}

export const nowIso = () => new Date().toISOString();

type Param = string | number | null | bigint | Uint8Array;
export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(db: DB, sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}
const txDepth = new WeakMap<object, number>();
export function tx<T>(db: DB, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0;
  const name = `cf_sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  txDepth.set(db, depth + 1);
  try {
    const r = fn();
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return r;
  } catch (e) {
    try { db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`); } catch {  }
    throw e;
  } finally {
    txDepth.set(db, depth);
  }
}
