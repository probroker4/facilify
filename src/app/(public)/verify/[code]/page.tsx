'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { PageLoading } from '@/components/ui/card';
import { api, ApiError, errorText } from '@/components/wizard/api';

interface Verified {
  valid: boolean; revoked: boolean; name: string; event: string; award: string; date: string; issuer: string; code: string;
  imageUrl: string; pdfUrl: string;
  issuedAt: string; sha256: string;
  proof: { algorithm: string; message: string; signature: string; publicKey: string };
  linkedIn: { enabled: boolean; title: string; addToProfile: string } | null;
}

const b64u = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function checkSignature(p: Verified['proof']): Promise<boolean | null> {
  try {
    const key = await crypto.subtle.importKey('raw', b64u(p.publicKey) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64u(p.signature) as BufferSource, new TextEncoder().encode(p.message) as BufferSource);
  } catch { return null; }
}

export default function VerifyPage() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<Verified | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [sig, setSig] = useState<'idle' | 'valid' | 'invalid' | 'unsupported'>('idle');
  const [fileCheck, setFileCheck] = useState<{ ok: boolean; name: string } | null>(null);

  const verifySignature = async () => {
    if (!data) return;
    const r = await checkSignature(data.proof);
    setSig(r === null ? 'unsupported' : r ? 'valid' : 'invalid');
  };
  const checkFile = async (file: File | undefined) => {
    if (!file || !data) return;
    const digest = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    setFileCheck({ ok: digest === data.sha256, name: file.name });
  };

  useEffect(() => { document.title = 'Verify a certificate - Facilify'; }, []);

  useEffect(() => {
    let dead = false;
    api<Verified>(`/api/verify/${encodeURIComponent(code)}`, { noRedirect: true })
      .then((r) => {
        if (dead) return;
        setData(r);
        document.title = r.valid ? `Certificate for ${r.name} - Facilify` : 'Certificate no longer valid - Facilify';
      })
      .catch((e) => { if (!dead) { if (e instanceof ApiError && e.status === 404) setNotFound(true); else setError(errorText(e)); } });
    return () => { dead = true; };
  }, [code]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold sm:text-2xl">Certificate verification</h1>

        {!data && !notFound && !error && <div className="mt-6"><PageLoading label="Checking this certificate" /></div>}

        {notFound && (
          <div className="mt-4" role="status" data-testid="verify-notfound">
            <Alert type="info" title="We could not find that certificate">
              No certificate matches the code <strong className="font-mono">{code}</strong>. Check the code for typing mistakes, or ask the person who shared it to send the link again.
            </Alert>
          </div>
        )}
        {error && <div className="mt-4" role="alert"><Alert type="error">{error}</Alert></div>}

        {data && (
          <>
            {data.valid ? (
              <div className="mt-4" role="status" data-testid="verify-valid">
                <Alert type="success" title="This certificate is genuine">It was issued by {data.issuer} and has not been withdrawn.</Alert>
              </div>
            ) : (
              <div className="mt-4" role="alert" data-testid="verify-revoked">
                <Alert type="warning" title="This certificate is no longer valid">{data.issuer} has withdrawn it. It may have been replaced by a corrected certificate.</Alert>
              </div>
            )}

            <dl className="mt-5 grid gap-1 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4" data-testid="verify-details">
              <dt className="text-slate-500">Awarded to</dt><dd className="font-semibold">{data.name}</dd>
              <dt className="text-slate-500">Award</dt><dd className="font-medium">{data.award}</dd>
              {data.event && <><dt className="text-slate-500">Event</dt><dd className="font-medium">{data.event}</dd></>}
              {data.date && <><dt className="text-slate-500">Date</dt><dd className="font-medium">{data.date}</dd></>}
              <dt className="text-slate-500">Issued by</dt><dd className="font-medium">{data.issuer}</dd>
              <dt className="text-slate-500">Issued on</dt><dd className="font-medium" data-testid="verify-issued">{new Date(data.issuedAt).toUTCString().replace('GMT', 'UTC')}</dd>
              <dt className="text-slate-500">Code</dt><dd className="font-mono text-xs">{data.code}</dd>
            </dl>

            {!imgFailed && (
              <img src={data.imageUrl} alt={`Certificate: ${data.award} for ${data.name}`} onError={() => setImgFailed(true)} className="mt-5 w-full rounded-lg border border-slate-200 shadow-xs" data-testid="verify-image" />
            )}
            {imgFailed && <p className="mt-5 text-sm text-slate-600">A picture of the certificate is not available right now.</p>}

            {data.linkedIn?.enabled && data.valid && (
              <a href={data.linkedIn.addToProfile} target="_blank" rel="noopener noreferrer" data-testid="verify-linkedin"
                className="mt-5 flex min-h-11 w-full items-center justify-center rounded-lg bg-[#0a66c2] px-4 text-sm font-semibold text-white hover:bg-[#004182] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a66c2] focus-visible:ring-offset-2">
                Add to LinkedIn Certifications
              </a>
            )}

            <details className="mt-5 rounded-xl border border-slate-200 p-4 text-sm" data-testid="verify-proof">
              <summary className="cursor-pointer font-semibold text-slate-800">Proof of issue (digital signature)</summary>
              <p className="mt-2 text-slate-600">This record was digitally signed when the certificate was issued. You can check the signature yourself, without trusting this page.</p>
              <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4">
                <dt className="text-slate-500">Issued (UTC)</dt><dd className="font-mono break-all">{data.issuedAt}</dd>
                <dt className="text-slate-500">PDF fingerprint (SHA-256)</dt><dd className="font-mono break-all" data-testid="verify-sha">{data.sha256 || 'not available yet'}</dd>
                <dt className="text-slate-500">Signature ({data.proof.algorithm})</dt><dd className="font-mono break-all">{data.proof.signature}</dd>
                <dt className="text-slate-500">Public key</dt><dd className="font-mono break-all">{data.proof.publicKey}</dd>
                <dt className="text-slate-500">Signed text</dt><dd className="font-mono break-all">{data.proof.message}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={verifySignature} data-testid="verify-sig-btn" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">Check the signature in my browser</button>
                {sig === 'valid' && <span className="text-xs font-medium text-emerald-700" role="status" data-testid="verify-sig-valid">Signature is valid: this record has not been changed.</span>}
                {sig === 'invalid' && <span className="text-xs font-medium text-red-700" role="alert" data-testid="verify-sig-invalid">Signature does NOT match. Do not trust this record.</span>}
                {sig === 'unsupported' && <span className="text-xs text-slate-600" role="status">Your browser cannot check this kind of signature yet. Try a recent Chrome, Edge, Safari or Firefox.</span>}
              </div>
              {data.sha256 && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <label className="block text-xs font-semibold text-slate-800">Have the PDF? Check that it is the original
                    <input type="file" accept="application/pdf,.pdf" onChange={(e) => checkFile(e.target.files?.[0])} data-testid="verify-file" className="mt-1 block w-full text-xs font-normal" />
                  </label>
                  <p className="mt-1 text-[11px] text-slate-500">The file never leaves your device: only its fingerprint is compared.</p>
                  {fileCheck && (fileCheck.ok
                    ? <p className="mt-1 text-xs font-medium text-emerald-700" role="status" data-testid="verify-file-ok">{fileCheck.name} is the original certificate.</p>
                    : <p className="mt-1 text-xs font-medium text-red-700" role="alert" data-testid="verify-file-bad">{fileCheck.name} does not match the original certificate. It may have been edited.</p>)}
                </div>
              )}
            </details>

            {data.valid && (
              <a href={data.pdfUrl} className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2" data-testid="verify-pdf">
                Download PDF
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
