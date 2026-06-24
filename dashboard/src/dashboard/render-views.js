import { document } from './runtime.js';
import { escapeHTML } from './escape.js';
import { drawFunnelSVG, drawScoreDistributionSVG } from './funnel-charts.js';
import { navigateToJobDetail } from './job-detail.js';
import { renderJobDetailPanes, updateCandidateStatus } from './job-detail-panes.js';
import { openJobFlowView } from './job-flow.js';
import { recalculateJobPipelines } from './kanban-swarm.js';
import { openCandidateReport } from './report.js';
import { soundEngine } from './sound.js';
import { showPremiumToast } from './sourcing.js';
import { AppState } from './state.js';
import { getDataSource, isApiMode, apiUpdateMember, apiRemoveMember, apiFetchUsageStats, apiFetchUsageCandidates } from './api.js';
import { saveStateToLocalStorage } from './ai-api.js';

// ==========================================
// RENDERING & INTERACTIVE VIEWS
// ==========================================

// 1. Render Job Cards (Jobs View)
function renderJobCards() {
  const container = document.getElementById('jobs-list-container');
  if (!container) return;

  container.innerHTML = '';
  const filteredJobs = AppState.jobs.filter(job => {
    // Filter status tabs
    if (AppState.jobsFilter !== 'all' && job.status !== AppState.jobsFilter) return false;
    // Search query
    if (AppState.globalSearch) {
      const query = AppState.globalSearch.toLowerCase();
      return job.roleName.toLowerCase().includes(query) || job.id.toLowerCase().includes(query);
    }
    return true;
  });

  // Update count indicators on filtering headers
  updateJobsCounters();

  if (filteredJobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state card-glass" style="grid-column: 1/-1; padding: 48px; text-align: center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold)" stroke-width="1.5" style="margin-bottom: 16px;">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
        </svg>
        <h3 class="type-h3" style="margin-bottom: 8px;">No jobs found</h3>
        <p class="type-caption">No job postings match your filters. Create a new job to start recruitment.</p>
      </div>
    `;
    return;
  }

  filteredJobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card';
    
    // Build safe defaults for all fields
    const createdBy = job.createdBy || globalThis.IH_USER_NAME || 'You';
    const experienceBand = job.experienceBand || 'Upto 2 Years';
    const created = job.created || 'Recently';
    const pipeline = job.pipeline || { total: 0, resume: 0, screening: 0, functional: 0 };
    const cardName = job.cardName || job.roleName || 'Untitled Job';
    const roleName = job.roleName || 'Untitled Role';
    const status = job.status || 'published';
    const jobId = job.id || 'unknown';

    // Build pipeline values
    const resumeVal = pipeline.resume === 0 || pipeline.resume === null ? '-' : pipeline.resume;
    const screeningVal = pipeline.screening === 0 || pipeline.screening === null ? '-' : pipeline.screening;
    const functionalVal = pipeline.functional === 0 || pipeline.functional === null ? '-' : pipeline.functional;

    card.innerHTML = `
      <div class="job-card-header">
        <div class="job-card-title-area">
          <h3 class="job-title">${escapeHTML(cardName)}</h3>
          <span class="job-meta-pill">Role: ${escapeHTML(roleName)}</span>
        </div>
        <div class="job-card-header-actions">
          <span class="status-badge ${status}">
            <span class="status-badge-dot"></span>
            ${escapeHTML(status.charAt(0).toUpperCase() + status.slice(1))}
          </span>
          <button class="btn-job-kebab" data-job-id="${jobId}" onclick="event.stopPropagation(); toggleJobKebab(this);" title="Job actions" aria-label="Job actions">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          <div class="job-kebab-dropdown" data-job-id="${jobId}" onclick="event.stopPropagation();" onpointerdown="event.stopPropagation();">
            <button class="kebab-item" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'edit-name')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              Edit Posting
            </button>
            <button class="kebab-item" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'view-flow')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Configure Job Flow
            </button>
            <button class="kebab-item" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'add-candidates')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              Add Candidates
            </button>
            <button class="kebab-item" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'career-page')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              ${job.listedOnCareer ? 'Remove from Career Page' : 'Publish to Career Page'}
            </button>
            <button class="kebab-item" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'duplicate')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Duplicate as Draft
            </button>
            <button class="kebab-item" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'settings')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Question Studio
            </button>
            <div class="kebab-divider"></div>
            <button class="kebab-item ${status === 'archived' ? '' : 'kebab-item-danger'}" onclick="event.stopPropagation(); handleJobKebab('${jobId}', '${status === 'archived' ? 'unarchive' : 'archive'}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
              ${status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button class="kebab-item kebab-item-danger" onclick="event.stopPropagation(); handleJobKebab('${jobId}', 'delete')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              Delete Posting
            </button>
          </div>
        </div>
      </div>
      
      <div class="job-card-details">
        <div class="detail-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span>Created: ${created}</span>
        </div>
        <div class="detail-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          <span>Experience: ${experienceBand}</span>
        </div>
      </div>

      <div class="pipeline-flow">
        <div class="pipeline-step step-total">
          <span class="step-label">Total</span>
          <span class="step-val">${pipeline.total || 0}</span>
        </div>
        ${(job.pipelineConfig?.resumeAnalysis?.enabled !== false) ? `
          <span class="pipeline-arrow">→</span>
          <div class="pipeline-step step-resume">
            <span class="step-label">Resume</span>
            <span class="step-val">${resumeVal}</span>
          </div>
        ` : ''}
        ${(job.pipelineConfig?.recruiterScreening?.enabled !== false) ? `
          <span class="pipeline-arrow">→</span>
          <div class="pipeline-step step-screening">
            <span class="step-label">Screening</span>
            <span class="step-val">${screeningVal}</span>
          </div>
        ` : ''}
        ${(job.pipelineConfig?.functionalInterview?.enabled !== false) ? `
          <span class="pipeline-arrow">→</span>
          <div class="pipeline-step step-functional">
            <span class="step-label">Functional</span>
            <span class="step-val">${functionalVal}</span>
          </div>
        ` : ''}
      </div>

      <div class="job-card-footer">
        <div class="author-info">
          <div class="author-tag">${createdBy.charAt(0)}</div>
          <span class="author-meta">${createdBy} (me) // <a href="#" class="author-link-doc" onclick="event.stopPropagation(); openJobDescriptionDrawer('${jobId}')">Job Description</a></span>
        </div>
        <button class="card-flow-cta" onclick="event.stopPropagation(); openJobFlowView('${jobId}');">
          Job Flow
        </button>
        <span class="card-responses-cta">
          View Responses
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </span>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.job-card-header-actions, .card-flow-cta, .author-link-doc')) return;
      navigateToJobDetail(jobId);
    });

    container.appendChild(card);
  });
}

function renderJobListView() {
  const container = document.getElementById('jobs-board-container');
  if (!container) return;
  container.innerHTML = '';

  const filteredJobs = AppState.jobs.filter(job => {
    if (AppState.jobsFilter !== 'all' && job.status !== AppState.jobsFilter) return false;
    if (AppState.globalSearch) {
      const query = AppState.globalSearch.toLowerCase();
      return job.roleName.toLowerCase().includes(query) || job.id.toLowerCase().includes(query);
    }
    return true;
  });

  if (filteredJobs.length === 0) {
    container.innerHTML = '<div class="empty-state card-glass" style="padding:32px;text-align:center;"><p class="type-caption">No jobs match your filters.</p></div>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'job-list-row job-list-header';
  header.innerHTML = `
    <span class="jl-col jl-title">Job Title</span>
    <span class="jl-col jl-status">Status</span>
    <span class="jl-col jl-created">Created</span>
    <span class="jl-col jl-total">Total</span>
    <span class="jl-col jl-resume">Resume</span>
    <span class="jl-col jl-screening">Screening</span>
    <span class="jl-col jl-functional">Functional</span>
    <span class="jl-col jl-action"></span>`;
  container.appendChild(header);

  filteredJobs.forEach(job => {
    const row = document.createElement('div');
    row.className = 'job-list-row';
    const p = job.pipeline || { total: 0, resume: 0, screening: 0, functional: 0 };
    const statusLabel = (job.status || 'published').charAt(0).toUpperCase() + (job.status || 'published').slice(1);
    row.innerHTML = `
      <span class="jl-col jl-title">${job.cardName || job.roleName}</span>
      <span class="jl-col jl-status"><span class="status-badge ${job.status || 'published'}"><span class="status-badge-dot"></span>${statusLabel}</span></span>
      <span class="jl-col jl-created">${job.created || '-'}</span>
      <span class="jl-col jl-total">${p.total}</span>
      <span class="jl-col jl-resume">${(job.pipelineConfig?.resumeAnalysis?.enabled !== false) ? (p.resume || '-') : '—'}</span>
      <span class="jl-col jl-screening">${(job.pipelineConfig?.recruiterScreening?.enabled !== false) ? (p.screening || '-') : '—'}</span>
      <span class="jl-col jl-functional">${(job.pipelineConfig?.functionalInterview?.enabled !== false) ? (p.functional || '-') : '—'}</span>
      <span class="jl-col jl-action"><button class="btn-jd-ghost btn-sm" style="font-size:0.72rem;">View</button></span>`;
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => navigateToJobDetail(job.id));
    container.appendChild(row);
  });
}

// Update counts displayed on filter tabs
function updateJobsCounters() {
  const allCount = AppState.jobs.length;
  const publishedCount = AppState.jobs.filter(j => j.status === 'published').length;
  const draftCount = AppState.jobs.filter(j => j.status === 'draft').length;
  const archivedCount = AppState.jobs.filter(j => j.status === 'archived').length;

  document.querySelector('.count-all').textContent = allCount;
  document.querySelector('.count-published').textContent = publishedCount;
  document.querySelector('.count-draft').textContent = draftCount;
  document.querySelector('.count-archived').textContent = archivedCount;
}

// 2. Render Table (Analytics View)
function renderAnalyticsTable() {
  const table = document.getElementById('analytics-jobs-table');
  const tbody = document.getElementById('analytics-table-body');
  if (!tbody || !table) return;

  tbody.innerHTML = '';
  
  // Dynamic header updates depending on subtab
  const headers = table.querySelector('thead tr');
  const searchVal = AppState.tableSearch.toLowerCase();
  
  if (AppState.analyticsSubtab === 'jobs-data') {
    const visible = AppState.visibleColumnsAnalyticsJobs;
    let headerHtml = '';
    
    if (visible.includes('id')) headerHtml += `<th class="sortable" data-sort="id">Job ID <span class="arrow">${AppState.jobsSortKey === 'id' ? (AppState.jobsSortAsc ? '↑' : '↓') : '↕'}</span></th>`;
    if (visible.includes('roleName')) headerHtml += `<th class="sortable" data-sort="role">Role Name <span class="arrow">${AppState.jobsSortKey === 'role' ? (AppState.jobsSortAsc ? '↑' : '↓') : '↕'}</span></th>`;
    if (visible.includes('cardName')) headerHtml += `<th class="sortable" data-sort="card">Card Name <span class="arrow">${AppState.jobsSortKey === 'card' ? (AppState.jobsSortAsc ? '↑' : '↓') : '↕'}</span></th>`;
    if (visible.includes('customJobId')) headerHtml += `<th>Custom Job ID</th>`;
    if (visible.includes('experienceBand')) headerHtml += `<th>Experience Band</th>`;
    if (visible.includes('tags')) headerHtml += `<th>Tags</th>`;
    if (visible.includes('createdBy')) headerHtml += `<th>Job Created By</th>`;
    if (visible.includes('collaborators')) headerHtml += `<th>Collaborators</th>`;
    if (visible.includes('recruiters')) headerHtml += `<th>Recruiters</th>`;
    
    headers.innerHTML = headerHtml;

    // Process Sort & Search on Jobs
    let list = [...AppState.jobs];
    if (searchVal) {
      list = list.filter(j => j.roleName.toLowerCase().includes(searchVal) || j.id.toLowerCase().includes(searchVal));
    }
    if (AppState.analyticsJobStatusFilter?.length > 0) {
      list = list.filter(j => AppState.analyticsJobStatusFilter.includes(j.status));
    }
    
    list.sort((a, b) => {
      let valA = a.id;
      let valB = b.id;
      if (AppState.jobsSortKey === 'role') {
        valA = a.roleName;
        valB = b.roleName;
      } else if (AppState.jobsSortKey === 'card') {
        valA = a.cardName;
        valB = b.cardName;
      }
      return AppState.jobsSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    document.getElementById('analytics-table-showing').textContent = `Showing 1-${list.length} of ${list.length}`;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${visible.length}" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No job data matching query</td></tr>`;
      return;
    }

    list.forEach(job => {
      const tr = document.createElement('tr');
      let cellsHtml = '';
      
      if (visible.includes('id')) cellsHtml += `<td class="cell-mono">${job.id}</td>`;
      if (visible.includes('roleName')) cellsHtml += `<td><strong>${job.roleName}</strong></td>`;
      if (visible.includes('cardName')) cellsHtml += `<td>${job.cardName}</td>`;
      if (visible.includes('customJobId')) cellsHtml += `<td>${job.customJobId}</td>`;
      if (visible.includes('experienceBand')) cellsHtml += `<td>${job.experienceBand}</td>`;
      if (visible.includes('tags')) cellsHtml += `<td style="color: var(--color-text-faint);">-</td>`;
      if (visible.includes('createdBy')) cellsHtml += `<td>${job.createdBy}</td>`;
      if (visible.includes('collaborators')) cellsHtml += `<td style="color: var(--color-text-faint);">-</td>`;
      if (visible.includes('recruiters')) cellsHtml += `<td style="color: var(--color-text-faint);">-</td>`;
      
      tr.innerHTML = cellsHtml;
      tbody.appendChild(tr);
    });

  } else {
    // Candidates data headers
    const visible = AppState.visibleColumnsAnalyticsCandidates;
    let headerHtml = '';
    
    if (visible.includes('id')) headerHtml += `<th>Candidate ID</th>`;
    if (visible.includes('name')) headerHtml += `<th>Candidate Name</th>`;
    if (visible.includes('jobApplied')) headerHtml += `<th>Job Applied</th>`;
    if (visible.includes('registeredOn')) headerHtml += `<th>Registered On</th>`;
    if (visible.includes('status')) headerHtml += `<th>Pipeline Stage</th>`;
    if (visible.includes('score')) headerHtml += `<th>Match Score</th>`;
    if (visible.includes('actions')) headerHtml += `<th>Actions</th>`;
    
    headers.innerHTML = headerHtml;

    let list = filterCandidatesByDateRange(AppState.candidates);
    if (searchVal) {
      list = list.filter(c => c.name.toLowerCase().includes(searchVal) || c.email.toLowerCase().includes(searchVal) || c.jobApplied.toLowerCase().includes(searchVal));
    }
    if (AppState.analyticsCandStageFilter?.length > 0) {
      list = list.filter(c => AppState.analyticsCandStageFilter.includes(c.status));
    }

    document.getElementById('analytics-table-showing').textContent = `Showing 1-${list.length} of ${list.length}`;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${visible.length}" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No candidates matching query</td></tr>`;
      return;
    }

    list.forEach(c => {
      const tr = document.createElement('tr');
      let cellsHtml = '';
      
      if (visible.includes('id')) cellsHtml += `<td class="cell-mono">${c.id}</td>`;
      if (visible.includes('name')) {
        cellsHtml += `
          <td>
            <div class="user-cell">
              <div class="user-avatar-mini">${escapeHTML(c.name.split(' ').map(n => n[0]).join(''))}</div>
              <div class="user-details">
                <span style="font-weight: 600;">${escapeHTML(c.name)}</span>
                <span class="user-email-mini">${escapeHTML(c.email)}</span>
              </div>
            </div>
          </td>
        `;
      }
      if (visible.includes('jobApplied')) cellsHtml += `<td>${escapeHTML(c.jobApplied)}</td>`;
      if (visible.includes('registeredOn')) cellsHtml += `<td class="cell-mono">${c.registeredOn}</td>`;
      if (visible.includes('status')) {
        cellsHtml += `
          <td>
            <span class="badge-role ${c.status === 'Screening' ? 'recruiter' : 'interviewer'}">
              <span class="badge-role-icon"></span>
              ${escapeHTML(c.status)}
            </span>
          </td>
        `;
      }
      if (visible.includes('score')) {
        cellsHtml += `
          <td>
            <strong style="color: var(--color-gold); text-shadow: 0 0 8px var(--color-gold-glow); font-family: var(--font-mono);">${c.score}</strong>
          </td>
        `;
      }
      if (visible.includes('actions')) {
        const nextStage = c.status === 'Resume' ? 'Screening' : c.status === 'Screening' ? 'Functional' : c.status === 'Functional' ? 'Hired' : null;
        cellsHtml += `
          <td>
            <div style="display:flex;gap:6px;align-items:center;justify-content:center;">
              <button class="table-btn-action btn-view-report-from-table" data-candidate-id="${c.id}" title="View Full Report">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
              ${nextStage ? `<button class="btn-stage-advance btn-tbl-advance" data-candidate-id="${c.id}" data-next-stage="${nextStage}" title="Advance to ${nextStage}" style="padding:4px 8px;font-size:0.7rem;">Advance</button>` : ''}
              ${c.status !== 'Hired' && c.status !== 'Rejected' ? `<button class="btn-stage-reject btn-tbl-reject" data-candidate-id="${c.id}" title="Reject candidate" style="padding:4px 8px;font-size:0.7rem;">Reject</button>` : ''}
            </div>
          </td>
        `;
      }
      
      tr.innerHTML = cellsHtml;
      tbody.appendChild(tr);
    });
    
    tbody.querySelectorAll('.btn-view-report-from-table').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.getAttribute('data-candidate-id');
        openCandidateReport(candId);
      });
    });

    tbody.querySelectorAll('.btn-tbl-advance').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.getAttribute('data-candidate-id');
        const nextStage = btn.getAttribute('data-next-stage');
        updateCandidateStatus(candId, nextStage);
        renderAnalyticsTable();
      });
    });

    tbody.querySelectorAll('.btn-tbl-reject').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.getAttribute('data-candidate-id');
        updateCandidateStatus(candId, 'Rejected');
        renderAnalyticsTable();
      });
    });
  }

  // Bind sort listeners on headers
  const sortHeaders = table.querySelectorAll('th.sortable');
  sortHeaders.forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (AppState.jobsSortKey === key) {
        AppState.jobsSortAsc = !AppState.jobsSortAsc;
      } else {
        AppState.jobsSortKey = key;
        AppState.jobsSortAsc = true;
      }
      soundEngine.playClick();
      renderAnalyticsTable();
    });
  });
}

// 3. Render Team Access Table (Team View)
function renderTeamTable() {
  const tbody = document.getElementById('team-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  
  const searchVal = document.getElementById('team-search').value.toLowerCase();
  const roleVal = document.getElementById('team-role-filter').value;
  
  const filteredTeam = AppState.team.filter(member => {
    // Status filters
    if (AppState.teamFilter !== 'all' && member.status.toLowerCase() !== AppState.teamFilter) return false;
    // Role filter
    if (roleVal !== 'all' && member.usertype !== roleVal) return false;
    // Search query
    if (searchVal) {
      return member.name.toLowerCase().includes(searchVal) || member.email.toLowerCase().includes(searchVal);
    }
    return true;
  });

  // Update team filters indicators
  updateTeamCounters();

  document.getElementById('team-table-showing').textContent = `Showing 1-${filteredTeam.length} of ${filteredTeam.length}`;

  const visible = AppState.visibleColumnsTeam;
  const headers = document.querySelector('#team-members-table thead tr');
  if (headers) {
    let headerHtml = '';
    if (visible.includes('member')) headerHtml += `<th>Team Member</th>`;
    if (visible.includes('designation')) headerHtml += `<th>Designation</th>`;
    if (visible.includes('usertype')) headerHtml += `<th>Usertype</th>`;
    if (visible.includes('registeredOn')) headerHtml += `<th>Registered On</th>`;
    if (visible.includes('status')) headerHtml += `<th>Status</th>`;
    if (visible.includes('actions')) headerHtml += `<th>Actions</th>`;
    headers.innerHTML = headerHtml;
  }

  if (filteredTeam.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${visible.length}" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No team members matching criteria</td></tr>`;
    return;
  }

  filteredTeam.forEach(member => {
    const tr = document.createElement('tr');
    
    // Status styles
    let statusClass = 'published';
    if (member.status === 'Invited') statusClass = 'draft';
    else if (member.status === 'Inactive') statusClass = 'archived';
    
    let cellsHtml = '';
    if (visible.includes('member')) {
      cellsHtml += `
        <td>
          <div class="user-cell">
            <div class="user-avatar-mini" style="background-color: var(--color-gold-dim); border-color: var(--color-gold); color: var(--color-gold-light);">${member.name.charAt(0)}</div>
            <div class="user-details">
              <span style="font-weight: 600;">${member.name} ${member.name === 'Devasri' ? '(me)' : ''}</span>
              <span class="user-email-mini">${member.email}</span>
            </div>
          </div>
        </td>
      `;
    }
    if (visible.includes('designation')) cellsHtml += `<td>${member.designation}</td>`;
    if (visible.includes('usertype')) {
      if (member.name === 'Devasri') {
        cellsHtml += `
          <td>
            <span class="badge-role">
              <span class="badge-role-icon"></span>
              ${member.usertype}
            </span>
          </td>
        `;
      } else {
        cellsHtml += `
          <td>
            <select class="select-styled-table team-usertype-select" data-email="${member.email}">
              <option value="Org. Admin" ${member.usertype === 'Org. Admin' ? 'selected' : ''}>Org. Admin</option>
              <option value="Recruiter" ${member.usertype === 'Recruiter' ? 'selected' : ''}>Recruiter</option>
              <option value="Interviewer" ${member.usertype === 'Interviewer' ? 'selected' : ''}>Interviewer</option>
            </select>
          </td>
        `;
      }
    }
    if (visible.includes('registeredOn')) cellsHtml += `<td class="cell-mono">${member.registeredOn}</td>`;
    if (visible.includes('status')) {
      if (member.name === 'Devasri') {
        cellsHtml += `
          <td>
            <span class="status-badge published">
              <span class="status-badge-dot"></span>
              ${member.status}
            </span>
          </td>
        `;
      } else {
        cellsHtml += `
          <td>
            <select class="select-styled-table team-status-select" data-email="${member.email}">
              <option value="Active" ${member.status === 'Active' ? 'selected' : ''}>Active</option>
              <option value="Inactive" ${member.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
              <option value="Invited" ${member.status === 'Invited' ? 'selected' : ''}>Invited</option>
            </select>
          </td>
        `;
      }
    }
    if (visible.includes('actions')) {
      cellsHtml += `
        <td>
          <button class="table-btn-action btn-revoke-member" data-email="${member.email}" style="color: var(--color-orange);" title="Deactivate/Revoke Member" ${member.name === 'Devasri' ? 'disabled style="opacity: 0.2; cursor: not-allowed;"' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          </button>
        </td>
      `;
    }
    
    tr.innerHTML = cellsHtml;
    tbody.appendChild(tr);
  });

  // Bind change/click events to inline dropdowns & buttons
  tbody.querySelectorAll('.team-usertype-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const email = sel.getAttribute('data-email');
      const member = AppState.team.find(m => m.email === email);
      if (!member) return;
      const prev = member.usertype;
      const next = e.target.value;
      // Persist to the shared DB first; revert the dropdown if the backend rejects.
      if (isApiMode() && member.backendId) {
        try {
          await apiUpdateMember(member.backendId, { usertype: next });
        } catch (err) {
          sel.value = prev;
          showPremiumToast(`Could not update ${member.name}'s role: ${(err && err.message) || 'backend error'}`, 'error');
          return;
        }
      }
      member.usertype = next;
      saveStateToLocalStorage();
      soundEngine.playChime([523.25], 0.1);
      showPremiumToast(`${member.name}'s role updated to ${member.usertype}.`, 'success');
      renderTeamTable();
    });
  });

  tbody.querySelectorAll('.team-status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const email = sel.getAttribute('data-email');
      const member = AppState.team.find(m => m.email === email);
      if (!member) return;
      const prev = member.status;
      const next = e.target.value;
      if (isApiMode() && member.backendId) {
        try {
          await apiUpdateMember(member.backendId, { status: next });
        } catch (err) {
          sel.value = prev;
          showPremiumToast(`Could not update ${member.name}'s status: ${(err && err.message) || 'backend error'}`, 'error');
          return;
        }
      }
      member.status = next;
      saveStateToLocalStorage();
      soundEngine.playChime([523.25], 0.1);
      showPremiumToast(`${member.name}'s status updated to ${member.status}.`, 'success');
      renderTeamTable();
    });
  });

  tbody.querySelectorAll('.btn-revoke-member').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      const member = AppState.team.find(m => m.email === email);
      if (!member) return;
      if (isApiMode() && member.backendId) {
        try {
          await apiRemoveMember(member.backendId);
        } catch (err) {
          showPremiumToast(`Could not revoke ${member.name}: ${(err && err.message) || 'backend error'}`, 'error');
          return;
        }
      }
      AppState.team = AppState.team.filter(m => m.email !== email);
      saveStateToLocalStorage();
      soundEngine.playChime([392, 293.66], 0.15, 0.08);
      showPremiumToast(`${member.name} has been revoked from the team access list.`, 'success');
      renderTeamTable();
    });
  });
}

function updateTeamCounters() {
  const total = AppState.team.length;
  const active = AppState.team.filter(t => t.status === 'Active').length;
  const invited = AppState.team.filter(t => t.status === 'Invited').length;
  const inactive = AppState.team.filter(t => t.status === 'Inactive').length;

  document.querySelector('.team-count-all').textContent = total;
  document.querySelector('.team-count-active').textContent = active;
  document.querySelector('.team-count-invited').textContent = invited;
  document.querySelector('.team-count-inactive').textContent = inactive;
}

// 4. Update Summary Metrics (Analytics View Header Stats)
function parseFuzzyDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  const m = str.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (m) return new Date(`${m[2]} ${m[1]}, ${m[3]}`);
  const m2 = str.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m2) return new Date(`${m2[1]} ${m2[2]}, ${m2[3]}`);
  return null;
}

function getDateRangeBounds() {
  const now = new Date();
  if (AppState.dateRange === 'custom') {
    const from = document.getElementById('date-from')?.value || document.getElementById('jd-date-from')?.value || AppState.customDateFrom;
    const to = document.getElementById('date-to')?.value || document.getElementById('jd-date-to')?.value || AppState.customDateTo;
    return { start: from ? new Date(from) : null, end: to ? new Date(to + 'T23:59:59') : null };
  }
  if (AppState.dateRange === 'all') return { start: null, end: null };
  const days = { '7d': 7, '30d': 30, '90d': 90 }[AppState.dateRange] || 7;
  const start = new Date(now); start.setDate(start.getDate() - days);
  return { start, end: now };
}

function applyDateRangeGlobally() {
  const { start, end } = getDateRangeBounds();
  const rangeLabel = AppState.dateRange === 'all' ? 'All Time' :
    AppState.dateRange === 'custom' ? 'Custom range' :
    AppState.dateRange === '7d' ? 'Last 7 days' :
    AppState.dateRange === '30d' ? 'Last 30 days' : 'Last 90 days';

  recalculateJobPipelines();
  // API mode: cards are authoritative from the org-scoped backend; local mode
  // derives them from AppState. The table re-renders from AppState.candidates
  // (already the real set in API mode) and filters by date client-side.
  if (isApiMode()) refreshUsageStats(); else updateSummaryMetrics();
  renderAnalyticsTable();
  renderJobCards();

  const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
  if (activeJob) {
    const jobCandidates = filterCandidatesByDateRange(
      AppState.candidates.filter(c => {
        if (getDataSource() === 'api' && activeJob._backend) {
          return c.jobId === activeJob.id;
        }
        return c.jobApplied === activeJob.roleName || c.jobApplied === activeJob.cardName;
      })
    );
    drawFunnelSVG(activeJob, jobCandidates);
    drawScoreDistributionSVG(activeJob, jobCandidates);
    renderJobDetailPanes(activeJob);
  }

  showPremiumToast(`${rangeLabel} — showing ${filterCandidatesByDateRange(AppState.candidates).length} of ${AppState.candidates.length} candidates.`, 'success');
}

function filterCandidatesByDateRange(candidates) {
  const { start, end } = getDateRangeBounds();
  if (!start && !end) return candidates;
  return candidates.filter(c => {
    const d = parseFuzzyDate(c.registeredOn);
    if (!d) return true;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}

function updateSummaryMetrics() {
  const filtered = filterCandidatesByDateRange(AppState.candidates);

  const totalApplicants = filtered.length;
  const resumeCount = filtered.filter(c => c.status === 'Resume').length;
  const screeningCount = filtered.filter(c => c.status === 'Screening').length;
  const functionalCount = filtered.filter(c => c.status === 'Functional').length;

  document.getElementById('stat-total-applicants').textContent = totalApplicants;
  document.getElementById('stat-resume-analysis').textContent = resumeCount;
  document.getElementById('stat-recruiter-screening').textContent = screeningCount;
  document.getElementById('stat-functional-interview').textContent = functionalCount;

  const bySource = { 'Career Page': 0, 'Bulk Upload': 0, 'Scheduled': 0, 'Direct Link': 0, 'ATS': 0 };
  filtered.forEach(c => { if (bySource[c.source] !== undefined) bySource[c.source]++; });

  const appPills = document.querySelectorAll('.card-metric:nth-child(1) .m-pill .v');
  if (appPills.length >= 4) {
    appPills[0].textContent = bySource['Career Page'];
    appPills[1].textContent = bySource['Bulk Upload'];
    appPills[2].textContent = bySource['Scheduled'];
    appPills[3].textContent = bySource['Direct Link'];
  }

  const resPills = document.querySelectorAll('.card-metric:nth-child(2) .m-pill .v');
  if (resPills.length >= 3) {
    const analysed = filtered.filter(c => c.status === 'Resume' && c.score !== '—').length;
    resPills[0].textContent = analysed;
    resPills[1].textContent = filtered.filter(c => c.status === 'Screening' || c.status === 'Functional').length;
    resPills[2].textContent = 0;
  }

  const scrPills = document.querySelectorAll('.card-metric:nth-child(3) .m-pill .v');
  if (scrPills.length >= 4) {
    const attempted = filtered.filter(c => c.status === 'Screening' && c.interviewStatus === 'Completed').length;
    const scheduled = filtered.filter(c => c.status === 'Screening' && c.interviewStatus !== 'Completed').length;
    scrPills[0].textContent = attempted;
    scrPills[1].textContent = scheduled;
    scrPills[2].textContent = 0;
    scrPills[3].textContent = 0;
  }

  const funPills = document.querySelectorAll('.card-metric:nth-child(4) .m-pill .v');
  if (funPills.length >= 4) {
    const attempted = filtered.filter(c => c.status === 'Functional' && c.interviewStatus === 'Completed').length;
    const scheduled = filtered.filter(c => c.status === 'Functional' && c.interviewStatus !== 'Completed').length;
    funPills[0].textContent = attempted;
    funPills[1].textContent = scheduled;
    funPills[2].textContent = 0;
    funPills[3].textContent = 0;
  }
}


// ── API-mode Usage Overview ─────────────────────────────────────────────────
// In API mode the four headline cards + funnel pills come straight from the
// backend's org-scoped /usage/stats (authoritative funnel rules), and the
// candidate table from /usage/candidates-table — NOT re-derived from the demo
// AppState.candidates. updateSummaryMetrics() above stays the local-mode path.

// Write a UsageStatsOut object into the four cards + their pills. Pure DOM; the
// field→pill order matches the card markup in dashboard-crystal.js.
function applyUsageStats(s) {
  if (!s) return;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? 0; };
  setText('stat-total-applicants', s.total_applicants);
  setText('stat-resume-analysis', s.resume_analysed);
  setText('stat-recruiter-screening', s.screening_attempted);
  setText('stat-functional-interview', s.functional_attempted);

  const setPills = (n, vals) => {
    const pills = document.querySelectorAll(`.card-metric:nth-child(${n}) .m-pill .v`);
    vals.forEach((v, i) => { if (pills[i]) pills[i].textContent = v ?? 0; });
  };
  setPills(1, [s.career_page, s.bulk_upload, s.scheduled, s.direct_link]);
  setPills(2, [s.resume_analysed, s.resume_shortlisted, s.resume_waitlisted]);
  setPills(3, [s.screening_attempted, s.screening_scheduled, s.screening_shortlisted, s.screening_waitlisted]);
  setPills(4, [s.functional_attempted, s.functional_scheduled, s.functional_shortlisted, s.functional_waitlisted]);
}

// Re-pull just the stat cards for the current date range (used when only the
// range changes — the candidate list is filtered client-side, so no refetch).
async function refreshUsageStats() {
  try {
    const { start, end } = getDateRangeBounds();
    applyUsageStats(await apiFetchUsageStats(start, end));
  } catch (e) {
    showPremiumToast(`Couldn't refresh usage stats: ${e.message || e}`, 'error');
  }
}

// Single entry point for the Usage Overview page. API mode: fetch the org-scoped
// stats + candidates together, join each candidate's role title from the already
// org-hydrated AppState.jobs, replace AppState.candidates with the real set, then
// paint the cards + table. Local/zero-key mode: the original local derivation.
async function hydrateUsageAnalytics() {
  if (!isApiMode()) {
    updateSummaryMetrics();
    renderAnalyticsTable();
    return;
  }
  try {
    const { start, end } = getDateRangeBounds();
    const [stats, candidates] = await Promise.all([
      apiFetchUsageStats(start, end),
      apiFetchUsageCandidates(),
    ]);
    candidates.forEach((c) => {
      const job = AppState.jobs.find((j) => j.id === c.jobId);
      c.jobApplied = job ? (job.roleName || job.cardName || '') : (c.jobApplied || '');
    });
    AppState.candidates = candidates;
    applyUsageStats(stats);
    renderAnalyticsTable();
  } catch (e) {
    showPremiumToast(`Couldn't load usage data: ${e.message || e}`, 'error');
  }
}


export { applyDateRangeGlobally, filterCandidatesByDateRange, getDateRangeBounds, hydrateUsageAnalytics, parseFuzzyDate, renderAnalyticsTable, renderJobCards, renderJobListView, renderTeamTable, updateJobsCounters, updateSummaryMetrics, updateTeamCounters };
