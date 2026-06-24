'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, ErrorBanner, SubmitButton } from '../AuthShell';
import { apiOnboarding, apiMe, isAuthed } from '../../../src/auth-client.js';

export default function OnboardingPage() {
  const router = useRouter();
  const [form, setForm] = useState({ orgName: '', website: '', location: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  // Onboarding needs a session AND a still-org-less account. Bounce anyone who
  // already has an org straight to the dashboard.
  useEffect(() => {
    if (!isAuthed()) { router.replace('/login'); return; }
    let cancelled = false;
    apiMe()
      .then((me) => {
        if (cancelled) return;
        if (me && !me.onboarding_required) { router.replace('/dashboard'); return; }
        setReady(true);
      })
      .catch(() => { if (!cancelled) router.replace('/login'); });
    return () => { cancelled = true; };
  }, [router]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (form.orgName.trim().length < 2) { setError('Please enter your organisation name.'); return; }
    setError('');
    setLoading(true);
    try {
      await apiOnboarding({
        org_name: form.orgName.trim(),
        website_link: form.website.trim() || undefined,
        location: form.location.trim() || undefined,
      });
      router.replace('/dashboard');
    } catch (err) {
      const msg = (err && err.message) || 'Could not set up your workspace.';
      // Already onboarded in another tab/session — just proceed.
      if (/already set up/i.test(msg)) { router.replace('/dashboard'); return; }
      setError(msg);
      setLoading(false);
    }
  }

  if (!ready) return null;

  return (
    <AuthShell
      title="Set up your workspace"
      subtitle="Name your organisation to create your own isolated hiring workspace."
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <ErrorBanner message={error} />

        <div className="auth-field">
          <label className="auth-label" htmlFor="orgName">Organisation name</label>
          <input id="orgName" className="auth-input" type="text" autoComplete="organization"
            placeholder="Acme Inc." value={form.orgName} onChange={set('orgName')} autoFocus required />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="website">Website <span style={{ opacity: 0.5 }}>(optional)</span></label>
          <input id="website" className="auth-input" type="text" autoComplete="url"
            placeholder="https://acme.com" value={form.website} onChange={set('website')} />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="location">Location <span style={{ opacity: 0.5 }}>(optional)</span></label>
          <input id="location" className="auth-input" type="text" autoComplete="address-level2"
            placeholder="San Francisco, CA" value={form.location} onChange={set('location')} />
        </div>

        <SubmitButton loading={loading} idle="Create workspace" busy="Creating…" />
      </form>
    </AuthShell>
  );
}
