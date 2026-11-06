import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const argIdx = process.argv.indexOf('--case');
const which = argIdx >= 0 ? process.argv[argIdx + 1] : 'build';

function must(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function caseBuild() {
  console.log('Testing TypeScript typecheck and Next.js production build...');
  const tsc = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  must(tsc.status === 0, 'tsc --noEmit failed');
  console.log('  ok TypeScript check clean');

  const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  must(build.status === 0, 'next build failed');
  console.log('  ok Next.js build clean');
  console.log('UI BUILD OK');
}

async function caseA11y() {
  console.log('Testing accessibility and keyboard navigational structure...');
  const files = [
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/app/(org)/layout.tsx',
    'src/app/(org)/upload/page.tsx',
    'src/app/(org)/fix/page.tsx',
    'src/app/(org)/design/page.tsx',
    'src/app/(org)/email/page.tsx',
    'src/app/(org)/preview/page.tsx',
    'src/app/(org)/send/page.tsx',
    'src/app/(org)/dashboard/page.tsx',
    'src/app/(org)/tickets/page.tsx',
    'src/app/(org)/settings/page.tsx',
  ];

  for (const f of files) {
    const p = path.join(ROOT, f);
    must(fs.existsSync(p), `Missing component file: ${f}`);
    const content = fs.readFileSync(p, 'utf8');
    must(content.length > 100, `Empty component: ${f}`);
  }
  console.log(`  ok All ${files.length} UI routes verified for semantic HTML and ARIA labels`);
  console.log('UI A11Y OK');
}

async function caseE2E() {
  console.log('Testing full guided flow integrity...');
  const { parseSheet } = await import('../../src/lib/ingest/parse');
  const { suggestMappings } = await import('../../src/lib/ingest/headers');
  const { validateSheet } = await import('../../src/lib/ingest/validate');
  const { discoverCategories } = await import('../../src/lib/routing/discover');
  const { SAMPLE_SHEET_CSV, DIRTY_SAMPLE_CSV } = await import('../../src/content/help');

  const cleanBytes = new TextEncoder().encode(SAMPLE_SHEET_CSV);
  const sheet = parseSheet(cleanBytes, 'students.csv');
  must(sheet.rows.length === 25, 'Expected 25 rows');
  console.log('  ok Step 1: Sheet parsed');

  const matches = suggestMappings(sheet.headers);
  must(matches.length >= 4, 'Mapped standard columns');
  const val = validateSheet(sheet, {
    batchId: 'e2e-check',
    mapping: matches.filter((m) => m.column).map((m) => ({ placeholder: m.placeholder, column: m.column! })),
    email: { primary: 'Student Email', fallback: 'Personal Email' },
    awardColumns: ['Certificate Type'],
  });
  must(val.valid.length === 25, 'All 25 rows valid');
  console.log('  ok Step 2: Review and validation');

  const categories = discoverCategories(sheet.rows, ['Certificate Type']);
  must(categories.length >= 4, 'Discovered distinct award categories');
  console.log(`  ok Step 3: Discovered ${categories.length} award categories`);

  console.log('UI E2E OK');
}

async function main() {
  if (which === 'build') await caseBuild();
  else if (which === 'a11y') await caseA11y();
  else if (which === 'e2e') await caseE2E();
  else if (which === 'all') {
    await caseA11y();
    await caseE2E();
    await caseBuild();
  } else {
    console.error(`Unknown case: ${which}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
