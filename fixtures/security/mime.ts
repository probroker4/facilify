export interface MimePart {
  headers: Map<string, string>;
  contentType: string;
  params: Record<string, string>;
  filename?: string;
  disposition?: string;
  body: Buffer;
  parts: MimePart[];
}

function decodeQuotedPrintable(s: string): Buffer {
  const cleaned = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) { bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(cleaned.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

export function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
    const buf = enc.toLowerCase() === 'b' ? Buffer.from(text, 'base64') : decodeQuotedPrintable(text.replace(/_/g, ' '));
    try { return new TextDecoder(charset.toLowerCase() === 'utf-8' ? 'utf-8' : charset).decode(buf); } catch { return buf.toString('utf8'); }
  }).replace(/(\S)\s+(?=\S)/g, '$1 ').trim();
}

function parseParams(v: string): { value: string; params: Record<string, string> } {
  const segs: string[] = [];
  let cur = '', q = false;
  for (const ch of v) {
    if (ch === '"') q = !q;
    if (ch === ';' && !q) { segs.push(cur); cur = ''; } else cur += ch;
  }
  segs.push(cur);
  const params: Record<string, string> = {};
  for (const s of segs.slice(1)) {
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim().toLowerCase();
    let val = s.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
    if (k.endsWith('*')) {
      const m = /^([^']*)'[^']*'(.*)$/.exec(val);
      if (m) { try { val = decodeURIComponent(m[2]); } catch { val = m[2]; } }
      params[k.slice(0, -1)] = val;
    } else params[k] = val;
  }
  return { value: segs[0].trim().toLowerCase(), params };
}

export function parseMime(raw: Buffer): MimePart {
  const text = raw.toString('latin1');
  let sep = text.indexOf('\r\n\r\n');
  let sepLen = 4;
  if (sep < 0) { sep = text.indexOf('\n\n'); sepLen = 2; }
  const headText = sep < 0 ? text : text.slice(0, sep);
  const bodyLatin1 = sep < 0 ? '' : text.slice(sep + sepLen);
  const headers = new Map<string, string>();
  for (const line of headText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = Buffer.from(line.slice(i + 1).trim(), 'latin1').toString('utf8');
    headers.set(k, headers.has(k) ? `${headers.get(k)}, ${v}` : v);
  }
  const ct = parseParams(headers.get('content-type') ?? 'text/plain');
  const cd = parseParams(headers.get('content-disposition') ?? '');
  const filename = cd.params.filename ?? ct.params.name;
  const part: MimePart = {
    headers, contentType: ct.value, params: ct.params, filename: filename ? decodeWords(filename) : undefined,
    disposition: cd.value || undefined, body: Buffer.alloc(0), parts: [],
  };
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    const b = ct.params.boundary;
    const chunks = bodyLatin1.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
    for (const chunk of chunks.slice(1)) {
      if (!chunk.trim()) continue;
      part.parts.push(parseMime(Buffer.from(chunk, 'latin1')));
    }
    return part;
  }
  const enc = (headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase();
  if (enc === 'base64') part.body = Buffer.from(bodyLatin1.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  else if (enc === 'quoted-printable') part.body = decodeQuotedPrintable(bodyLatin1);
  else part.body = Buffer.from(bodyLatin1, 'latin1');
  return part;
}

export function allParts(p: MimePart, out: MimePart[] = []): MimePart[] {
  out.push(p);
  p.parts.forEach((c) => allParts(c, out));
  return out;
}

export interface ParsedEmail {
  to: string[];
  cc: string[];
  bcc: string[];
  from: string;
  subject: string;
  messageId: string;
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; content: Buffer }[];
  headers: Map<string, string>;
}

export function parseEmail(raw: Buffer): ParsedEmail {
  const root = parseMime(raw);
  const parts = allParts(root).filter((p) => p.parts.length === 0);
  const list = (h: string) => (root.headers.get(h) ?? '').split(',').map((s) => decodeWords(s)).map((s) => /<([^>]+)>/.exec(s)?.[1] ?? s.trim()).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const html = parts.find((p) => p.contentType === 'text/html' && p.disposition !== 'attachment')?.body.toString('utf8') ?? '';
  const text = parts.find((p) => p.contentType === 'text/plain' && p.disposition !== 'attachment')?.body.toString('utf8') ?? '';
  return {
    to: list('to'), cc: list('cc'), bcc: list('bcc'), from: decodeWords(root.headers.get('from') ?? ''),
    subject: decodeWords(root.headers.get('subject') ?? ''), messageId: root.headers.get('message-id') ?? '',
    html, text,
    attachments: parts.filter((p) => p.disposition === 'attachment' || (p.filename && !p.contentType.startsWith('text/'))).map((p) => ({ filename: p.filename ?? '', contentType: p.contentType, content: p.body })),
    headers: root.headers,
  };
}
