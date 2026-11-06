import { spawnSync } from 'node:child_process';

function gh(args: string[]): string {
  const r = spawnSync('gh', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`gh ${args.join(' ')} failed: ${r.stderr || r.error}`); process.exit(1); }
  return r.stdout;
}

const runs = JSON.parse(gh(['run', 'list', '--workflow', 'ci.yml', '--limit', '1', '--json', 'databaseId,conclusion,status,headSha'])) as { databaseId: number; conclusion: string; status: string }[];
if (!runs.length) { console.error('No CI runs found. Push the repository to GitHub so the workflow runs.'); process.exit(1); }
const jobs = JSON.parse(gh(['run', 'view', String(runs[0].databaseId), '--json', 'jobs'])).jobs as { name: string; conclusion: string }[];
for (const os of ['ubuntu', 'windows', 'macos']) {
  const mine = jobs.filter((j) => j.name.toLowerCase().includes(os));
  if (!mine.length) { console.error(`no CI job for ${os}`); process.exit(1); }
  const bad = mine.filter((j) => j.conclusion !== 'success');
  if (bad.length) { console.error(`${os}: ${bad.map((j) => `${j.name}=${j.conclusion}`).join(', ')}`); process.exit(1); }
  console.log(`${os}: ${mine.length} job(s) passed`);
}
console.log('CI MATRIX OK');
