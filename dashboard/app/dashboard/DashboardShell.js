'use client';

import { memo, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { initDashboardPage } from '../../src/dashboard/index.js';
import { html } from '../../src/html/dashboard-crystal';
import { apiMe, apiLogout, clearAuthed } from '../../src/auth-client.js';
import { apiFetchOrganisation } from '../../src/dashboard/api.js';

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

// The vanilla dashboard surface. memo() + no props => renders exactly once,
// React never re-runs it — parent re-renders can't reset dangerouslySetInnerHTML
// and wipe the vanilla-JS-injected content (job cards, kanban, etc.).
const DashboardSurface = memo(function DashboardSurface() {
  useEffect(() => {
    const cleanup = initDashboardPage();
    
    // Small tick to let the vanilla mount bindings settle (mirrors original setTimeout(initMountBindings, 0))
    const timer = setTimeout(() => {
      window.__ihDashboardMounted = true;
      navigateToPath(window.location.pathname);
    }, 50);

    return () => {
      window.__ihDashboardMounted = false;
      clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, []);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

function navigateToPath(path) {
  if (!path) return;
  const segments = path.split('/').filter(Boolean); // e.g. ['dashboard', 'jobs', 'JOB-123']
  if (segments[0] !== 'dashboard') return;

  const sub = segments[1]; // e.g. 'jobs', 'analytics', etc.
  if (!sub) {
    window.navigateToTab?.('jobs');
    return;
  }

  if (sub === 'jobs') {
    const rawJobId = segments[2];
    const jobId = rawJobId && rawJobId.includes('--') ? rawJobId.split('--').pop() : rawJobId;
    const subSub = segments[3];
    if (jobId) {
      if (subSub === 'flow') {
        window.openJobFlowView?.(jobId);
      } else {
        window.navigateToJobDetail?.(jobId);
      }
    } else {
      window.navigateToTab?.('jobs');
    }
  } else if (sub === 'sourcing') {
    const rawJobId = segments[2];
    const jobId = rawJobId && rawJobId.includes('--') ? rawJobId.split('--').pop() : rawJobId;
    if (jobId) {
      window.navigateToSourcing?.(jobId);
    }
  } else if (sub === 'settings') {
    window.navigateToSubtab?.('settings-general');
  } else if (['analytics', 'swarm', 'team', 'career'].includes(sub)) {
    window.navigateToTab?.(sub);
  }
}

/**
 * DashboardShell
 *
 * Shared auth-guarded wrapper in layout to persist vanilla DOM across route transitions.
 */
export default function DashboardShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  // Start 'checking' on both server and first client render to avoid hydration mismatch.
  const [phase, setPhase] = useState('checking');
  const [user, setUser] = useState(null);

  // Expose routing function to window for url-sync to push to next router
  useEffect(() => {
    window.__ihPushState = (url) => {
      router.push(url, { scroll: false });
    };
    window.__ihNavigateToPath = navigateToPath;
    return () => {
      delete window.__ihPushState;
      delete window.__ihNavigateToPath;
    };
  }, [router]);

  // Authoritative session check against the backend.
  useEffect(() => {
    let cancelled = false;

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
        }
        router.replace('/login');
      });

    return () => { cancelled = true; };
  }, [router]);

  // Pathname sync effect (runs on route transitions after initial mount)
  useEffect(() => {
    if (phase !== 'authed' || !window.__ihDashboardMounted) return;
    navigateToPath(pathname);
  }, [pathname, phase]);

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

    const firstName = label.split(/\s+/)[0] || label;
    window.IH_USER_NAME = firstName;
    window.IH_USER_FULLNAME = label;
    window.IH_USER_EMAIL = user.email;
    window.IH_ORG_NAME = (user.organisation_name || '').trim();

    // Fetch live organisation details if available
    apiFetchOrganisation()
      .then((org) => {
        if (org) {
          window.IH_ORG_NAME = (org.org_name || '').trim();
          window.IH_ORG_DOMAIN = (org.domain || '').trim();
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch organisation details:", err);
      });

    // Personalise the "Created By" defaults so they show the signed-in user.
    const creatorInput = document.getElementById('job-creator-input');
    if (creatorInput) creatorInput.value = label;
    const creatorOpt = document.querySelector('#jobs-creator-select option[value="me"]');
    if (creatorOpt) creatorOpt.textContent = label;
    const titleEl = document.getElementById('header-main-title');
    if (titleEl && /^good (morning|afternoon|evening)/i.test((titleEl.textContent || '').trim())) {
      titleEl.textContent = typeof window.__ihBuildGreeting === 'function'
        ? window.__ihBuildGreeting()
        : `Good day, ${firstName}`;
    }
  }, [phase, user]);

  // Bind logout button.
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

  return (
    <>
      <DashboardSurface />
      {children}
    </>
  );
}
