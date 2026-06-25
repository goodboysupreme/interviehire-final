// Super-admin-only organisation switcher in the dashboard header. Lets a
// super-admin choose which organisation's data the dashboard shows by setting
// the backend `active_org_id` cookie, then reloading so every list re-scopes.
//
// Gated on window.IH_USER_TYPE (set by DashboardShell from /me). org_admins and
// members never see the trigger — and the backend 403s these endpoints anyway,
// so this is defence in depth, not the only guard.
import { document, window } from './runtime';
import { escapeHTML } from './escape';
import { showPremiumToast } from './sourcing';
import { apiListOrganisations, apiSwitchContext } from './api';

let cachedOrgs: any[] | null = null; // fetched once per session; re-rendered on every init.

function renderOrgs(menu: HTMLElement) {
  const orgs = Array.isArray(cachedOrgs) ? cachedOrgs : [];
  const activeId = window.IH_ACTIVE_ORG_ID == null ? '' : String(window.IH_ACTIVE_ORG_ID);
  if (!orgs.length) {
    menu.innerHTML = '<div class="bulk-dd-item" style="opacity:0.6;cursor:default;">No organisations</div>';
    return;
  }
  menu.innerHTML = orgs.map((org) => {
    const id = String(org.id);
    const name = org.org_name || org.name || 'Untitled';
    const active = id === activeId;
    return `<button class="bulk-dd-item${active ? ' active' : ''}" data-org-id="${escapeHTML(id)}" type="button">`
      + `<span class="org-name">${escapeHTML(name)}</span>`
      + (active ? '<span class="org-check">✓</span>' : '')
      + '</button>';
  }).join('');
}

function updateLabel(trigger: HTMLElement) {
  const labelEl = trigger.querySelector('.org-switcher-label');
  if (labelEl) labelEl.textContent = (window.IH_ORG_NAME || '').trim() || 'All organisations';
}

export async function initOrgSwitcher() {
  const wrap = document.getElementById('org-switcher');
  const trigger = document.getElementById('btn-org-switcher');
  const menu = document.getElementById('org-switcher-menu');
  if (!wrap || !trigger || !menu) return;

  // Only super-admins get the switcher; everyone else keeps it hidden.
  if (window.IH_USER_TYPE !== 'super_admin') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  updateLabel(trigger);

  // Bind once per element. The dataset flag survives module re-init but NOT DOM
  // replacement, so a React remount re-binds the fresh trigger. Mirrors the
  // logout-button binding pattern in DashboardShell.
  if (!trigger.dataset.ihOrgBound) {
    trigger.dataset.ihOrgBound = '1';

    const closeMenu = () => {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.style.display !== 'none') { closeMenu(); return; }
      menu.style.display = 'block';
      trigger.setAttribute('aria-expanded', 'true');
    });

    // Outside-click closes. The runtime document carries the AbortController
    // signal, so this listener is torn down when React unmounts the surface.
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target as Node | null)) closeMenu();
    });

    // Delegated item clicks → switch active org + reload into that context.
    menu.addEventListener('click', async (e) => {
      const item = (e.target as Element).closest('.bulk-dd-item');
      if (!item) return;
      const orgId = item.getAttribute('data-org-id');
      if (!orgId) return;
      if (orgId === String(window.IH_ACTIVE_ORG_ID)) { closeMenu(); return; }
      item.setAttribute('disabled', '');
      try {
        await apiSwitchContext(orgId);
        window.location.reload();
      } catch (err: any) {
        item.removeAttribute('disabled');
        showPremiumToast((err && err.message) || 'Could not switch organisation.', 'error');
      }
    });
  }

  // Fetch the org list once, but re-render every init (the DOM may be fresh
  // after a remount, and the active selection can change).
  try {
    if (!cachedOrgs) cachedOrgs = await apiListOrganisations();
    renderOrgs(menu);
  } catch (err: any) {
    showPremiumToast((err && err.message) || 'Could not load organisations.', 'error');
  }
}
