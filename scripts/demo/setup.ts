import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEMO_EMAIL = 'demo@certflow.local';
const ORG_NAME = 'Demo College Tech Club';

export interface SetupResult { dataDir: string; email: string; password: string | null; created: boolean; samples: string[] }

function friendlyPassword(): string {
  const words = ['maple', 'river', 'cobalt', 'lantern', 'meadow', 'falcon', 'orchid', 'harbor', 'sunrise', 'pebble'];
  const w = () => words[crypto.randomInt(words.length)];
  return `${w()}-${w()}-${crypto.randomInt(100, 1000)}`;
}

export async function runSetup(opts: { quiet?: boolean } = {}): Promise<SetupResult> {
  const say = (s = '') => { if (!opts.quiet) console.log(s); };

  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`Facilify needs Node 22.13 or newer, but this computer has ${process.versions.node}. Install the current LTS from https://nodejs.org and try again.`);
  }

  const { dataDir } = await import('../../src/lib/paths');
  const { masterSecret } = await import('../../src/lib/secrets/crypto');
  const { openDb, nowIso, get, run } = await import('../../src/lib/db');
  const { setSetting, getSetting } = await import('../../src/lib/db');
  const { hashPassword } = await import('../../src/lib/auth/password');
  const { SAMPLE_SHEET_CSV, DIRTY_SAMPLE_CSV } = await import('../../src/content/help');

  const dir = dataDir();
  masterSecret();
  for (const sub of ['samples', 'outbox', 'certificates', 'uploads']) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  const db = openDb();
  let organizer = get<{ id: string }>(db, 'SELECT id FROM organizers WHERE email = ?', DEMO_EMAIL);
  let password: string | null = null;
  let created = false;
  if (!organizer) {
    password = process.env.CERTFLOW_DEMO_PASSWORD || friendlyPassword();
    const id = `org_${crypto.randomBytes(9).toString('base64url')}`;
    run(db, 'INSERT INTO organizers (id, email, name, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      id, DEMO_EMAIL, 'Demo Organizer', hashPassword(password), nowIso());
    organizer = { id };
    created = true;
  }

  if (getSetting(db, organizer.id, 'org') === undefined) setSetting(db, organizer.id, 'org', { name: ORG_NAME, email: DEMO_EMAIL, linkedInEnabled: true });
  if (getSetting(db, organizer.id, 'sender') === undefined) setSetting(db, organizer.id, 'sender', { kind: 'capture' });
  if (getSetting(db, organizer.id, 'storage') === undefined) setSetting(db, organizer.id, 'storage', 'local');

  const samples = [
    path.join(dir, 'samples', 'sample-students.csv'),
    path.join(dir, 'samples', 'sample-with-mistakes.csv'),
  ];
  fs.writeFileSync(samples[0], SAMPLE_SHEET_CSV);
  fs.writeFileSync(samples[1], DIRTY_SAMPLE_CSV);

  const devEnv = path.join(process.cwd(), '.env.development.local');
  try {
    const have = fs.existsSync(devEnv) ? fs.readFileSync(devEnv, 'utf8') : '';
    if (!/^CERTFLOW_PASSWORD_LOGIN=/m.test(have)) fs.appendFileSync(devEnv, `${have && !have.endsWith('\n') ? '\n' : ''}CERTFLOW_PASSWORD_LOGIN=1\n`);
  } catch {  }

  const url = (process.env.CERTFLOW_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  say();
  say('Facilify is ready.');
  say('------------------------------------------------------------');
  if (created) {
    say(`  Open ${url} and sign in with:`);
    say(`    Email:    ${DEMO_EMAIL}`);
    say(`    Password: ${password}`);
    say('  (Write this down. It is shown only this once.)');
  } else {
    say(`  Open ${url} and sign in as ${DEMO_EMAIL}`);
    say('  (Your demo account already exists. Password unchanged.)');
  }
  say();
  say('  Try it: choose "Download sample sheet" in step 1, or upload');
  say(`    ${samples[0]}`);
  say('  Emails go to the Test outbox, so nobody is emailed. Find them in:');
  say(`    ${path.join(dir, 'outbox')}`);
  say('------------------------------------------------------------');
  say();

  return { dataDir: dir, email: DEMO_EMAIL, password, created, samples };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === path.resolve(__filename ?? '') || /scripts[\\/]demo[\\/]setup\.ts$/.test(invoked)) {
  runSetup().then(() => process.exit(0)).catch((err) => {
    console.error(`\nSetup could not finish: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
