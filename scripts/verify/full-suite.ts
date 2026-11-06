import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const tscCli = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

const CASES: Record<string, string[]> = {
  ingest: ['parse', 'validate', 'email-select', 'automap', 'perf', 'typed-headings'],
  routing: ['discover', 'assign', 'conditions', 'multi-award', 'overrides', 'scheme'],
  render: ['personalize', 'templates', 'overlay-only', 'styles', 'naming', 'metadata-qr', 'fit-unicode-perf', 'fonts', 'uniform-fit'],
  mail: ['compose', 'guard', 'gmail', 'smtp', 'footer-links'],
  share: ['add-to-profile', 'share-post', 'customize'],
  pipeline: ['states', 'failures', 'duplicates', 'resume', 'bulk-quota', 'report'],
  security: ['authz', 'tokens', 'uploads', 'purge'],
  storage: ['save', 'folders', 'idempotent', 'errors', 'local'],
  tickets: ['submit', 'inbox', 'reissue', 'notify'],
  editor: ['controls', 'wysiwyg', 'helpers', 'font-search', 'colour'],
  ui: ['a11y', 'e2e'],
  demo: ['help', 'readme', 'cross-platform'],
};

function run(label: string, args: string[], env: Record<string, string | undefined> = {}): boolean {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!ok) console.log(`${(r.stdout ?? '').slice(-1500)}\n${(r.stderr ?? '').slice(-1500)}`);
  return ok;
}

const only = process.argv.includes('--quick') ? ['ingest', 'routing', 'mail', 'share', 'storage'] : Object.keys(CASES);
let ok = run('typecheck', [tscCli, '--noEmit', '-p', '.']);
ok = run('production build', [nextCli, 'build'], { NEXT_DIST_DIR: '.next-suite' }) && ok;
for (const area of only) for (const c of CASES[area]) ok = run(`${area} ${c}`, [tsxCli, path.join('scripts', 'verify', `${area}.ts`), '--case', c]) && ok;
ok = run('core integration', [tsxCli, path.join('scripts', 'verify', 'core-integration.ts')]) && ok;
if (!ok) { console.error('FULL SUITE FAILED'); process.exit(1); }
console.log('FULL SUITE OK');
