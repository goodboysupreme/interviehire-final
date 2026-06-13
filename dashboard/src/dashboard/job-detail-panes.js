import { document, requestAnimationFrame, setTimeout } from './runtime.js';
import { escapeHTML } from './escape.js';
import { saveStateToLocalStorage } from './ai-api.js';
import { renderDeepAnalysisPane } from './deep-analysis.js';
import { drawFunnelSVG, drawScoreDistributionSVG } from './funnel-charts.js';
import { openJobFlowView, renderFunnelInsights, renderFunnelStages } from './job-flow.js';
import { stopActiveCardPlayer, toggleCardPlayer } from './kanban-dnd.js';
import { recalculateJobPipelines, renderKanbanBoard } from './kanban-swarm.js';
import { triggerExcelExport } from './navigation.js';
import { renderBlueprintStudio } from './blueprint-studio.js';
import { filterCandidatesByDateRange, renderAnalyticsTable, renderJobCards, updateSummaryMetrics } from './render-views.js';
import { openReportDrawerForCandidate } from './report.js';
import { applyStageFilters, buildFilterDropdown, hasActiveFilters, openScheduleModal, renderResumeStagePaneForJob, toggleResumeCriteriaEdit } from './resume-analysis.js';
import { renderScoringEditor } from './scoring-config.js';
import { soundEngine } from './sound.js';
import { showPremiumToast } from './sourcing.js';
import { AppState } from './state.js';
import { activeCandidateSubTabs } from './vetting-data.js';

function renderJobDetailPanes(job) {
  const searchVal = document.getElementById('jd-candidate-search').value.trim().toLowerCase();
  
  const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(c => {
    const matchesJob = c.jobApplied === job.roleName || c.jobApplied === job.cardName;
    if (!matchesJob) return false;
    if (searchVal) {
      return c.name.toLowerCase().includes(searchVal) || c.email.toLowerCase().includes(searchVal);
    }
    return true;
  });

  // 1. Resume pane — criteria config + candidates table
  const resumeList = document.getElementById('list-stage-resume');
  if (resumeList) {
    const resumeCands = jobCandidates.filter(c => c.status === 'Resume');
    const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };

    const criteriaHTML = `
      <div class="ra-config-section">
        <div class="ra-config-header">
          <div class="ra-config-header-left">
            <h3 class="ra-config-title">Resume Analysis</h3>
            <p class="ra-config-subtitle">Parameters created based on your requirements — feel free to edit them</p>
          </div>
          <button class="btn-ra-edit-criteria" id="btn-ra-edit-criteria">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
        </div>

        <div class="ra-criteria-group must-have">
          <div class="ra-criteria-group-header">
            <span class="ra-criteria-icon must-have">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </span>
            <div>
              <h4 class="ra-criteria-group-title must-have">Must Have</h4>
              <p class="ra-criteria-group-desc">Candidates meeting these criteria will be shortlisted; others waitlisted for review</p>
            </div>
          </div>
          <div class="ra-criteria-items">
            ${criteria.mustHave.map((item, i) => `
              <div class="ra-criteria-item must-have">
                <span class="ra-criteria-num must-have">${i + 1}</span>
                <span class="ra-criteria-text">${item}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="ra-criteria-divider">
          <span class="ra-criteria-divider-text">AND</span>
        </div>

        <div class="ra-criteria-group red-flags">
          <div class="ra-criteria-group-header">
            <span class="ra-criteria-icon red-flags">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </span>
            <div>
              <h4 class="ra-criteria-group-title red-flags">Should Not Have (Red Flags)</h4>
              <p class="ra-criteria-group-desc">Candidates with no red flags will be shortlisted; others waitlisted for review</p>
            </div>
          </div>
          <div class="ra-criteria-items">
            ${criteria.redFlags.map((item, i) => `
              <div class="ra-criteria-item red-flags">
                <span class="ra-criteria-num red-flags">${i + 1}</span>
                <span class="ra-criteria-text">${item}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="ra-criteria-divider">
          <span class="ra-criteria-divider-text">AND</span>
        </div>

        <div class="ra-criteria-group good-to-have">
          <div class="ra-criteria-group-header">
            <span class="ra-criteria-icon good-to-have">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <div>
              <h4 class="ra-criteria-group-title good-to-have">Good To Have</h4>
              <p class="ra-criteria-group-desc">Candidates meeting the threshold will be shortlisted; others waitlisted for review.</p>
            </div>
          </div>
          <div class="ra-criteria-min-match">Minimum match: ${criteria.goodToHaveMinMatch} out of ${criteria.goodToHave.length} criteria</div>
          <div class="ra-criteria-items">
            ${criteria.goodToHave.map((item, i) => `
              <div class="ra-criteria-item good-to-have">
                <span class="ra-criteria-num good-to-have">${i + 1}</span>
                <span class="ra-criteria-text">${item}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="ra-candidates-section">
        <div class="ra-candidates-header">
          <h3 class="ra-candidates-title">Candidates in Resume Analysis</h3>
          <span class="ra-candidates-count">${resumeCands.length} candidate${resumeCands.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="jd-stage-candidates-list" id="list-stage-resume-candidates"></div>
      </div>
    `;

    resumeList.innerHTML = criteriaHTML;
    resumeList.querySelector('.ra-config-section')?.remove();
    resumeList.insertAdjacentHTML('afterbegin', `
      <div class="ra-flow-redirect">
        <div>
          <h3 class="ra-candidates-title">Resume Analysis Candidates</h3>
          <p class="ra-flow-redirect-copy">Shortlist rules live in Job Flow so setup and evaluation stay separated.</p>
        </div>
        <button class="btn-jd-ghost" id="btn-resume-edit-flow">Edit Rules in Job Flow</button>
      </div>
      <div id="ra-scoring-editor-root"></div>
    `);
    document.getElementById('btn-resume-edit-flow')?.addEventListener('click', () => {
      openJobFlowView(job.id);
      requestAnimationFrame(() => {
        document.querySelector('.jf-stage-card[data-stage="resumeAnalysis"]')?.click();
      });
    });

    const scoringRoot = document.getElementById('ra-scoring-editor-root');
    if (scoringRoot) renderScoringEditor(job, scoringRoot);

    const resumeCandContainer = document.getElementById('list-stage-resume-candidates');
    if (resumeCandContainer) {
      if (resumeCands.length === 0) {
        resumeCandContainer.innerHTML = `
          <div class="jd-empty-pane">
            <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            <p>No candidates in resume analysis stage yet</p>
          </div>
        `;
      } else {
        renderResumeStagePaneForJob(resumeCands, job, resumeCandContainer);
      }
    }

    // Edit criteria button
    const editBtn = document.getElementById('btn-ra-edit-criteria');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        toggleResumeCriteriaEdit(job);
      });
    }
  }

  // 2. Screening pane
  const screeningList = document.getElementById('list-stage-screening');
  if (screeningList) {
    const screeningCands = jobCandidates.filter(c => c.status === 'Screening');
    if (screeningCands.length === 0) {
      screeningList.innerHTML = `
        <div class="jd-empty-pane">
          <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
          <p>Recruiter Screening — No candidates in this stage</p>
        </div>
      `;
    } else {
      const statusIcon = (status) => {
        if (status === 'Completed') return '<span class="status-chip completed"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Completed</span>';
        if (status === 'Incomplete') return '<span class="status-chip incomplete"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg> Incomplete</span>';
        if (status === 'Slot Missed') return '<span class="status-chip slot-missed"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg> Slot Missed</span>';
        return '<span class="status-chip">—</span>';
      };

      const allScreeningCands = screeningCands;
      const displayScreeningCands = applyStageFilters(screeningCands, 'screening');
      const sf = AppState.stageFilters.screening;
      screeningList.innerHTML = `
        <div class="stage-table-container">
          <div class="stage-table-filters">
            <span class="filter-chip" data-filter="interviewStatus" data-stage="screening">${sf.interviewStatus.length ? '⊗' : '⊕'} Interview Status ${sf.interviewStatus.length ? `<span class="filter-chip-val">${sf.interviewStatus.join(', ')}</span>` : ''}</span>
            <span class="filter-chip" data-filter="cheatProb" data-stage="screening">${sf.cheatProb.length ? '⊗' : '⊕'} Cheat Probability ${sf.cheatProb.length ? `<span class="filter-chip-val">${sf.cheatProb.join(', ')}</span>` : ''}</span>
            <span class="filter-chip" data-filter="recruiterScreening" data-stage="screening">⊕ Recruiter Screening ${sf.recruiterScreening.length ? `<span class="filter-chip-val">${sf.recruiterScreening.join(', ')}</span>` : ''}</span>
            <span class="filter-chip" data-filter="interviewScore" data-stage="screening">⊕ Interview Score</span>
            ${hasActiveFilters('screening') ? '<button class="btn-filter-reset" data-stage="screening">✕ Reset</button>' : ''}
            <div class="stage-table-actions-bar">
              <button class="btn-bulk-actions">Bulk Actions <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
              <button class="btn-columns-toggle"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg> Columns</button>
              <button class="btn-export-table"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>
            </div>
          </div>
          <table class="stage-data-table">
            <thead>
              <tr>
                <th><input type="checkbox" class="table-checkbox-all" /></th>
                <th>Candidate</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Screening</th>
                <th>Score <span class="sort-arrows">⇅</span></th>
                <th>Report</th>
                <th>Source</th>
                <th>Attempted <span class="sort-arrows">⇅</span></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${displayScreeningCands.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--color-text-faint);">No candidates match the current filters. Try resetting or adjusting them.</td></tr>' : ''}
              ${displayScreeningCands.map(c => {
                const initials = c.name.split(' ').map(n=>n[0]).join('');
                const hasReport = c.interviewStatus === 'Incomplete' || c.interviewStatus === 'Completed';
                const sourceIcon = c.source === 'Direct Link' ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>';
                const actionLabel = c.interviewStatus === 'Slot Missed' ? 'Reschedule' : 'Schedule';
                const actionClass = c.interviewStatus === 'Slot Missed' ? 'btn-reschedule' : 'btn-schedule';
                return `
                  <tr data-candidate-id="${c.id}">
                    <td><input type="checkbox" class="table-checkbox-row" /></td>
                    <td>
                      <div class="table-candidate-cell">
                        <span class="cand-name-link">${escapeHTML(c.name)} <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></span>
                        <button class="btn-remarks">Remarks</button>
                        <span class="cand-email-sub">${escapeHTML(c.email)}</span>
                      </div>
                    </td>
                    <td>${c.phone ? escapeHTML(c.phone) : '—'}</td>
                    <td>${statusIcon(c.interviewStatus)}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>${hasReport ? `<a href="#" class="report-link" data-cand-id="${c.id}">Report <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>` : '—'}</td>
                    <td><span class="source-badge">${sourceIcon} ${c.source || '—'}</span></td>
                    <td>${c.attemptedAt || '—'}</td>
                    <td><button class="${actionClass}" data-candidate-id="${c.id}">${c.interviewStatus === 'Slot Missed' ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> ' : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg> '}${actionLabel}</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div class="stage-table-footer">
            <span class="table-selection-info">0 of ${displayScreeningCands.length} row(s) selected.</span>
            <div class="table-pagination">
              <span>Rows per page</span>
              <select class="rows-per-page"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select>
              <span>Page 1 of 1</span>
              <div class="pagination-btns">
                <button disabled>«</button><button disabled>‹</button><button disabled>›</button><button disabled>»</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  // 3. Functional pane
  const functionalList = document.getElementById('list-stage-functional');
  if (functionalList) {
    const functionalCands = jobCandidates.filter(c => c.status === 'Functional');
    if (functionalCands.length === 0) {
      functionalList.innerHTML = `
        <div class="jd-empty-pane">
          <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
          <p>Functional Interview — No candidates in this stage</p>
        </div>
      `;
    } else {
      const cheatColor = (prob) => {
        if (prob === 'Low') return 'cheat-low';
        if (prob === 'Medium') return 'cheat-medium';
        if (prob === 'High') return 'cheat-high';
        return '';
      };
      const scoreColor = (score) => {
        if (score == null) return '';
        if (score >= 80) return 'score-green';
        if (score >= 60) return 'score-yellow';
        return 'score-red';
      };
      const screeningBadge = (val) => {
        if (!val) return '—';
        const cls = val === 'Good fit' ? 'fit-good' : val === 'Moderate fit' ? 'fit-moderate' : 'fit-poor';
        return `<span class="screening-fit-badge ${cls}">${val}</span>`;
      };

      const allFunctionalCands = functionalCands;
      const displayFunctionalCands = applyStageFilters(functionalCands, 'functional');
      const ff = AppState.stageFilters.functional;
      functionalList.innerHTML = `
        <div class="stage-table-container">
          <div class="stage-table-filters">
            <span class="filter-chip" data-filter="interviewStatus" data-stage="functional">${ff.interviewStatus.length ? '⊗' : '⊕'} Interview Status ${ff.interviewStatus.length ? `<span class="filter-chip-val">${ff.interviewStatus.join(', ')}</span>` : ''}</span>
            <span class="filter-chip" data-filter="cheatProb" data-stage="functional">${ff.cheatProb.length ? '⊗' : '⊕'} Cheat Probability ${ff.cheatProb.length ? `<span class="filter-chip-val">${ff.cheatProb.join(', ')}</span>` : ''}</span>
            <span class="filter-chip" data-filter="interviewScore" data-stage="functional">⊕ Interview Score</span>
            <span class="filter-chip" data-filter="recruiterScreening" data-stage="functional">⊕ Recruiter Screening ${ff.recruiterScreening.length ? `<span class="filter-chip-val">${ff.recruiterScreening.join(', ')}</span>` : ''}</span>
            <span class="filter-chip" data-filter="actions" data-stage="functional">⊕ Actions</span>
            ${hasActiveFilters('functional') ? '<button class="btn-filter-reset" data-stage="functional">✕ Reset</button>' : ''}
            <div class="stage-table-actions-bar">
              <button class="btn-bulk-actions">Bulk Reschedule <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
              <button class="btn-columns-toggle"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg> Columns</button>
              <button class="btn-export-table"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>
            </div>
          </div>
          <table class="stage-data-table">
            <thead>
              <tr>
                <th><input type="checkbox" class="table-checkbox-all" /></th>
                <th>Candidate</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Report</th>
                <th>Score <span class="sort-arrows">⇅</span></th>
                <th>Cheat <span class="sort-arrows">⇅</span></th>
                <th>Source</th>
                <th>Screening</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${displayFunctionalCands.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--color-text-faint);">No candidates match the current filters. Try resetting or adjusting them.</td></tr>' : ''}
              ${displayFunctionalCands.map(c => {
                const initials = c.name.split(' ').map(n=>n[0]).join('');
                const sourceIcon = c.source === 'Direct Link' ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>';
                return `
                  <tr data-candidate-id="${c.id}">
                    <td><input type="checkbox" class="table-checkbox-row" /></td>
                    <td>
                      <div class="table-candidate-cell">
                        <span class="cand-name-link">${escapeHTML(c.name)} <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></span>
                        <button class="btn-remarks">Remarks</button>
                        <span class="cand-email-sub">${escapeHTML(c.email)}</span>
                      </div>
                    </td>
                    <td>${c.phone ? escapeHTML(c.phone) : '—'}</td>
                    <td><span class="status-chip completed"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Completed</span></td>
                    <td><a href="#" class="report-link report-new" data-cand-id="${c.id}">Report <span class="new-badge">New</span> <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a></td>
                    <td><span class="interview-score-dot ${scoreColor(c.interviewScore)}"></span> ${c.interviewScore != null ? c.interviewScore : '—'}</td>
                    <td><span class="cheat-prob-badge ${cheatColor(c.cheatProbability)}">${c.cheatProbability ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg> ' + c.cheatProbability : '—'}</span></td>
                    <td><span class="source-badge">${sourceIcon} ${c.source || '—'}</span></td>
                    <td>${screeningBadge(c.recruiterScreening)}</td>
                    <td>
                      <select class="action-select-status">
                        <option value="">Select Sta...</option>
                        <option value="advance">Advance</option>
                        <option value="reject">Reject</option>
                        <option value="hold">Hold</option>
                      </select>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div class="stage-table-footer">
            <span class="table-selection-info">0 of ${displayFunctionalCands.length} row(s) selected.</span>
            <div class="table-pagination">
              <span>Rows per page</span>
              <select class="rows-per-page"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select>
              <span>Page 1 of 1</span>
              <div class="pagination-btns">
                <button disabled>«</button><button disabled>‹</button><button disabled>›</button><button disabled>»</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  // 4. Deep Analysis pane
  const analysisList = document.getElementById('list-stage-analysis');
  if (analysisList) {
    renderDeepAnalysisPane(job, analysisList);
  }

  // Bind actions
  const pane = document.getElementById('view-job-detail');
  if (pane) {
    pane.querySelectorAll('.subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.parentElement.getAttribute('data-cand-id');
        const tabName = btn.getAttribute('data-tab');
        
        // Stop audio playing if swapping tabs
        stopActiveCardPlayer();
        
        activeCandidateSubTabs[candId] = tabName;
        soundEngine.playClick();
        renderJobDetailPanes(job);
      });
    });

    pane.querySelectorAll('.btn-stage-reject').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.getAttribute('data-candidate-id');
        updateCandidateStatus(candId, 'Rejected');
      });
    });
    
    pane.querySelectorAll('.btn-stage-advance').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.getAttribute('data-candidate-id');
        const nextStage = btn.getAttribute('data-next-stage');
        updateCandidateStatus(candId, nextStage);
      });
    });

    pane.querySelectorAll('.btn-player-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const candId = btn.getAttribute('data-play-id');
        toggleCardPlayer(candId);
      });
    });

    pane.querySelectorAll('.report-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const candId = link.getAttribute('data-cand-id');
        openReportDrawerForCandidate(candId);
      });
    });

    pane.querySelectorAll('.table-checkbox-all').forEach(cb => {
      cb.addEventListener('change', () => {
        const table = cb.closest('table');
        const rows = table.querySelectorAll('.table-checkbox-row');
        rows.forEach(r => { r.checked = cb.checked; });
        const info = cb.closest('.stage-table-container').querySelector('.table-selection-info');
        if (info) info.textContent = `${cb.checked ? rows.length : 0} of ${rows.length} row(s) selected.`;
        soundEngine.playClick();
      });
    });

    pane.querySelectorAll('.table-checkbox-row').forEach(cb => {
      cb.addEventListener('change', () => {
        const table = cb.closest('table');
        const rows = table.querySelectorAll('.table-checkbox-row');
        const checked = table.querySelectorAll('.table-checkbox-row:checked').length;
        const info = cb.closest('.stage-table-container').querySelector('.table-selection-info');
        if (info) info.textContent = `${checked} of ${rows.length} row(s) selected.`;
      });
    });

    const jobCands = AppState.candidates.filter(c => c.jobApplied === job.roleName || c.jobApplied === job.cardName);
    const stageStatusMap = { screening: 'Screening', functional: 'Functional' };
    pane.querySelectorAll('.filter-chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        soundEngine.playClick();
        const filterType = chip.getAttribute('data-filter');
        const stageKey = chip.getAttribute('data-stage');
        const stageStatus = stageStatusMap[stageKey];
        const stageCands = stageStatus ? jobCands.filter(c => c.status === stageStatus) : jobCands;
        buildFilterDropdown(chip, filterType, stageCands, stageKey);
      });
    });

    pane.querySelectorAll('.btn-filter-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        soundEngine.playClick();
        const stageKey = btn.getAttribute('data-stage');
        if (stageKey && AppState.stageFilters[stageKey]) {
          AppState.stageFilters[stageKey] = { interviewStatus: [], cheatProb: [], recruiterScreening: [], scoreMin: null, scoreMax: null, actions: [] };
          renderJobDetailPanes(job);
        }
      });
    });

    pane.querySelectorAll('.btn-bulk-actions').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        soundEngine.playClick();
        const existing = btn.parentElement.querySelector('.bulk-actions-dropdown');
        if (existing) { existing.remove(); return; }
        document.querySelectorAll('.bulk-actions-dropdown').forEach(d => d.remove());

        const container = btn.closest('.stage-table-container');
        const checked = container?.querySelectorAll('.table-checkbox-row:checked') || [];

        const getSelected = () => {
          const ids = [], names = [];
          checked.forEach(cb => {
            const row = cb.closest('tr');
            const cid = row?.getAttribute('data-candidate-id');
            const name = row?.querySelector('.cand-name-link')?.textContent?.trim();
            if (cid) ids.push(cid);
            if (name) names.push(name);
          });
          return { ids, names };
        };

        const dd = document.createElement('div');
        dd.className = 'bulk-actions-dropdown';
        dd.innerHTML = `
          <button class="bulk-dd-item" data-action="advance"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg> Advance</button>
          <button class="bulk-dd-item" data-action="reject"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Reject</button>
          <button class="bulk-dd-item" data-action="schedule"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg> Schedule</button>
          <button class="bulk-dd-item" data-action="reschedule"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Reschedule</button>
          <button class="bulk-dd-item" data-action="export"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>`;
        dd.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const item = ev.target.closest('.bulk-dd-item');
          if (!item) return;
          const action = item.getAttribute('data-action');
          const { ids, names } = getSelected();
          if (ids.length === 0 && action !== 'export') {
            showPremiumToast("Select candidates using checkboxes first.", "info");
            dd.remove();
            return;
          }
          const label = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
          if (action === 'advance') {
            const stages = ['Resume', 'Screening', 'Functional', 'Hired'];
            ids.forEach(cid => {
              const cand = AppState.candidates.find(c => c.id === cid);
              if (cand) {
                const idx = stages.indexOf(cand.status);
                if (idx < stages.length - 1) {
                  const next = stages[idx + 1];
                  cand.status = next;
                  if ((next === 'Screening' || next === 'Functional') && cand.interviewStatus == null) {
                    cand.interviewStatus = 'Not Started';
                  }
                }
              }
            });
            saveStateToLocalStorage();
            renderJobDetailPanes(job);
            showPremiumToast(`Advanced ${ids.length} candidate(s) to next stage.`, 'success');
          } else if (action === 'reject') {
            ids.forEach(cid => {
              const cand = AppState.candidates.find(c => c.id === cid);
              if (cand) cand.status = 'Rejected';
            });
            saveStateToLocalStorage();
            renderJobDetailPanes(job);
            showPremiumToast(`Rejected ${ids.length} candidate(s).`, 'success');
          } else if (action === 'schedule' || action === 'reschedule') {
            openScheduleModal(label, action, (date, time) => {
              ids.forEach(cid => {
                const cand = AppState.candidates.find(c => c.id === cid);
                if (cand) {
                  cand.attemptedAt = `${date} ${time}`;
                  cand.interviewStatus = action === 'reschedule' ? 'Incomplete' : 'Not Started';
                }
              });
              saveStateToLocalStorage();
              renderJobDetailPanes(job);
              showPremiumToast(`${action === 'schedule' ? 'Scheduled' : 'Rescheduled'} ${ids.length} candidate(s) to ${date} at ${time}.`, 'success');
            });
          } else if (action === 'export') {
            triggerExcelExport('candidates');
          }
          dd.remove();
        });
        btn.style.position = 'relative';
        btn.appendChild(dd);
        const closeDD = (ev) => { if (!dd.contains(ev.target) && ev.target !== btn) { dd.remove(); document.removeEventListener('click', closeDD); } };
        setTimeout(() => document.addEventListener('click', closeDD), 0);
      });
    });

    pane.querySelectorAll('.btn-export-table').forEach(btn => {
      btn.addEventListener('click', () => {
        soundEngine.playClick();
        triggerExcelExport('candidates');
      });
    });

    pane.querySelectorAll('.btn-reschedule, .btn-schedule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        soundEngine.playClick();
        const name = btn.closest('tr')?.querySelector('.cand-name-link')?.textContent?.trim() || 'Candidate';
        const mode = btn.classList.contains('btn-reschedule') ? 'reschedule' : 'schedule';
        const candId = btn.getAttribute('data-candidate-id');
        openScheduleModal(name, mode, (date, time) => {
          const cand = AppState.candidates.find(c => c.id === candId);
          if (cand) {
            cand.interviewStatus = mode === 'reschedule' ? 'Incomplete' : 'Not Started';
            cand.attemptedAt = `${date} ${time}`;
            saveStateToLocalStorage();
            renderJobDetailPanes(job);
          }
        });
      });
    });

    pane.querySelectorAll('.action-select-status').forEach(sel => {
      sel.addEventListener('change', () => {
        soundEngine.playClick();
        const candId = sel.getAttribute('data-cand-id');
        const newVal = sel.value;
        if (candId && newVal) {
          const cand = AppState.candidates.find(c => c.id === candId);
          if (cand) {
            if (newVal === 'advance') updateCandidateStatus(candId, 'Hired');
            else if (newVal === 'reject') updateCandidateStatus(candId, 'Rejected');
            else showPremiumToast(`${cand.name} placed on hold.`, 'info');
          }
        }
      });
    });

    pane.querySelectorAll('.stage-table-container').forEach(container => {
      const tbody = container.querySelector('tbody');
      const rppSelect = container.querySelector('.rows-per-page');
      const pageInfo = container.querySelector('.table-pagination span:nth-child(3)');
      const selInfo = container.querySelector('.table-selection-info');
      const pagBtns = container.querySelectorAll('.pagination-btns button');
      if (!tbody || !rppSelect) return;
      let currentPage = 1;
      const allRows = Array.from(tbody.querySelectorAll('tr'));
      function paginate() {
        const perPage = parseInt(rppSelect.value) || 25;
        const totalRows = allRows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / perPage));
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * perPage;
        const end = start + perPage;
        allRows.forEach((row, i) => { row.style.display = (i >= start && i < end) ? '' : 'none'; });
        if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        if (selInfo) selInfo.textContent = `0 of ${Math.min(perPage, totalRows - start)} row(s) selected.`;
        if (pagBtns.length === 4) {
          pagBtns[0].disabled = currentPage <= 1; pagBtns[1].disabled = currentPage <= 1;
          pagBtns[2].disabled = currentPage >= totalPages; pagBtns[3].disabled = currentPage >= totalPages;
        }
      }
      paginate();
      rppSelect.addEventListener('change', () => { currentPage = 1; paginate(); });
      if (pagBtns.length === 4) {
        pagBtns[0].addEventListener('click', () => { currentPage = 1; paginate(); });
        pagBtns[1].addEventListener('click', () => { currentPage = Math.max(1, currentPage - 1); paginate(); });
        pagBtns[2].addEventListener('click', () => { const tp = Math.max(1, Math.ceil(allRows.length / (parseInt(rppSelect.value)||25))); currentPage = Math.min(tp, currentPage + 1); paginate(); });
        pagBtns[3].addEventListener('click', () => { currentPage = Math.max(1, Math.ceil(allRows.length / (parseInt(rppSelect.value)||25))); paginate(); });
      }
    });
  }
  renderBlueprintStudio(job);
}

function updateCandidateStatus(candId, newStatus) {
  const candidate = AppState.candidates.find(c => c.id === candId);
  if (!candidate) return;
  
  const oldStatus = candidate.status;
  candidate.status = newStatus;

  if ((newStatus === 'Screening' || newStatus === 'Functional') && candidate.interviewStatus == null) {
    candidate.interviewStatus = 'Not Started';
  }

  if (newStatus === 'Rejected') {
    showPremiumToast(`${candidate.name} has been rejected from the pipeline.`, 'success');
    soundEngine.playChime([392, 293.66], 0.2, 0.1);
  } else if (newStatus === 'Hired') {
    showPremiumToast(`Congratulations! ${candidate.name} has been marked as Hired.`, 'success');
    soundEngine.playChime([523.25, 659.25, 783.99, 1046.50], 0.25, 0.08);
  } else {
    showPremiumToast(`${candidate.name} advanced to ${newStatus}.`, 'success');
    soundEngine.playChime([329.63, 440.00, 523.25], 0.2, 0.08);
  }
  
  recalculateJobPipelines();
  updateSummaryMetrics();
  renderAnalyticsTable();
  
  const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
  if (activeJob) {
    document.getElementById('jd-count-screening').textContent = activeJob.pipeline.screening;
    const funcLabel = activeJob.pipeline.screening > 0
      ? `${activeJob.pipeline.functional} of ${activeJob.pipeline.screening}`
      : activeJob.pipeline.functional;
    document.getElementById('jd-count-functional').textContent = funcLabel;
    
    renderFunnelStages(activeJob);
    renderFunnelInsights(activeJob);
    
    const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(
      c => c.jobApplied === activeJob.roleName || c.jobApplied === activeJob.cardName
    );
    drawFunnelSVG(activeJob, jobCandidates);
    drawScoreDistributionSVG(activeJob, jobCandidates);

    renderJobDetailPanes(activeJob);
  }
  
  if (document.getElementById('jobs-board-container') && document.getElementById('jobs-board-container').style.display !== 'none') {
    renderKanbanBoard();
  } else {
    renderJobCards();
  }
}


export { renderJobDetailPanes, updateCandidateStatus };
