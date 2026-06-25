'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, ErrorBanner, SubmitButton } from '../AuthShell';
import { apiLogin, apiMe, isAuthed } from '../../../src/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If a valid session already exists, skip the form.
  useEffect(() => {
    if (!isAuthed()) return;
    let cancelled = false;
    apiMe()
      .then(() => { if (!cancelled) router.replace('/dashboard'); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const { onboardingRequired } = await apiLogin(email.trim(), password);
      router.replace(onboardingRequired ? '/onboarding' : '/dashboard');
    } catch (err: any) {
      setError((err && err.message) || 'Sign in failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your intervieHire recruiter workspace."
      footer={<>New here? <a className="auth-link" href="/signup">Create an account</a></>}
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <ErrorBanner message={error} />

        <div className="auth-field">
          <label className="auth-label" htmlFor="email">Email</label>
          <input
            id="email"
            className={`auth-input${error ? ' invalid' : ''}`}
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="password">Password</label>
          <input
            id="password"
            className={`auth-input${error ? ' invalid' : ''}`}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <SubmitButton loading={loading} idle="Sign in" busy="Signing in…" />
      </form>
    </AuthShell>
  );
}
