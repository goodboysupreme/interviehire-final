'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, ErrorBanner, SubmitButton } from '../AuthShell';
import { apiMe, isAuthed, clearAuthed } from '../../../src/auth-client.js';
import { request } from '../../../src/auth-client.js';

export default function OnboardingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    org_name: '',
    domain: '',
    contact_email: '',
    website_link: '',
    location: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Guard: redirect to /login if not authed, redirect to /dashboard if already onboarded.
  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    apiMe()
      .then((me) => {
        if (cancelled) return;
        // If they already have an org, skip onboarding.
        if (me && !me.onboarding_required) router.replace('/dashboard');
      })
      .catch(() => {
        if (!cancelled) {
          clearAuthed();
          router.replace('/login');
        }
      });
    return () => { cancelled = true; };
  }, [router]);

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (!form.org_name.trim()) {
      setError('Organisation name is required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await request('/auth/onboarding', {
        method: 'POST',
        body: {
          org_name: form.org_name.trim(),
          domain: form.domain.trim() || undefined,
          contact_email: form.contact_email.trim() || undefined,
          website_link: form.website_link.trim() || undefined,
          location: form.location.trim() || undefined,
        },
      });
      router.replace('/dashboard');
    } catch (err) {
      setError((err && err.message) || 'Could not complete onboarding. Please try again.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Set up your workspace"
      subtitle="Tell us a bit about your organisation to get started."
      footer={<>Wrong account? <a className="auth-link" href="/login">Sign in with a different email</a></>}
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <ErrorBanner message={error} />

        <div className="auth-field">
          <label className="auth-label" htmlFor="org_name">Organisation name <span style={{ color: '#f87171' }}>*</span></label>
          <input
            id="org_name"
            className="auth-input"
            type="text"
            placeholder="Acme Corp"
            value={form.org_name}
            onChange={set('org_name')}
            autoFocus
            required
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="domain">Domain (optional)</label>
          <input
            id="domain"
            className="auth-input"
            type="text"
            placeholder="acme.com"
            value={form.domain}
            onChange={set('domain')}
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="contact_email">Contact email (optional)</label>
          <input
            id="contact_email"
            className="auth-input"
            type="email"
            placeholder="hr@acme.com"
            value={form.contact_email}
            onChange={set('contact_email')}
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="location">Location (optional)</label>
          <input
            id="location"
            className="auth-input"
            type="text"
            placeholder="Bengaluru, India"
            value={form.location}
            onChange={set('location')}
          />
        </div>

        <SubmitButton loading={loading} idle="Complete setup →" busy="Setting up…" />
      </form>
    </AuthShell>
  );
}
