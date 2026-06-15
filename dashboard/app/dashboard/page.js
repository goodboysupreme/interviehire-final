'use client';

import { memo, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { initDashboardPage } from '../../src/dashboard/index.js';
import { html } from '../../src/html/dashboard-crystal';
import { apiMe, apiLogout, isAuthed, clearAuthed } from '../../src/auth-client.js';

const ROLE_LABEL = { super_admin: 'Admin', org_admin: 'Org. Admin', member: 'Member' };

// 401-style messages from the api client; anything else (network/backend down)
// is treated as "unverified" rather than "rejected".
const UNAUTHED_RE = /401|not authenticated|unauthor|credential|user not found/i;

function VerifyingScreen() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#0a0a0a', color: '#9a9a9a', fontFamily: "'Outfit', system-ui, sans-serif", zIndex: 50 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 34, height: 34, margin: '0 auto 14px', borderRadius: '50%', border: '2px solid rgba(45,212,191,0.2)', borderTopColor: '#2dd4bf', animation: 'ih-auth-spin 0.8s linear infinite' }} />
        <div style={{ fontSize: '0.85rem', letterSpacing: '0.02em' }}>Verifying your session…</div>
      </div>
      <style>{'@keyframes ih-auth-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

// The vanilla dashboard surface. memo() + no props => it renders exactly once and
// React never re-runs it, so parent re-renders can't reset the dangerouslySet
// innerHTML and wipe the vanilla-JS-injected content (job cards, etc.).
const DashboardSurface = memo(function DashboardSurface() {
  useEffect(() => {
    const cleanup = initDashboardPage();
    return () => { if (cleanup) cleanup(); };
  }, []);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

export default function DashboardCrystalPage() {
  const router = useRouter();
  // IMPORTANT: start in 'checking' on BOTH server and first client render so the
  // statically-prerendered HTML matches — reading localStorage in the initializer
  // caused a hydration mismatch (server rendered "Verifying", client rendered the
  // dashboard) that flickered and wiped the vanilla content.
  const [phase, setPhase] = useState('checking');
  const [user, setUser] = useState(null);

  // Optimistic upgrade — client-only, after hydration. If we have a prior session
  // flag, show the dashboard immediately while /me verifies in the background.
  useEffect(() => {
    if (isAuthed()) setPhase('authed');
  }, []);

  // Authoritative session check against the backend.
  useEffect(() => {
    let cancelled = false;
    const optimistic = isAuthed();

    apiMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setPhase('authed');
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = (err && err.message) || '';
        if (UNAUTHED_RE.test(msg)) {
          clearAuthed();
          router.replace('/login');
        } else if (!optimistic) {
          // No prior session and the backend is unreachable — can't let them in.
          router.replace('/login');
        }
        // else: optimistic session + backend hiccup → stay on the dashboard.
      });

    return () => { cancelled = true; };
  }, [router]);

  // Reflect the signed-in user into the sidebar profile (runs after the surface
  // has mounted and /me has returned).
  useEffect(() => {
    if (phase !== 'authed' || !user) return;
    const label = (user.name || user.username || 'Account').trim();
    const nameEl = document.querySelector('.user-profile .user-name');
    const roleEl = document.querySelector('.user-profile .user-role');
    const avatarEl = document.querySelector('.user-profile .user-avatar');
    if (nameEl) nameEl.textContent = label;
    if (roleEl) roleEl.textContent = ROLE_LABEL[user.user_type] || 'Member';
    if (avatarEl) avatarEl.textContent = (label[0] || 'A').toUpperCase();

    // Personalise the greeting banner with the user's first name. Bridge the
    // name to the vanilla nav (via globalThis) so tab switches keep it, and
    // refresh the banner now (the nav may have already rendered it nameless).
    const firstName = label.split(/\s+/)[0] || label;
    window.IH_USER_NAME = firstName;
    const titleEl = document.getElementById('header-main-title');
    if (titleEl && /^good (morning|afternoon|evening)/i.test((titleEl.textContent || '').trim())) {
      titleEl.textContent = typeof window.__ihBuildGreeting === 'function'
        ? window.__ihBuildGreeting()
        : `Good day, ${firstName}`;
    }
  }, [phase, user]);

  // Own logout from React — the vanilla sidebar binding is unreliable. Wait a
  // tick for the dashboard's own mount bindings, then replace the button with a
  // clean clone (stripping any prior listener) and bind a real logout.
  useEffect(() => {
    if (phase !== 'authed') return;
    let timer;
    const bind = () => {
      const btn = document.querySelector('.user-profile .btn-logout');
      if (!btn) { timer = setTimeout(bind, 80); return; }
      if (btn.dataset.ihLogout) return;
      const fresh = btn.cloneNode(true);
      btn.replaceWith(fresh);
      fresh.dataset.ihLogout = '1';
      fresh.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        fresh.setAttribute('disabled', '');
        try { await apiLogout(); } catch {}
        router.replace('/login');
      });
    };
    timer = setTimeout(bind, 80);
    return () => clearTimeout(timer);
  }, [phase, router]);

  if (phase !== 'authed') return <VerifyingScreen />;

  return <DashboardSurface />;
}
