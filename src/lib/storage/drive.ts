import type { CertStorage, RenderedCert, StoredCert } from '@/lib/contracts';
import { StorageError } from '@/lib/contracts';
import { safeFileName, safeFolderName } from './folders';

export interface DriveOptions {
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  rootFolderId?: string;
  apiBase?: string;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const RECONNECT = 'Facilify lost permission to your Google Drive. Go to Settings and click "Reconnect Google", then retry the failed certificates.';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class DriveApiError extends StorageError {
  constructor(msg: string, transient: boolean, userMessage: string | undefined, public status: number, public reason: string, public retryable = false) {
    super(msg, transient, userMessage);
    this.name = 'StorageError';
  }
}

interface DriveFile { id: string; name?: string; parents?: string[]; webViewLink?: string }
const FILE_FIELDS = 'id,name,parents,webViewLink';

export class DriveStorage implements CertStorage {
  name = 'drive' as const;
  private folderIds = new Map<string, Promise<string>>();
  private certLocks = new Map<string, Promise<unknown>>();
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private api: string;
  private forceRefresh = false;

  constructor(private o: DriveOptions) {
    this.f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.api = (o.apiBase ?? 'https://www.googleapis.com').replace(/\/+$/, '');
  }

  private get attempts(): number { return Math.max(1, this.o.maxAttempts ?? 5); }

  private backoff(i: number, retryAfterMs = 0): number {
    const base = this.o.baseDelayMs ?? 500;
    const d = Math.min(base * 2 ** i, 32_000);
    return Math.max(d + Math.floor(Math.random() * (d / 4)), Math.min(retryAfterMs, 60_000));
  }

  private async toError(res: Response): Promise<DriveApiError> {
    let reason = '';
    let message = '';
    try {
      const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
      reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? '';
      message = j.error?.message ?? '';
    } catch {  }
    const s = res.status;
    const tech = `Google Drive ${s}${reason ? ` ${reason}` : ''}${message ? `: ${message}` : ''}`;
    if (s === 429 || s >= 500 || (s === 403 && /^(rateLimitExceeded|userRateLimitExceeded|sharingRateLimitExceeded|backendError)$/i.test(reason))) {
      return new DriveApiError(tech, true, 'Google Drive is busy right now. Facilify will try again in a moment.', s, reason, true);
    }
    if (s === 403 && /dailyLimitExceeded/i.test(reason)) {
      return new DriveApiError(tech, true, 'Google Drive\'s daily limit was reached. Try the remaining certificates again tomorrow.', s, reason);
    }
    if (s === 403 && /storageQuotaExceeded|quotaExceeded/i.test(reason)) {
      return new DriveApiError(tech, false, 'Your Google Drive is full. Free up space in Drive, then retry the failed certificates.', s, reason);
    }
    if (s === 401 || (s === 403 && /insufficient|forbidden|appNotAuthorized|authError|accessNotConfigured|PERMISSION_DENIED/i.test(reason))) {
      return new DriveApiError(tech, false, RECONNECT, s, reason);
    }
    if (s === 403) return new DriveApiError(tech, false, RECONNECT, s, reason);
    if (s === 404) return new DriveApiError(tech, false, 'A Drive folder Facilify was using was deleted. Retry and Facilify will create it again.', s, reason);
    return new DriveApiError(tech, false, 'Google Drive rejected the file. Retry, and if it keeps failing switch storage to "Local folder" in Settings.', s, reason);
  }

  private async call<T>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
    let refreshedHere = false;
    for (let i = 0; ; i++) {
      let res: Response;
      try {
        const token = await this.o.getAccessToken(this.forceRefresh);
        this.forceRefresh = false;
        res = await this.f(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
      } catch (e) {
        if (e instanceof StorageError) throw e;
        const err = new DriveApiError(`Could not reach Google Drive: ${(e as Error)?.message ?? e}`, true,
          'Could not reach Google Drive. Check the internet connection; Facilify will retry.', 0, 'network', true);
        if (!retry || i + 1 >= this.attempts) throw err;
        await this.sleep(this.backoff(i));
        continue;
      }
      if (res.ok) {
        if (res.status === 204) return null as T;
        const text = await res.text();
        try { return (text ? JSON.parse(text) : null) as T; } catch {
          throw new DriveApiError('Google Drive returned an unreadable response.', true, 'Google Drive is busy right now. Facilify will try again in a moment.', res.status, 'badResponse', false);
        }
      }
      if (res.status === 401 && !refreshedHere) {
        refreshedHere = true;
        this.forceRefresh = true;
        await res.body?.cancel().catch(() => undefined);
        i--;
        continue;
      }
      const err = await this.toError(res);
      if (!err.retryable || !retry || i + 1 >= this.attempts) {
        if (err.retryable && retry) err.message = `${err.message} (gave up after ${i + 1} attempts)`;
        throw err;
      }
      const ra = Number(res.headers.get('retry-after'));
      await this.sleep(this.backoff(i, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0));
    }
  }

  private async findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      const found = await find();
      if (found) return found;
      try {
        return await create();
      } catch (e) {
        if (!(e instanceof DriveApiError) || !e.retryable || i + 1 >= this.attempts) throw e;
        await this.sleep(this.backoff(i));
      }
    }
  }

  private ensureFolder(parentId: string, name: string): Promise<string> {
    const key = JSON.stringify([parentId, name]);
    let p = this.folderIds.get(key);
    if (!p) {
      p = this.findOrCreate<string>(
        async () => {
          const query = `mimeType='${FOLDER_MIME}' and name='${q(name)}' and '${q(parentId)}' in parents and trashed=false`;
          const found = await this.call<{ files?: DriveFile[] }>(
            `${this.api}/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}&orderBy=createdTime&pageSize=1&spaces=drive`);
          return found?.files?.[0]?.id ?? null;
        },
        async () => {
          const created = await this.call<DriveFile>(`${this.api}/drive/v3/files?fields=id`, {
            method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
          }, false);
          if (!created?.id) throw new DriveApiError('Google Drive did not return the new folder id.', true, undefined, 200, 'badResponse');
          return created.id;
        },
      );
      p.catch(() => { if (this.folderIds.get(key) === p) this.folderIds.delete(key); });
      this.folderIds.set(key, p);
    }
    return p;
  }

  static cleanPath(folderPath: string[]): string[] {
    return folderPath.map(safeFolderName).filter(Boolean);
  }

  async folderId(folderPath: string[]): Promise<string> {
    let parent = this.o.rootFolderId ?? 'root';
    for (const name of DriveStorage.cleanPath(folderPath)) parent = await this.ensureFolder(parent, name);
    return parent;
  }

  clearFolderCache(): void { this.folderIds.clear(); }

  private multipart(meta: object, content: Uint8Array, mime: string): { body: Uint8Array; type: string } {
    const boundary = `certflow_${crypto.randomUUID().replace(/-/g, '')}`;
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + content.length + tail.length);
    body.set(head, 0);
    body.set(content, head.length);
    body.set(tail, head.length + content.length);
    return { body, type: `multipart/related; boundary=${boundary}` };
  }

  private async findByCertId(certId: string): Promise<DriveFile | null> {
    const query = `appProperties has { key='certId' and value='${q(certId)}' } and trashed=false`;
    const r = await this.call<{ files?: DriveFile[] }>(
      `${this.api}/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}&orderBy=createdTime&pageSize=1&spaces=drive`);
    return r?.files?.[0] ?? null;
  }

  private withCertLock<T>(certId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.certLocks.get(certId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.certLocks.set(certId, tail);
    tail.then(() => { if (this.certLocks.get(certId) === tail) this.certLocks.delete(certId); });
    return run;
  }

  saveFile(certId: string, fileName: string, content: Uint8Array, mime: string, folderPath: string[]): Promise<StoredCert> {
    if (!certId) return Promise.reject(new StorageError('certId is required to save to Drive', false));
    return this.withCertLock(certId, async () => {
      try {
        return await this.saveFileOnce(certId, fileName, content, mime, folderPath);
      } catch (e) {
        if (e instanceof DriveApiError && e.status === 404) {
          this.clearFolderCache();
          return this.saveFileOnce(certId, fileName, content, mime, folderPath);
        }
        throw e;
      }
    });
  }

  private async saveFileOnce(certId: string, fileName: string, content: Uint8Array, mime: string, folderPath: string[]): Promise<StoredCert> {
    const segs = DriveStorage.cleanPath(folderPath);
    const name = safeFileName(fileName, certId);
    const parent = await this.folderId(segs);
    const existing = await this.findByCertId(certId);
    let file: DriveFile;
    if (existing) {
      const oldParents = existing.parents ?? [];
      const remove = oldParents.filter((p) => p !== parent);
      const moves = oldParents.includes(parent) ? '' : `&addParents=${encodeURIComponent(parent)}${remove.length ? `&removeParents=${encodeURIComponent(remove.join(','))}` : ''}`;
      const { body, type } = this.multipart({ name, mimeType: mime }, content, mime);
      file = await this.call<DriveFile>(`${this.api}/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}${moves}`, {
        method: 'PATCH', headers: { 'Content-Type': type }, body: Buffer.from(body),
      });
    } else {
      file = await this.findOrCreate<DriveFile>(
        () => this.findByCertId(certId),
        () => {
          const { body, type } = this.multipart({ name, parents: [parent], mimeType: mime, appProperties: { certId, app: 'certflow' } }, content, mime);
          return this.call<DriveFile>(`${this.api}/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`, {
            method: 'POST', headers: { 'Content-Type': type }, body: Buffer.from(body),
          }, false);
        },
      );
      if (file.name !== name || (file.parents && !file.parents.includes(parent))) {
        return this.saveFileOnce(certId, fileName, content, mime, folderPath);
      }
    }
    if (!file?.id) throw new DriveApiError('Google Drive did not return the file id.', true, undefined, 200, 'badResponse');
    return {
      certId,
      driveFileId: file.id,
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      folderPath: segs.join('/'),
    };
  }

  save(c: Pick<RenderedCert, 'certId' | 'fileName' | 'pdf'>, folderPath: string[]): Promise<StoredCert> {
    return this.saveFile(c.certId, c.fileName, c.pdf, 'application/pdf', folderPath);
  }

  saveReport(csv: string | Uint8Array, folderPath: string[], fileName = 'certflow-report.csv', reportId?: string): Promise<StoredCert> {
    const bytes = typeof csv === 'string' ? new TextEncoder().encode(csv) : csv;
    const id = reportId ?? `report:${DriveStorage.cleanPath(folderPath).join('/')}/${safeFileName(fileName, 'report')}`;
    return this.saveFile(id, fileName, bytes, 'text/csv', folderPath);
  }
}
