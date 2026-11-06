import fs from 'node:fs';
import path from 'node:path';

export function dataDir(): string {
  if (process.env.CERTFLOW_DATA_DIR) {
    const d = path.resolve(process.env.CERTFLOW_DATA_DIR);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const d = path.join('/tmp', 'certflow-data');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  try {
    const d = path.resolve(path.join(process.cwd(), 'data'));
    fs.mkdirSync(d, { recursive: true });
    return d;
  } catch (err: any) {
    if (err?.code === 'EROFS' || err?.code === 'EACCES') {
      const d = path.join('/tmp', 'certflow-data');
      fs.mkdirSync(d, { recursive: true });
      return d;
    }
    throw err;
  }
}

export function subDir(...parts: string[]): string {
  const d = path.join(dataDir(), ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function baseUrl(): string {
  if (process.env.CERTFLOW_BASE_URL) {
    return process.env.CERTFLOW_BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}
