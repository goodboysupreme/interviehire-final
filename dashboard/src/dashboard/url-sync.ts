/**
 * url-sync.js
 *
 * Bridges vanilla-JS dashboard navigation with the browser URL bar.
 * Called once from index.js after initMountBindings() is scheduled.
 *
 * Strategy:
 * - Intercepts sidebar tab clicks and uses history.pushState to update
 *   the URL WITHOUT a full page reload, keeping the SPA alive.
 * - Patches window.navigateToJobDetail / window.openJobFlowView /
 *   window.navigateToSourcing to also push the correct URL.
 *
 * Uses runtime-proxied globals (document, window, setTimeout,
 * requestAnimationFrame) so all listeners/timers are torn down cleanly
 * when React unmounts the page.
 */
import { document, window, requestAnimationFrame, setTimeout } from './runtime';

// Tab ID → URL segment mapping
const TAB_URLS = {
  'jobs':      '/dashboard/jobs',
  'analytics': '/dashboard/analytics',
  'swarm':     '/dashboard/swarm',
  'talent':    '/dashboard/talent',
  'team':      '/dashboard/team',
  'career':    '/dashboard/career',
};

const SUBTAB_URLS = {
  'settings-general': '/dashboard/settings/general',
};

/**
 * Pushes a URL to the browser history without reloading the page.
 * Debounced to avoid double-push from simultaneous React + vanilla nav.
 */
type PatchableFn = ((...args: any[]) => any) & { __urlPatched?: boolean };

let _pushPending = false;
export function pushUrl(url: string) {
  if (typeof window === 'undefined') return;
  if (_pushPending) return;
  if (window.location.pathname === url) return;
  _pushPending = true;
  requestAnimationFrame(() => {
    if (typeof window.__ihPushState === 'function') {
      window.__ihPushState(url);
    } else {
      history.pushState(null, '', url);
    }
    _pushPending = false;
  });
}


/**
 * Patches window.navigateToJobDetail to also update the URL.
 */
function patchJobDetailNav() {
  const original = window.navigateToJobDetail as PatchableFn;
  if (!original || original.__urlPatched) return;
  // navigateToJobDetail already pushes the (stage-aware) URL internally, so the
  // wrapper only forwards the optional `stage` argument through.
  window.navigateToJobDetail = function(jobId: string, stage?: string) {
    original(jobId, stage);
  };
  (window.navigateToJobDetail as PatchableFn).__urlPatched = true;
}

/**
 * Patches window.openJobFlowView to also update the URL.
 */
function patchJobFlowNav() {
  const original = window.openJobFlowView as PatchableFn;
  if (!original || original.__urlPatched) return;
  window.openJobFlowView = function(jobId: string, ...rest: any[]) {
    original(jobId, ...rest);
    pushUrl(`/dashboard/jobs/${jobId}/flow`);
  };
  (window.openJobFlowView as PatchableFn).__urlPatched = true;
}

/**
 * Patches window.navigateToSourcing to also update the URL.
 */
function patchSourcingNav() {
  const original = window.navigateToSourcing as PatchableFn;
  if (!original || original.__urlPatched) return;
  window.navigateToSourcing = function(jobId: string, targetStage: string | null = null) {
    original(jobId, targetStage);
    pushUrl(`/dashboard/sourcing/${jobId}`);
  };
  (window.navigateToSourcing as PatchableFn).__urlPatched = true;
}

/**
 * Adds href attributes to sidebar nav <li> items and intercepts their
 * click events to push URL changes via history.pushState.
 *
 * We do NOT prevent the vanilla navigateToTab() from firing — that
 * still handles the SPA view switching. We just additionally push the URL.
 */
function patchSidebarNavLinks() {
  document.querySelectorAll('.sidebar-nav .nav-item[data-tab]').forEach(item => {
    const tabId = item.getAttribute('data-tab');
    if (!tabId || tabId === 'settings') return; // settings uses subnav

    const url = (TAB_URLS as Record<string, string>)[tabId];
    if (!url) return;

    // Mark the element for accessibility / right-click
    item.setAttribute('data-href', url);
    (item as HTMLElement).style.cursor = 'pointer';

    // Listen on capture so we fire AFTER the existing mount.js listener
    // which already calls navigateToTab(tabId).
    item.addEventListener('click', () => {
      pushUrl(url);
    });
  });

  // Settings subnav items
  document.querySelectorAll('.sub-nav li[data-subtab]').forEach(li => {
    const subtabId = li.getAttribute('data-subtab');
    const url = (SUBTAB_URLS as Record<string, string>)[subtabId as string];
    if (!url) return;

    li.addEventListener('click', () => {
      pushUrl(url);
    });
  });
}

/**
 * Main init — call after initMountBindings() so window globals are set.
 */
export function initUrlSync() {
  // Patch window globals for job-level navigation (these are set in index.js)
  // Retry loop in case they aren't exposed yet (initMountBindings is async via setTimeout)
  let attempts = 0;
  const tryPatch = () => {
    patchJobDetailNav();
    patchJobFlowNav();
    patchSourcingNav();
    attempts++;
    if (attempts < 10) {
      // Retry after short delay in case window globals weren't ready yet
      if (!(window.navigateToJobDetail as PatchableFn)?.__urlPatched ||
          !(window.openJobFlowView as PatchableFn)?.__urlPatched ||
          !(window.navigateToSourcing as PatchableFn)?.__urlPatched) {
        setTimeout(tryPatch, 100);
      }
    }
  };

  // Patch sidebar links immediately (DOM is ready)
  patchSidebarNavLinks();

  // Patch window globals (may need a tick for index.js to run)
  setTimeout(tryPatch, 50);
}
