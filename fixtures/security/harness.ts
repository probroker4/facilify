import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..', '..');
export const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

export class Failure extends Error {}
export function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Failure(msg);
}
export function ok(msg: string) { console.log(`  ok ${msg}`); }

export interface RunningServer {
  port: number;
  base: string;
  dataDir: string;
  distDir: string;
  logs(): string;
  stop(): Promise<void>;
}

export interface StartOptions {
  port: number;
  distDir: string;
  dataDir: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  mode?: 'dev' | 'start';
}

const live = new Set<RunningServer>();
let hooked = false;

function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch {  }
}

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

const TSCONFIG = path.join(ROOT, 'tsconfig.json');
function tsconfigHas(distDir: string): boolean {
  try { return fs.readFileSync(TSCONFIG, 'utf8').includes(`${distDir}/types/`); } catch { return true; }
}
function restoreTsconfig(distDir: string) {
  try {
    const cfg = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8')) as { include?: string[] };
    if (!cfg.include) return;
    const kept = cfg.include.filter((x) => x !== `${distDir}/types/**/*.ts`);
    if (kept.length === cfg.include.length) return;
    cfg.include = kept;
    fs.writeFileSync(TSCONFIG, JSON.stringify(cfg, null, 2) + '\n');
  } catch {  }
}

export async function startServer(o: StartOptions): Promise<RunningServer> {
  const hadTsEntry = tsconfigHas(o.distDir);
  if (!(await portFree(o.port))) throw new Failure(`Port ${o.port} is already in use. Stop whatever is using it and re-run.`);
  fs.mkdirSync(o.dataDir, { recursive: true });
  const args = [NEXT_BIN, o.mode === 'start' ? 'start' : 'dev', '-p', String(o.port), '-H', '127.0.0.1'];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_DIST_DIR: o.distDir,
    CERTFLOW_DATA_DIR: o.dataDir,
    CERTFLOW_BASE_URL: `http://127.0.0.1:${o.port}`,
    NEXT_TELEMETRY_DISABLED: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    ...(o.env ?? {}),
  } as NodeJS.ProcessEnv;
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  delete (env as Record<string, string | undefined>).NODE_ENV;
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  let buf = '';
  child.stdout?.on('data', (d: Buffer) => { buf += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { buf += d.toString(); });
  let exited: number | null = null;
  child.on('exit', (c) => { exited = c ?? -1; });

  const server: RunningServer = {
    port: o.port, base: `http://127.0.0.1:${o.port}`, dataDir: o.dataDir, distDir: o.distDir,
    logs: () => buf,
    async stop() {
      live.delete(server);
      killTree(child);
      for (let i = 0; i < 50 && !(await portFree(o.port)); i++) await new Promise((r) => setTimeout(r, 100));
      if (!hadTsEntry) restoreTsconfig(o.distDir);
    },
  };
  live.add(server);
  if (!hooked) {
    hooked = true;
    const bye = () => { for (const s of live) void s.stop(); };
    process.on('exit', () => { for (const s of live) { void s.stop(); } if (!hadTsEntry) restoreTsconfig(o.distDir); });
    process.on('SIGINT', () => { bye(); process.exit(130); });
    process.on('SIGTERM', () => { bye(); process.exit(143); });
  }

  const deadline = Date.now() + (o.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    if (exited !== null) { await server.stop(); throw new Failure(`The server exited early (code ${exited}):\n${buf.slice(-3000)}`); }
    if (/Ready in|✓ Ready|started server on/i.test(buf)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!/Ready in|✓ Ready|started server on/i.test(buf)) { await server.stop(); throw new Failure(`The server did not become ready in time:\n${buf.slice(-3000)}`); }
  return server;
}

export interface Reply { status: number; headers: Headers; text: string; json: any; setCookies: string[]; location: string | null }

export interface ReqOptions {
  method?: string;
  cookie?: string | null;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function http(base: string, pathAndQuery: string, o: ReqOptions = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  let body = o.body;
  if (o.json !== undefined) { body = JSON.stringify(o.json); headers['content-type'] = 'application/json'; }
  const res = await fetch(base + pathAndQuery, { method: o.method ?? 'GET', headers, body, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 180_000) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {  }
  const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return { status: res.status, headers: res.headers, text, json, setCookies, location: res.headers.get('location') };
}

export async function httpBytes(base: string, pathAndQuery: string, o: ReqOptions = {}): Promise<{ status: number; headers: Headers; bytes: Buffer }> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(base + pathAndQuery, { method: o.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 180_000) });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmrf(p: string) {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {  }
}

export function cleanDist(distDir: string) {
  if (process.env.CERTFLOW_KEEP_DIST === '1') return;
  rmrf(path.join(ROOT, distDir));
}

export function sessionCookie(value: string): string {
  return `cf_session=${value}`;
}

export function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function routeUrl(file: string, kind: 'route' | 'page', sample = 'x'): string {
  const appDir = path.join(ROOT, 'src', 'app');
  const rel = path.relative(appDir, path.dirname(file)).split(path.sep);
  const segs = rel
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
    .map((s) => (/^\[\[?\.\.\.(.+?)\]?\]$/.test(s) ? sample : /^\[(.+)\]$/.test(s) ? sample : s));
  void kind;
  return '/' + segs.join('/');
}

export function exportedMethods(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const methods = new Set<string>();
  const M = '(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)';
  for (const m of src.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+${M}\\b`, 'g'))) methods.add(m[1]);
  for (const m of src.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+${M}\\b`, 'g'))) methods.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    const names = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()!.trim()).filter((n) => new RegExp(`^${M}$`).test(n));
    if (m[2]?.startsWith('.')) {
      const target = ['.ts', '/route.ts', '.tsx'].map((ext) => path.resolve(path.dirname(file), m[2] + ext)).find((p) => fs.existsSync(p));
      if (target) {
        const inner = new Set(exportedMethods(target, seen));
        for (const n of names) if (inner.has(n)) methods.add(n);
        continue;
      }
    }
    names.forEach((n) => methods.add(n));
  }
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = ['.ts', '/route.ts'].map((ext) => path.resolve(path.dirname(file), m[1] + ext)).find((p) => fs.existsSync(p));
    if (target) exportedMethods(target, seen).forEach((x) => methods.add(x));
  }
  return [...methods];
}
