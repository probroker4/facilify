import fs from 'node:fs';

const realFetch = globalThis.fetch;
const logFile = process.env.CERTFLOW_FAKE_GOOGLE_LOG;
const B64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let driveSeq = 0;
const driveFiles = new Map();

function log(entry) {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, JSON.stringify({ at: Date.now(), ...entry }) + '\n'); } catch {  }
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async function fakeAwareFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let u;
  try { u = new URL(url); } catch { return realFetch(input, init); }
  const method = (init?.method ?? (typeof input === 'object' && input.method) ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers ?? {});
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
    const body = new URLSearchParams(String(init?.body ?? ''));
    log({ kind: 'token', grant: body.get('grant_type'), hasRefresh: !!body.get('refresh_token'), hasCode: !!body.get('code') });
    if (body.get('grant_type') === 'authorization_code') {
      const spec = new URLSearchParams(body.get('code') ?? '');
      const email = spec.get('email') || process.env.CERTFLOW_FAKE_GOOGLE_EMAIL || 'organizer@gmail.test';
      const id_token = `${B64({ alg: 'none' })}.${B64({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: 'google-sub-1', email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 3000 })}.sig`;
      return json({
        access_token: 'ya29.FAKE-ACCESS-TOKEN-SENTINEL', expires_in: 3599, token_type: 'Bearer', id_token,
        refresh_token: process.env.CERTFLOW_FAKE_REFRESH_TOKEN || '1//FAKE-REFRESH-TOKEN-SENTINEL',
        scope: spec.get('scope') || process.env.CERTFLOW_FAKE_GRANTED_SCOPES || 'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.file',
      });
    }
    if (body.get('grant_type') === 'refresh_token') return json({ access_token: 'ya29.FAKE-ACCESS-TOKEN-SENTINEL', expires_in: 3599, token_type: 'Bearer' });
    return json({ error: 'unsupported_grant_type' }, 400);
  }
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') { log({ kind: 'revoke' }); return json({}); }
  if (u.hostname === 'gmail.googleapis.com') {
    log({ kind: 'gmail', method, path: u.pathname, auth: headers.get('authorization') ?? '' });
    return json({ id: `fake-msg-${Date.now()}`, threadId: 't' });
  }
  if (u.hostname.endsWith('googleapis.com') && u.pathname.includes('/drive/')) {
    log({ kind: 'drive', method, path: u.pathname, auth: headers.get('authorization') ?? '' });
    if (method === 'GET') return json({ files: [] });
    return json({ id: `fake-drive-${++driveSeq}`, name: 'x', webViewLink: 'https://drive.google.com/file/d/fake/view' });
  }
  return realFetch(input, init);
};
void driveFiles;
