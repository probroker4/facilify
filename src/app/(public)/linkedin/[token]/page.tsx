'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageLoading } from '@/components/ui/card';
import { TextAreaField, TextField } from '@/components/ui/form';
import { api, errorText } from '@/components/wizard/api';
import { buildShareLinks } from '@/lib/share';

interface CertInfo {
  name: string; event: string; award: string; date: string; verifyCode: string; verifyUrl: string; organizationName: string;
  organizationId: string | null; issuedAt: string | null; revoked: boolean; linkedInEnabled: boolean;
  linkedIn: { title: string; addToProfile: string; share: string; post: string };
}

export default function LinkedInPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<CertInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [org, setOrg] = useState('');
  const [post, setPost] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<CertInfo>(`/api/public/cert/${encodeURIComponent(token)}`, { noRedirect: true })
      .then((r) => {
        setInfo(r);
        setTitle(r.linkedIn.title);
        setOrg(r.organizationName);
        setPost(`I received "${r.linkedIn.title}" from ${r.organizationName}! ${r.verifyUrl}`);
      })
      .catch((e) => setError(errorText(e)));
  }, [token]);

  const links = useMemo(() => {
    if (!info) return null;
    return buildShareLinks({
      title: title.trim() || info.linkedIn.title, organizationName: org.trim() || info.organizationName,
      organizationId: org.trim() === info.organizationName ? info.organizationId ?? undefined : undefined,
      dateText: info.date, issuedAt: info.issuedAt ? new Date(info.issuedAt) : new Date(),
      verifyUrl: info.verifyUrl, verifyCode: info.verifyCode, customizeUrl: '', postText: post.trim() || undefined,
    });
  }, [info, title, org, post]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(post); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-7">
        <h1 className="text-xl font-bold">Add your certificate to LinkedIn</h1>
        {error && <div className="mt-4"><Alert type="error">{error}</Alert></div>}
        {!info && !error && <PageLoading label="Loading your certificate" />}
        {info && links && (
          <>
            <p className="mt-1 text-sm text-slate-600">
              {info.name}, congratulations on <strong>{info.award}</strong>{info.event ? ` at ${info.event}` : ''}. Check the details below, change anything you like, then send them to LinkedIn. You can edit again on LinkedIn before saving.
            </p>
            {info.revoked && <div className="mt-4"><Alert type="warning">This certificate was withdrawn by the organizer, so it cannot be added.</Alert></div>}
            <img src={`/api/verify/${encodeURIComponent(info.verifyCode)}/image`} alt={`Your certificate: ${info.award}`} className="mt-4 w-full rounded-lg border border-slate-200" />

            <div className="mt-5 space-y-4">
              <TextField label="Certificate name on LinkedIn" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="li-title" />
              <TextField label="Issuing organisation" value={org} onChange={(e) => setOrg(e.target.value)} maxLength={120} data-testid="li-org" />
              <TextAreaField label="Text for a LinkedIn post (optional)" value={post} onChange={(e) => setPost(e.target.value)} rows={3} maxLength={600} hint="Used by the post buttons below. Your certificate's verification link keeps it trustworthy." data-testid="li-post" />
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <a href={links.addToProfile} target="_blank" rel="noopener noreferrer" data-testid="li-add"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#0a66c2] px-4 text-sm font-semibold text-white hover:bg-[#004182] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0a66c2]">
                Add to my LinkedIn profile
              </a>
              <a href={links.post} target="_blank" rel="noopener noreferrer" data-testid="li-post-link"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
                Share as a post
              </a>
              <a href={links.share} target="_blank" rel="noopener noreferrer" data-testid="li-share"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
                Share the verification page
              </a>
              <Button variant="ghost" onClick={copy} data-testid="li-copy">{copied ? 'Copied' : 'Copy post text'}</Button>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Verification page: <a className="underline" href={info.verifyUrl}>{info.verifyUrl}</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
