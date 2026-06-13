import { document, requestAnimationFrame } from './runtime.js';
import { drawFunnelSVG, drawScoreDistributionSVG } from './funnel-charts.js';
import { renderJobDetailPanes } from './job-detail-panes.js';
import { renderFunnelInsights, renderFunnelStages, toggleHeaderElementsForJobFlow } from './job-flow.js';
import { navigateToTab } from './navigation.js';
import { filterCandidatesByDateRange } from './render-views.js';
import { soundEngine } from './sound.js';
import { AppState } from './state.js';
import { isApiMode, apiFetchApplicants } from './api.js';
import { showPremiumToast } from './sourcing.js';

// ==========================================
// JOB DETAIL VIEW
// ==========================================

function navigateToJobDetail(jobId) {
  const job = AppState.jobs.find(j => j.id === jobId);
  if (!job) return;

  AppState.activeJobId = jobId;
  AppState.activeTab = 'job-detail';

  // Sidebar: keep Jobs highlighted as parent
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  document.querySelectorAll('.sub-nav li').forEach(li => li.classList.remove('active-sub'));

  // Breadcrumb — "Jobs" clickable link and Job Name clickable link
  const breadcrumb = document.getElementById('breadcrumb-title');
  const shortName = job.cardName.length > 30 ? job.cardName.slice(0, 30) + '…' : job.cardName;
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jobs-link">Jobs</span>
    <span class="breadcrumb-separator">/</span> <span class="breadcrumb-link" id="bc-jobname-link">${shortName}</span>
    <span class="breadcrumb-separator">/</span> Responses`;
  document.getElementById('bc-jobs-link').addEventListener('click', () => navigateToTab('jobs'));
  document.getElementById('bc-jobname-link').addEventListener('click', () => {
    document.querySelectorAll('.jd-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.jd-tab[data-jd-tab="overview"]').classList.add('active');
    document.querySelectorAll('.jd-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('jd-pane-overview').classList.add('active');
    soundEngine.playClick();
  });

  // Header
  toggleHeaderElementsForJobFlow(false);
  document.getElementById('header-main-title').textContent = job.cardName;
  document.getElementById('header-sub-text').textContent =
    `${job.pipeline.total} total candidate${job.pipeline.total !== 1 ? 's' : ''} · ${job.roleName}`;
  document.getElementById('header-action-btn').style.display = 'none';

  // Show view
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-job-detail').classList.add('active-view');

  // Sub-tab counts
  document.getElementById('jd-count-screening').textContent = job.pipeline.screening;
  document.getElementById('jd-count-functional').textContent = job.pipeline.functional;

  // Dynamic tabs hiding based on pipeline config
  const cfg = job.pipelineConfig || {
    resumeAnalysis: { enabled: true },
    recruiterScreening: { enabled: true },
    functionalInterview: { enabled: true }
  };

  const tabResume = document.querySelector('.jd-tab[data-jd-tab="resume"]');
  const tabScreening = document.querySelector('.jd-tab[data-jd-tab="screening"]');
  const tabFunctional = document.querySelector('.jd-tab[data-jd-tab="functional"]');

  if (tabResume) tabResume.style.display = cfg.resumeAnalysis?.enabled !== false ? '' : 'none';
  if (tabScreening) tabScreening.style.display = cfg.recruiterScreening?.enabled !== false ? '' : 'none';
  if (tabFunctional) tabFunctional.style.display = cfg.functionalInterview?.enabled !== false ? '' : 'none';

  // Reset to Overview tab
  document.querySelectorAll('.jd-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.jd-tab[data-jd-tab="overview"]').classList.add('active');
  document.querySelectorAll('.jd-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('jd-pane-overview').classList.add('active');

  const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(
    c => c.jobApplied === job.roleName || c.jobApplied === job.cardName
  );

  renderFunnelStages(job);
  renderFunnelInsights(job);
  renderJobDetailPanes(job);

  // SVG needs layout to be painted first
  requestAnimationFrame(() => {
    drawFunnelSVG(job, jobCandidates);
    drawScoreDistributionSVG(job, jobCandidates);
  });

  hydrateBackendApplicants(job);

  soundEngine.playChime([440.00, 523.25, 659.25], 0.12, 0.08);
}

// In api mode a job's applicants live in the backend, not localStorage. Fetch
// them on open, tag each to this job so the existing name-based candidate
// filters match, merge into AppState, and re-render. Fire-and-forget: panes
// render immediately (empty) then fill in when the fetch lands. Inert otherwise.
async function hydrateBackendApplicants(job) {
  if (!isApiMode() || !job._backend) return;
  let applicants;
  try {
    applicants = await apiFetchApplicants(job.id, 'resume');
  } catch (e) {
    showPremiumToast(`Couldn't load candidates: ${(e && e.message) || 'backend error'}`, 'error');
    return;
  }
  applicants.forEach((c) => { c.jobApplied = job.roleName; c.jobId = job.id; });
  const others = (AppState.candidates || []).filter((c) => c.jobId !== job.id);
  AppState.candidates = [...others, ...applicants];

  // Only refresh if the user is still viewing this job.
  if (AppState.activeJobId !== job.id) return;
  renderFunnelStages(job);
  renderFunnelInsights(job);
  renderJobDetailPanes(job);
  const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(
    (c) => c.jobApplied === job.roleName || c.jobApplied === job.cardName,
  );
  requestAnimationFrame(() => {
    drawFunnelSVG(job, jobCandidates);
    drawScoreDistributionSVG(job, jobCandidates);
  });
}


export { navigateToJobDetail };
