'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errorText } from './api';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/form';
import { PageLoading } from '../ui/card';

interface Status { hasOrganizer: boolean; googleConfigured: boolean; passwordLogin?: boolean }

const GOOGLE_ERRORS: Record<string, string> = {
  'google-not-configured': 'Google sign-in is not set up on this computer yet. The owner needs to add the Google keys (see Settings help or the README).',
  'google-cancelled': 'Google sign-in was cancelled. You can try again.',
  'google-scopes': 'Facilify needs permission to send email and save files to Drive. Sign in again and keep every box ticked.',
  'google-state': 'That Google sign-in link expired. Please try again.',
  'google-failed': 'Google did not finish signing you in. Please try again.',
  'google-not-allowed': 'That Google account is not allowed to use this Facilify. Ask the owner to add your address.',
};

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-lg font-black text-white" aria-hidden="true">C</span>
          <span className="text-xl font-bold tracking-tight text-slate-900">Facilify</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-bold text-slate-900" data-testid="auth-title">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-xs text-slate-600">Certificates for events, from one spreadsheet.</p>
      </div>
    </main>
  );
}

function SetupForm() {
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('The two passwords are not the same.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/setup', { json: { organizationName: orgName, name, email, password }, noRedirect: true });
      window.location.assign('/upload');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Shell title="Create your Facilify account" subtitle="This is the first time Facilify has been opened here. Set up the organizer account. It takes a minute.">
      <form onSubmit={submit} className="space-y-4" data-testid="setup-form" noValidate>
        {error && <Alert type="error">{error}</Alert>}
        <TextField label="Organization or club name" name="organizationName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required autoComplete="organization" placeholder="Tech Club" hint="Printed on certificates and emails." data-testid="setup-org" />
        <TextField label="Your name" name="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" data-testid="setup-name" />
        <TextField label="Your email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-testid="setup-email" />
        <TextField label="Password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" hint="At least 8 characters." data-testid="setup-password" />
        <TextField label="Type the password again" name="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" error={mismatch ? 'The two passwords are not the same.' : undefined} data-testid="setup-confirm" />
        <Button type="submit" loading={busy} className="w-full" data-testid="setup-submit">Create account and start</Button>
      </form>
    </Shell>
  );
}

function LoginForm({ googleConfigured }: { googleConfigured: boolean }) {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const reason = params.get('reason');
  const googleError = GOOGLE_ERRORS[params.get('error') ?? ''];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { json: { email, password }, noRedirect: true });
      window.location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Shell title="Sign in" subtitle="Use the email and password you chose when you set Facilify up.">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form" noValidate>
        {reason === 'not-allowed' && <Alert type="warning">This account is not allowed to use Facilify. Ask an organizer to add you.</Alert>}
        {googleError && <Alert type="warning">{googleError}</Alert>}
        {error && <Alert type="error">{error}</Alert>}
        <TextField label="Email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" data-testid="login-email" />
        <TextField label="Password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" data-testid="login-password" />
        <Button type="submit" loading={busy} className="w-full" data-testid="login-submit">Sign in</Button>
      </form>
      {googleConfigured && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-600" aria-hidden="true"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
          <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} data-testid="login-google"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            Sign in with Google
          </a>
        </>
      )}
    </Shell>
  );
}

function GoogleOnly({ googleConfigured }: { googleConfigured: boolean }) {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const googleError = GOOGLE_ERRORS[params.get('error') ?? ''];
  return (
    <Shell title="Sign in to Facilify" subtitle="Sign in with your Google account. Facilify sends the emails from your Gmail and saves certificates to your Drive.">
      <div className="space-y-4" data-testid="google-only">
        {params.get('reason') === 'not-allowed' && <Alert type="warning">This account is not allowed to use Facilify.</Alert>}
        {googleError && <Alert type="warning">{googleError}</Alert>}
        {googleConfigured ? (
          <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} data-testid="login-google"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            Sign in with Google
          </a>
        ) : (
          <Alert type="warning" title="Google is not set up yet">The owner of this copy of Facilify needs to add the Google keys first. Until then nobody can sign in.</Alert>
        )}
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>Facilify asks to <strong>send email as you</strong> and to <strong>create files in your Drive</strong>. Keep both boxes ticked.</li>
          <li>It cannot read your inbox or open your other Drive files.</li>
          <li>If Google says the app is not verified, click <strong>Advanced</strong>, then <strong>Continue</strong>.</li>
        </ul>
      </div>
    </Shell>
  );
}

function Gate() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Status>('/api/auth/status', { noRedirect: true }).then(setStatus).catch((e) => setError(errorText(e)));
  }, []);
  if (error) return <Shell title="Facilify could not start" subtitle="The sign-in page could not check this computer."><Alert type="error">{error}</Alert></Shell>;
  if (!status) return <div className="flex min-h-screen items-center justify-center"><PageLoading /></div>;
  if (!status.passwordLogin) return <GoogleOnly googleConfigured={status.googleConfigured} />;
  return status.hasOrganizer ? <LoginForm googleConfigured={status.googleConfigured} /> : <SetupForm />;
}

export function AuthPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><PageLoading /></div>}><Gate /></Suspense>;
}
