import fs from 'node:fs';
import path from 'node:path';
import type { CertStorage, RenderedCert, StoredCert } from '@/lib/contracts';
import { safeFolderName } from './folders';

export class LocalStorage implements CertStorage {
  name = 'local' as const;
  private indexFile: string;
  constructor(public root: string, private linkFor: (certId: string) => string = (id) => `/api/files/${id}`) {
    fs.mkdirSync(root, { recursive: true });
    this.indexFile = path.join(root, '.certflow-index.json');
  }

  private readIndex(): Record<string, string> {
    try { return JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); } catch { return {}; }
  }

  private writeIndex(idx: Record<string, string>) {
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(idx, null, 1));
    fs.renameSync(tmp, this.indexFile);
  }

  pathOf(certId: string): string | null {
    const rel = this.readIndex()[certId];
    return rel ? path.join(this.root, ...rel.split('/')) : null;
  }

  async saveFile(certId: string, fileName: string, content: Uint8Array, folderPath: string[]): Promise<StoredCert> {
    const segs = folderPath.map(safeFolderName).filter(Boolean);
    const dir = path.join(this.root, ...segs);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(fileName));
    const idx = this.readIndex();
    const prev = idx[certId] ? path.join(this.root, ...idx[certId].split('/')) : null;
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
    if (prev && path.resolve(prev) !== path.resolve(target)) fs.rmSync(prev, { force: true });
    idx[certId] = path.relative(this.root, target).split(path.sep).join('/');
    this.writeIndex(idx);
    return { certId, driveFileId: idx[certId], webViewLink: this.linkFor(certId), folderPath: segs.join('/') };
  }

  save(c: Pick<RenderedCert, 'certId' | 'fileName' | 'pdf'>, folderPath: string[]): Promise<StoredCert> {
    return this.saveFile(c.certId, c.fileName, c.pdf, folderPath);
  }
}
