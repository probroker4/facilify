import fs from 'node:fs';
import path from 'node:path';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

async function main() {
  const dataDir = arg('data');
  const batchId = arg('batch');
  const org = arg('org');
  const mode = arg('mode');
  const after = Number(arg('after'));
  const markers = arg('markers');
  const storeDir = arg('store');
  const outboxDir = arg('outbox');
  process.env.CERTFLOW_DATA_DIR = dataDir;
  fs.mkdirSync(markers, { recursive: true });
  fs.writeFileSync(path.join(markers, `${mode}.pid`), String(process.pid));

  const { openDb, get } = await import('@/lib/db');
  const { buildRunnerDeps } = await import('@/lib/pipeline/services');
  const { runBatch } = await import('@/lib/pipeline/runner');
  const { CaptureTransport } = await import('@/lib/mail');
  const { LocalStorage } = await import('@/lib/storage');
  type OutboundMail = import('@/lib/contracts').OutboundMail;

  const db = openDb();
  const batch = get<import('@/lib/db/repo').BatchRow>(db, 'SELECT * FROM batches WHERE id = ?', batchId)!;
  const capture = new CaptureTransport(outboxDir);
  const store = new LocalStorage(storeDir);
  const mark = (name: string) => fs.writeFileSync(path.join(markers, `${mode}-${name}.marker`), String(Date.now()));
  const hang = () => new Promise<never>(() => { setInterval(() => undefined, 1 << 30); });

  let saves = 0;
  const storage = {
    name: 'local' as const,
    async save(c: { certId: string; fileName: string; pdf: Uint8Array }, folder: string[]) {
      if (mode !== 'save-hang') return store.save(c, folder);
      const n = ++saves;
      if (n < after) return store.save(c, folder);
      if (n === after) { const r = await store.save(c, folder); mark(`saved-${n}`); await hang(); return r; }
      mark(`before-${n}`);
      return hang();
    },
  };
  let sends = 0;
  const transport = {
    name: 'capture' as const,
    async send(m: OutboundMail) {
      if (mode !== 'send-hang') return capture.send(m);
      const n = ++sends;
      await new Promise((r) => setTimeout(r, 5));
      if (n < after) return capture.send(m);
      if (n === after || n === after + 2) { await capture.send(m); mark(`delivered-${n}`); return hang(); }
      mark(`undelivered-${n}`);
      return hang();
    },
    wasSent: (id: string) => capture.wasSent(id),
  };

  const deps = buildRunnerDeps(db, org, batch, { transport, storage, sleep: async () => undefined });
  await runBatch(batchId, deps);
  console.log('CHILD FINISHED WITHOUT HANGING');
}

main().catch((e) => { console.error(e); process.exit(3); });
