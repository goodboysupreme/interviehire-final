/**
 * job-stages.js
 *
 * Single source of truth mapping the job-detail stage TABS (the internal
 * `data-jd-tab` ids used by the vanilla engine) to URL SLUGS (the Next.js
 * route-folder names under app/dashboard/jobs/[jobId]/<slug>/).
 *
 * Dependency-free on purpose so url-sync.js, job-detail.js, mount.js and the
 * React DashboardShell can all import it without circular-import risk.
 *
 *   tab id      slug (route folder)
 *   ────────    ──────────────────────
 *   overview    (base — no slug; /dashboard/jobs/<id>)
 *   resume      resume-analysis
 *   screening   recruiter-screening
 *   functional  functional-interview
 *   interviewanalysis interview-analysis
 *   questions   questions-generator
 *   analysis    deep-analysis
 *   testinterview test-interview
 */

// slug → internal tab id
export const STAGE_SLUG_TO_TAB = {
  'resume-analysis': 'resume',
  'recruiter-screening': 'screening',
  'functional-interview': 'functional',
  'interview-analysis': 'interviewanalysis',
  'questions-generator': 'questions',
  'deep-analysis': 'analysis',
  'test-interview': 'testinterview',
  'overview': 'overview',
};

// internal tab id → slug
export const TAB_TO_STAGE_SLUG = Object.fromEntries(
  Object.entries(STAGE_SLUG_TO_TAB).map(([slug, tab]) => [tab, slug])
);

/**
 * Build the canonical URL for a job stage. Overview is the bare job URL
 * (no slug) so existing /dashboard/jobs/<id> links keep working unchanged.
 */
export function jobStageUrl(jobId: string | null | undefined, tabId: string) {
  const slug = TAB_TO_STAGE_SLUG[tabId];
  return slug && tabId !== 'overview'
    ? `/dashboard/jobs/${jobId}/${slug}`
    : `/dashboard/jobs/${jobId}`;
}
