// Ambient global augmentations for the IntervieHire dashboard.
//
// This file is TYPES-ONLY and emits NO runtime JS. It augments the DOM `Window`
// interface with every global the app assigns via `window.X = ...` (grepped from
// src/ and app/), plus a permissive index signature so stray `window.*` reads
// never trip TS2339. Each global is declared with a permissive type because the
// values are genuinely dynamic (callbacks, store objects, theme helpers, etc.).

export {};

declare global {
  interface Window {
    // ── Core store / API surface (src/dashboard/index.ts) ──────────────────
    AppState: any;
    IHApi: any;
    THREE: any;

    // ── Org / user context globals (DashboardShell.tsx, org-switcher.ts) ────
    IH_ACTIVE_ORG_ID: any;
    IH_ORG_NAME: any;
    IH_USER_NAME: any;
    IH_USER_TYPE: any;
    IH_updateTheme: (...args: any[]) => any;

    // ── Internal __ih* helpers (DashboardShell.tsx, url-sync.ts, mount.ts,
    //    api-bootstrap.ts) ──────────────────────────────────────────────────
    __ihBuildGreeting: (...args: any[]) => any;
    __ihDashboardMounted: any;
    __ihInitOrgSwitcher: (...args: any[]) => any;
    __ihNavigateToPath: (...args: any[]) => any;
    __ihPushState: (...args: any[]) => any;

    // ── Navigation handlers (index.ts, url-sync.ts, sourcing.ts) ────────────
    navigateToTab: (...args: any[]) => any;
    navigateToSubtab: (...args: any[]) => any;
    navigateToJobDetail: (...args: any[]) => any;
    navigateToJobStage: (...args: any[]) => any;
    navigateToSourcing: (...args: any[]) => any;
    openJobFlowView: (...args: any[]) => any;
    openReportDrawerForCandidate: (...args: any[]) => any;
    removeCandidateFromQueue: (...args: any[]) => any;

    // ── Job card / drawer handlers (mount.ts) ──────────────────────────────
    openJobDescriptionDrawer: (...args: any[]) => any;
    toggleJobKebab: (...args: any[]) => any;
    handleJobKebab: (...args: any[]) => any;

    // ── Misc UI globals ────────────────────────────────────────────────────
    _tfSources: any;
    triggerPageTransition: (...args: any[]) => any;

    // Permissive catch-all so dynamic `window.<anything>` access never errors.
    [key: string]: any;
  }
}
