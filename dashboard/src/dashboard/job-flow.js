import { document, setTimeout } from './runtime.js';
import { escapeHTML } from './escape.js';
import { EXPERIENCE_BANDS, DIFFICULTY_LEVELS } from './constants.js';
import { saveStateToLocalStorage } from './ai-api.js';
import { scheduleJobSave } from './api.js';
import { navigateToJobDetail } from './job-detail.js';
import { recalculateJobPipelines } from './kanban-swarm.js';
import { navigateToTab, openDrawer } from './navigation.js';
import { renderJobCards } from './render-views.js';
import { soundEngine } from './sound.js';
import { navigateToSourcing, showPremiumToast } from './sourcing.js';
import { AppState } from './state.js';
import { getDataSource } from './api.js';
import { ensureFunctionalBlueprint, computeCalibration } from './blueprint-engine.js';
import { pushUrl } from './url-sync.js';


// ==========================================
// JOB FLOW PIPELINE VIEW
// ==========================================

// Dynamic header manager for Job Flow and Sourcing
function toggleHeaderElementsForJobFlow(showJobFlowHeader, job = null) {
  const searchBox = document.querySelector('.header-right .search-box');
  const themeToggle = document.getElementById('btn-theme-toggle');
  const interviewSettings = document.getElementById('btn-interview-settings');
  const actionBtn = document.getElementById('header-action-btn');
  let headerRight = document.querySelector('.header-right');

  if (showJobFlowHeader && job) {
    if (searchBox) searchBox.style.display = 'none';
    if (themeToggle) themeToggle.style.display = 'none';
    if (interviewSettings) interviewSettings.style.display = 'none';
    if (actionBtn) actionBtn.style.display = 'none';

    // Ensure buttons exist in header-right
    let collabBtn = document.getElementById('jf-header-collab-btn');
    if (!collabBtn && headerRight) {
      collabBtn = document.createElement('button');
      collabBtn.id = 'jf-header-collab-btn';
      collabBtn.className = 'btn-jd-ghost btn-header-collab';
      collabBtn.style.marginRight = '8px';
      collabBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        Add Collaborator
      `;
      headerRight.insertBefore(collabBtn, headerRight.firstChild);
    }
    let publishBtn = document.getElementById('jf-header-publish-btn');
    if (!publishBtn && headerRight) {
      publishBtn = document.createElement('button');
      publishBtn.id = 'jf-header-publish-btn';
      publishBtn.className = 'btn-jd-primary btn-header-publish';
      publishBtn.innerHTML = `
        Publish Job
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px;"><polyline points="9 18 15 12 9 6"></polyline></svg>
      `;
      headerRight.insertBefore(publishBtn, headerRight.children[1] || headerRight.firstChild);
    }

    if (collabBtn) {
      collabBtn.style.display = '';
      collabBtn.onclick = () => openDrawer('member');
    }
    if (publishBtn) {
      publishBtn.style.display = job.status === 'published' ? 'none' : '';
      publishBtn.onclick = () => openPublishJobModal(job.id);
    }
  } else {
    if (searchBox) searchBox.style.display = '';
    if (themeToggle) themeToggle.style.display = '';
    if (interviewSettings) interviewSettings.style.display = '';
    
    const collabBtn = document.getElementById('jf-header-collab-btn');
    const publishBtn = document.getElementById('jf-header-publish-btn');
    if (collabBtn) collabBtn.style.display = 'none';
    if (publishBtn) publishBtn.style.display = 'none';
  }
}

function openPublishJobModal(jobId) {
  const job = AppState.jobs.find(j => j.id === jobId);
  if (!job) return;

  const existing = document.getElementById('publish-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'publish-modal-overlay';
  overlay.className = 'publish-modal-overlay';

  if (!job.referenceId || job.referenceId === '-') {
    job.referenceId = 'AKR' + job.id.slice(0, 8).toUpperCase() + Math.floor(Math.random() * 900 + 100);
  }

  overlay.innerHTML = `
    <div class="publish-modal">
      <div class="publish-modal-header">
        <div class="publish-header-left">
          <div class="publish-modal-icon-container">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          </div>
          <div class="publish-modal-titles">
            <h3>Publish Job</h3>
            <p>Review details before publishing the job</p>
          </div>
        </div>
        <button class="publish-modal-close" id="btn-close-publish-modal">&times;</button>
      </div>

      <div class="publish-warning-banner">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <span>After publishing, editing will be disabled. Please review carefully.</span>
      </div>

      <div class="publish-modal-body">
        <div class="publish-form-group">
          <label>Job Name (Visible on Job Card)</label>
          <input type="text" id="pub-card-name" class="jf-edit-input" value="${(job.cardName || job.roleName).replace(/"/g, '&quot;')}" />
        </div>
        <div class="publish-form-group">
          <label>Role Name</label>
          <input type="text" id="pub-role-name" class="jf-edit-input" value="${(job.roleName || '').replace(/"/g, '&quot;')}" />
          <span class="pub-form-help">Visible to candidates on the job listing and the interview</span>
        </div>
        <div class="publish-form-group">
          <label>Job Reference ID</label>
          <div class="pub-ref-input-container">
            <input type="text" id="pub-ref-id" class="jf-edit-input" value="${job.referenceId}" readonly style="flex:1; margin-right:8px;" />
            <button class="btn-jd-ghost" id="btn-copy-pub-ref" style="padding: 6px 12px; font-size:0.75rem;">Copy</button>
          </div>
          <span class="pub-form-help">Unique System-generated ID for internal reference</span>
        </div>
        <div class="publish-form-group">
          <label>Tags (optional)</label>
          <input type="text" id="pub-tags" class="jf-edit-input" placeholder="e.g. Remote, Urgent" value="${(job.tags || []).join(', ')}" />
        </div>
      </div>

      <div class="publish-modal-actions">
        <button class="btn-jd-ghost" id="btn-cancel-publish" style="padding: 8px 16px;">Cancel</button>
        <button class="btn-jd-primary" id="btn-confirm-publish" style="padding: 8px 16px; margin-left: 8px;">Confirm & Publish</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.getElementById('btn-close-publish-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-publish').addEventListener('click', closeModal);

  document.getElementById('btn-copy-pub-ref').addEventListener('click', () => {
    const refInput = document.getElementById('pub-ref-id');
    refInput.select();
    navigator.clipboard.writeText(refInput.value);
    showPremiumToast('Job Reference ID copied to clipboard!', 'success');
  });

  document.getElementById('btn-confirm-publish').addEventListener('click', () => {
    const cardName = document.getElementById('pub-card-name').value.trim();
    const roleName = document.getElementById('pub-role-name').value.trim();
    const tagsVal = document.getElementById('pub-tags').value.trim();

    if (cardName) job.cardName = cardName;
    if (roleName) job.roleName = roleName;
    job.tags = tagsVal ? tagsVal.split(',').map(t => t.trim()).filter(Boolean) : [];
    job.status = 'published';

    if (job.pipelineConfig) {
      job.pipelineConfig.careerPage.enabled = true;
      job.pipelineConfig.resumeAnalysis.enabled = true;
      job.pipelineConfig.recruiterScreening.enabled = true;
      job.pipelineConfig.functionalInterview.enabled = true;
    }

    saveStateToLocalStorage();
    closeModal();
    soundEngine.playChime([392, 523.25, 659.25, 783.99], 0.2, 0.08);
    showPremiumToast(`Job "${job.roleName}" published successfully!`, 'success');

    navigateToSourcing(jobId);
  });
}

function migrateCandidatesOfJob(job) {
  const cfg = job.pipelineConfig;
  if (!cfg) return;

  const jobCandidates = AppState.candidates.filter(c => {
    if (getDataSource() === 'api' && job._backend) {
      return c.jobId === job.id;
    }
    return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
  });

  jobCandidates.forEach(candidate => {
    let currentStatus = candidate.status;
    if (currentStatus === 'Resume' && !cfg.resumeAnalysis.enabled) {
      if (cfg.recruiterScreening.enabled) {
        candidate.status = 'Screening';
      } else if (cfg.functionalInterview.enabled) {
        candidate.status = 'Functional';
      }
    }
    if (candidate.status === 'Screening' && !cfg.recruiterScreening.enabled) {
      if (cfg.functionalInterview.enabled) {
        candidate.status = 'Functional';
      } else if (cfg.resumeAnalysis.enabled) {
        candidate.status = 'Resume';
      }
    }
    if (candidate.status === 'Functional' && !cfg.functionalInterview.enabled) {
      if (cfg.recruiterScreening.enabled) {
        candidate.status = 'Screening';
      } else if (cfg.resumeAnalysis.enabled) {
        candidate.status = 'Resume';
      }
    }
  });
}

function openJobFlowView(jobId, showAddCandidates = false) {
  const job = AppState.jobs.find(j => j.id === jobId);
  if (!job) return;

  // Initialize pipeline config if not present
  if (!job.pipelineConfig) {
    job.pipelineConfig = {
      careerPage: { enabled: true, listed: true },
      resumeAnalysis: { enabled: !!job.resumeCriteria },
      recruiterScreening: { enabled: false },
      functionalInterview: { enabled: !!((job.functionalParameters && job.functionalParameters.topics && job.functionalParameters.topics.length) || (job.questions && job.questions.length > 0)) }
    };
  }

  AppState.activeTab = 'job-flow';
  AppState.activeJobId = jobId;
  pushUrl(`/dashboard/jobs/${jobId}/flow`);

  // Sidebar: keep Jobs highlighted as parent
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  document.querySelectorAll('.sub-nav li').forEach(li => li.classList.remove('active-sub'));

  // Show the job flow view
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));
  const flowView = document.getElementById('view-job-flow');
  if (flowView) flowView.classList.add('active-view');

  // Update breadcrumbs
  const shortName = (job.cardName || job.roleName).length > 30 ? (job.cardName || job.roleName).slice(0, 30) + '…' : (job.cardName || job.roleName);
  const breadcrumb = document.getElementById('breadcrumb-title');
  const statusLabel = job.status === 'published' ? 'Published' : 'Draft';
  const badgeClass = job.status === 'published' ? 'published' : 'draft';
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jf-jobs">Jobs</span>
    <span class="breadcrumb-separator">/</span> <span class="breadcrumb-link" id="bc-jf-jobname">${shortName}</span>
    <span class="jf-status-badge-top ${badgeClass}">${statusLabel}</span>`;
  document.getElementById('bc-jf-jobs').addEventListener('click', () => navigateToTab('jobs'));
  document.getElementById('bc-jf-jobname').addEventListener('click', () => navigateToJobDetail(jobId));

  // Dynamic header buttons
  toggleHeaderElementsForJobFlow(true, job);

  // Header texts
  document.getElementById('header-main-title').textContent = job.cardName || job.roleName;
  document.getElementById('header-sub-text').textContent = 'Pipeline Configuration';

  renderJobFlowPipeline(job);
  renderJobFlowConfig(job, 'careerPage');

  // Add Candidates banner after fresh AI-generated job creation
  const existingBanner = document.getElementById('jf-add-candidates-banner');
  if (existingBanner) existingBanner.remove();

  if (showAddCandidates) {
    const banner = document.createElement('div');
    banner.id = 'jf-add-candidates-banner';
    banner.className = 'jf-candidates-banner card-glass';
    banner.innerHTML = `
      <div class="jf-banner-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
      </div>
      <div class="jf-banner-content">
        <div class="jf-banner-title">Job created. Finish the flow from here.</div>
        <p class="jf-banner-desc">Review the pipeline, publish the posting, then add candidates when the setup looks right.</p>
      </div>
      <div class="jf-banner-actions">
        <button class="btn-jf-skip" id="jf-btn-review-flow">Review Flow</button>
        ${job.status === 'published' ? '' : `<button class="btn-jf-skip" id="jf-btn-publish-job">Publish Job</button>`}
        <button class="btn-jf-primary" id="jf-btn-add-candidates">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
          Add Candidates
        </button>
      </div>
    `;
    flowView.insertBefore(banner, flowView.firstChild);

    document.getElementById('jf-btn-review-flow')?.addEventListener('click', () => {
      banner.classList.add('jf-banner-dismissing');
      setTimeout(() => banner.remove(), 300);
    });
    document.getElementById('jf-btn-publish-job')?.addEventListener('click', () => {
      openPublishJobModal(jobId);
    });
    document.getElementById('jf-btn-add-candidates').addEventListener('click', () => {
      banner.remove();
      navigateToSourcing(jobId);
    });
  }

  soundEngine.playChime([392.00, 523.25, 659.25], 0.15, 0.08);
}

function renderJobFlowPipeline(job) {
  const panel = document.getElementById('jf-pipeline-panel');
  if (!panel) return;

  const cfg = job.pipelineConfig;
  const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [] };
  const fnBlueprint = ensureFunctionalBlueprint(job);
  const fnCal = computeCalibration(fnBlueprint);
  const questionCount = fnCal.questionCount;
  const totalDuration = fnCal.totalMinutes;

  const stages = [
    {
      key: 'careerPage',
      name: 'Career Page',
      enabled: cfg.careerPage.enabled,
      detail: cfg.careerPage.listed ? '<span class="jf-stage-badge active">Job Listed</span>' : '',
      subtext: job.cardName || 'Position Not Specified',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
    },
    {
      key: 'resumeAnalysis',
      name: 'Resume Analysis',
      enabled: cfg.resumeAnalysis.enabled,
      detail: '',
      subtext: criteria.mustHave.length ? `${criteria.mustHave.length} Must have · ${criteria.redFlags.length} Red flags · ${criteria.goodToHave.length} Good to have` : 'No parameters added',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
    },
    {
      key: 'recruiterScreening',
      name: 'Recruiter Screening',
      enabled: cfg.recruiterScreening.enabled,
      detail: '',
      subtext: job.screeningParams ? `${job.screeningParams.reduce((a, c) => a + c.params.length, 0)} Parameters` : 'No parameters added',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
    },
    {
      key: 'functionalInterview',
      name: 'Functional Interview',
      enabled: cfg.functionalInterview.enabled,
      detail: '',
      subtext: questionCount > 0 ? `${questionCount} Questions · ${totalDuration} Minutes` : 'No questions added',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    }
  ];

  panel.innerHTML = stages.map((s, i) => `
    <div class="jf-stage-card ${s.enabled ? 'enabled' : 'disabled'} ${i === 0 ? 'active' : ''}" data-stage="${s.key}">
      <div class="jf-stage-card-top">
        <div class="jf-stage-info">
          <span class="jf-stage-icon">${s.icon}</span>
          <span class="jf-stage-name">${s.name}</span>
          ${s.detail}
        </div>
        <label class="jf-toggle">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} data-stage="${s.key}" />
          <span class="jf-toggle-track"></span>
        </label>
      </div>
      <p class="jf-stage-subtext">${s.subtext}</p>
    </div>
    ${i < stages.length - 1 ? '<div class="jf-stage-connector"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></div>' : ''}
  `).join('');

  // Wire up click handlers
  panel.querySelectorAll('.jf-stage-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.jf-toggle')) return;
      panel.querySelectorAll('.jf-stage-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      renderJobFlowConfig(job, card.dataset.stage);
    });
  });

  // Wire up toggle switches
  panel.querySelectorAll('.jf-toggle input').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const stageKey = toggle.dataset.stage;
      job.pipelineConfig[stageKey].enabled = toggle.checked;
      const card = toggle.closest('.jf-stage-card');
      card.classList.toggle('enabled', toggle.checked);
      card.classList.toggle('disabled', !toggle.checked);
      
      // Candidate stage migration on toggle change
      if (!toggle.checked) {
        migrateCandidatesOfJob(job);
      }
      
      recalculateJobPipelines();
      saveStateToLocalStorage();
      renderJobCards();
    });
  });
}

function renderJobFlowConfig(job, stageKey) {
  const panel = document.getElementById('jf-config-panel');
  if (!panel) return;

  switch (stageKey) {
    case 'careerPage':
      renderCareerPageConfig(job, panel);
      break;
    case 'resumeAnalysis':
      renderResumeAnalysisFlowConfig(job, panel);
      break;
    case 'recruiterScreening':
      renderScreeningConfig(job, panel);
      break;
    case 'functionalInterview':
      renderFunctionalConfig(job, panel);
      break;
  }
}

function getVerboseJobDescription(job) {
  const role = job.roleName || 'This role';
  // The company is the org that posted the JD — job.companyName (org from the
  // backend), else the signed-in recruiter's org. Never the platform name.
  const company = job.companyName || globalThis.IH_ORG_NAME || 'the company';
  const normalizedRole = role.toLowerCase();
  const consultingName = company.toLowerCase().includes('consulting') ? company : `${company} Consulting`;

  if (normalizedRole.includes('government tender')) {
    return {
      overview: `${consultingName} is seeking a detail-oriented and proactive ${role} to support businesses in navigating and winning government tenders. The role involves identifying relevant tender opportunities, analyzing tender documents, preparing bid submissions, and ensuring compliance with government procurement processes. This position requires strong document handling skills and the ability to coordinate with internal teams to meet deadlines. The company specializes in assisting clients across various sectors with government procurement and tendering.`,
      responsibilities: [
        'Identify and track relevant government tenders from portals such as GeM, CPPP, and state procurement platforms.',
        'Analyze tender documents to understand eligibility criteria, scope of work, submission requirements, and compliance checkpoints.',
        'Assist in preparing technical, commercial, and financial bid documents with clear supporting evidence.',
        'Coordinate with internal teams, partners, and subject matter experts to collect necessary documentation and information.',
        'Ensure all tender submissions are compliant with guidelines and submitted before deadlines.',
        'Maintain records of submitted tenders, documentation, clarifications, corrigenda, and follow-ups.',
        'Conduct basic research on government departments, upcoming projects, procurement trends, and competitor activity.'
      ],
      requirements: [
        'Strong attention to detail and ability to work with structured documents.',
        'Good written and verbal communication skills.',
        'Ability to understand and interpret tender documents, eligibility criteria, and submission formats.',
        'Proficiency in MS Excel, Word, Google Workspace, and document collaboration tools.',
        'Ability to manage multiple deadlines and work independently with minimal supervision.'
      ],
      about: `${consultingName} works closely with businesses to help them navigate and win government tenders across various sectors. The company focuses on identifying relevant opportunities, preparing strong proposals, and ensuring complete compliance with government procurement processes.`
    };
  }

  if (normalizedRole.includes('full stack')) {
    return {
      overview: `${company} is hiring a ${role} to design, build, and maintain high-performance web applications across the frontend, backend, and database layers. The role involves translating product requirements into responsive interfaces, building reliable APIs, optimizing latency, and ensuring that data flows consistently across the system. This position is suited for someone who can move between React interfaces, Node.js services, and PostgreSQL-backed workflows while keeping maintainability and user experience in focus.`,
      responsibilities: [
        'Build responsive dashboards and application screens using React, modern JavaScript, and reusable UI patterns.',
        'Develop backend services, API routes, and integration logic using Node.js and Express.',
        'Design and maintain PostgreSQL schemas, queries, and data access patterns for reliable product workflows.',
        'Optimize page performance, API latency, and data loading behavior across key user journeys.',
        'Collaborate with product and design stakeholders to clarify requirements and ship polished features.',
        'Debug production issues across the stack and add safeguards that prevent recurring defects.'
      ],
      requirements: [
        'Hands-on experience with React, JavaScript, HTML, CSS, and component-based frontend development.',
        'Working knowledge of Node.js, Express, REST APIs, and backend validation patterns.',
        'Practical experience with PostgreSQL or another relational database.',
        'Ability to reason about performance, state management, and data consistency.',
        'Clear communication skills and comfort working across product, design, and engineering contexts.'
      ],
      about: `${company} builds modern hiring and workflow software for teams that need fast, reliable, and well-designed internal tools. The engineering culture values clear ownership, thoughtful implementation, and interfaces that help users complete complex tasks with less friction.`
    };
  }

  const description = job.description && job.description !== 'No job description provided.'
    ? job.description
    : `${job.companyName || company} is hiring for ${role}. This role is responsible for owning day-to-day execution, coordinating with stakeholders, and delivering high-quality work against clear business goals.`;

  return {
    overview: description,
    responsibilities: [
      `Own core execution for the ${role} role from planning through delivery.`,
      'Coordinate with internal stakeholders to gather context, clarify requirements, and resolve blockers.',
      'Maintain clear documentation, status updates, and handoff notes for ongoing work.',
      'Track deadlines, quality checkpoints, and follow-up actions across the workflow.',
      'Identify process gaps and suggest practical improvements that reduce manual effort.'
    ],
    requirements: [
      'Strong written and verbal communication skills.',
      'Ability to manage multiple priorities with attention to detail.',
      'Comfort working with documents, tools, and structured operational processes.',
      'Ownership mindset with the ability to work independently and ask clear questions when needed.'
    ],
    about: `${job.companyName || company} works with teams that need reliable execution, clear communication, and practical problem solving across business-critical workflows.`
  };
}

function renderVerboseJobDescription(job) {
  const content = getVerboseJobDescription(job);
  const company = escapeHTML(job.companyName || globalThis.IH_ORG_NAME || 'the company');
  const location = escapeHTML(job.location || 'Delhi, India');
  const role = escapeHTML(job.cardName || job.roleName || 'Untitled Role');
  const roleName = escapeHTML(job.roleName || 'Untitled Role');
  const experience = escapeHTML(job.experienceBand || 'Fresher');
  const jobType = escapeHTML(job.jobType || 'Full-Time');

  return `
    <div class="jf-jd-hero">
      <h4 class="jf-jd-title">${role}</h4>
      <div class="jf-jd-meta">
        <span><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> ${company}</span>
        <span>${location}</span>
      </div>
      <div class="jf-jd-chip-row">
        <span class="jf-jd-badge">${jobType}</span>
        <span class="jf-jd-badge">${experience}</span>
      </div>
    </div>

    <div class="jf-jd-rich-body">
      <section class="jf-jd-rich-section">
        <h5>Job overview</h5>
        <p>${escapeHTML(content.overview)}</p>
      </section>
      <section class="jf-jd-rich-section">
        <h5>Key responsibilities</h5>
        <ul>${content.responsibilities.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
      </section>
      <section class="jf-jd-rich-section">
        <h5>Requirements</h5>
        <ul>${content.requirements.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
      </section>
      <section class="jf-jd-rich-section">
        <h5>About ${company}</h5>
        <p>${escapeHTML(content.about)}</p>
      </section>
      <section class="jf-jd-rich-section compact">
        <h5>Role configured as</h5>
        <p>${roleName}</p>
      </section>
    </div>
  `;
}

function renderCareerPageConfig(job, panel) {
  const fields = job.applicationFields || ['Current Location', 'Expected CTC', 'Notice Period'];
  const isEditing = panel.dataset.cpEditing === 'true';

  panel.innerHTML = `
    <div class="jf-config-header">
      <div class="jf-config-header-left">
        <h2 class="jf-config-title">Career Page</h2>
        <p class="jf-config-subtitle">Publish your job and let AI screen every application instantly</p>
      </div>
      <div class="jf-config-header-actions">
        <button class="btn-jf-edit" id="btn-cp-edit">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          ${isEditing ? 'Save' : 'Edit'}
        </button>
      </div>
    </div>

    <div class="jf-section">
      <div class="jf-section-header">
        <h3 class="jf-section-title" style="color: var(--color-gold);">Job Description</h3>
      </div>
      <div class="jf-jd-card">
        ${isEditing ? `
          <div class="jf-edit-field">
            <label class="jf-edit-label">Job Title</label>
            <input type="text" class="jf-edit-input" id="cp-edit-title" value="${(job.cardName || job.roleName || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="jf-edit-field">
            <label class="jf-edit-label">Role Name</label>
            <input type="text" class="jf-edit-input" id="cp-edit-role" value="${(job.roleName || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="jf-edit-field">
            <label class="jf-edit-label">Experience Band</label>
            <select class="jf-edit-input" id="cp-edit-exp">
              ${EXPERIENCE_BANDS.map(o =>
                `<option ${(job.experienceBand || '') === o ? 'selected' : ''}>${o}</option>`
              ).join('')}
            </select>
          </div>
          <div class="jf-edit-field">
            <label class="jf-edit-label">Job Description</label>
            <textarea class="jf-edit-textarea" id="cp-edit-desc" rows="6">${job.description || ''}</textarea>
          </div>
        ` : renderVerboseJobDescription(job)}
      </div>
    </div>

    <div class="jf-section">
      <div class="jf-section-header">
        <div>
          <h3 class="jf-section-title" style="display: flex; align-items: center; gap: 8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold)" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Application Form Fields
          </h3>
          <p style="font-size: 0.76rem; color: var(--color-text-muted); margin: 2px 0 0 0;">Fields candidates will fill out during application</p>
        </div>
      </div>
      <div class="jf-fields-header">Enabled Fields (${fields.length})</div>
      <div class="jf-fields-list">
        ${fields.map((f, i) => `
          <div class="jf-field-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            ${isEditing
              ? `<input type="text" class="jf-edit-input jf-field-edit" value="${f.replace(/"/g, '&quot;')}" data-idx="${i}" style="flex:1;" />
                 <button class="btn-jf-remove-field" data-idx="${i}" title="Remove">×</button>`
              : `<span>${f}</span>`}
          </div>
        `).join('')}
        ${isEditing ? `<button class="btn-jf-add-field" id="btn-cp-add-field" style="margin-top:6px;">+ Add Field</button>` : ''}
      </div>
    </div>
  `;

  const editBtn = document.getElementById('btn-cp-edit');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (isEditing) {
        const newTitle = document.getElementById('cp-edit-title')?.value.trim();
        const newRole = document.getElementById('cp-edit-role')?.value.trim();
        const newExp = document.getElementById('cp-edit-exp')?.value;
        const newDesc = document.getElementById('cp-edit-desc')?.value.trim();
        if (newTitle) job.cardName = newTitle;
        if (newRole) job.roleName = newRole;
        if (newExp) job.experienceBand = newExp;
        job.description = newDesc || '';
        const editedFields = [];
        panel.querySelectorAll('.jf-field-edit').forEach(input => {
          if (input.value.trim()) editedFields.push(input.value.trim());
        });
        if (editedFields.length) job.applicationFields = editedFields;
        saveStateToLocalStorage();
        showPremiumToast('Job details saved.', 'success');
        panel.dataset.cpEditing = 'false';
        renderCareerPageConfig(job, panel);
        renderJobFlowPipeline(job);
      } else {
        panel.dataset.cpEditing = 'true';
        renderCareerPageConfig(job, panel);
      }
    });
  }

  if (isEditing) {
    panel.querySelectorAll('.btn-jf-remove-field').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const inputs = panel.querySelectorAll('.jf-field-edit');
        inputs[idx]?.closest('.jf-field-item')?.remove();
      });
    });
    document.getElementById('btn-cp-add-field')?.addEventListener('click', () => {
      const list = panel.querySelector('.jf-fields-list');
      const idx = list.querySelectorAll('.jf-field-item').length;
      const item = document.createElement('div');
      item.className = 'jf-field-item';
      item.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <input type="text" class="jf-edit-input jf-field-edit" value="" data-idx="${idx}" style="flex:1;" placeholder="New field name..." />
        <button class="btn-jf-remove-field" data-idx="${idx}" title="Remove">×</button>
      `;
      list.insertBefore(item, document.getElementById('btn-cp-add-field'));
      item.querySelector('.btn-jf-remove-field').addEventListener('click', () => item.remove());
      item.querySelector('input').focus();
    });
  }
}

function renderResumeAnalysisConfig(job, panel) {
  const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };

  panel.innerHTML = `
    <div class="jf-config-header">
      <div class="jf-config-header-left">
        <h2 class="jf-config-title">Resume Analysis</h2>
        <p class="jf-config-subtitle">Parameters created based on your requirements — feel free to edit them</p>
      </div>
      <div class="jf-config-header-actions">
        <button class="btn-jf-edit" id="jf-btn-edit-resume">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
      </div>
    </div>

    <div class="ra-criteria-group must-have">
      <div class="ra-criteria-group-header">
        <span class="ra-criteria-icon must-have"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
        <div>
          <h4 class="ra-criteria-group-title must-have">Must Have</h4>
          <p class="ra-criteria-group-desc">Candidates meeting these criteria will be shortlisted; others waitlisted for review</p>
        </div>
      </div>
      <div class="ra-criteria-items">${criteria.mustHave.map((item, i) => `<div class="ra-criteria-item must-have"><span class="ra-criteria-num must-have">${i+1}</span><span class="ra-criteria-text">${item}</span></div>`).join('')}</div>
    </div>

    <div class="ra-criteria-divider"><span class="ra-criteria-divider-text">AND</span></div>

    <div class="ra-criteria-group red-flags">
      <div class="ra-criteria-group-header">
        <span class="ra-criteria-icon red-flags"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
        <div>
          <h4 class="ra-criteria-group-title red-flags">Should Not Have (Red Flags)</h4>
          <p class="ra-criteria-group-desc">Candidates with no red flags will be shortlisted; others waitlisted for review</p>
        </div>
      </div>
      <div class="ra-criteria-items">${criteria.redFlags.map((item, i) => `<div class="ra-criteria-item red-flags"><span class="ra-criteria-num red-flags">${i+1}</span><span class="ra-criteria-text">${item}</span></div>`).join('')}</div>
    </div>

    <div class="ra-criteria-divider"><span class="ra-criteria-divider-text">AND</span></div>

    <div class="ra-criteria-group good-to-have">
      <div class="ra-criteria-group-header">
        <span class="ra-criteria-icon good-to-have"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>
        <div>
          <h4 class="ra-criteria-group-title good-to-have">Good To Have</h4>
          <p class="ra-criteria-group-desc">Candidates meeting the threshold will be shortlisted; others waitlisted for review.</p>
        </div>
      </div>
      <div class="ra-criteria-min-match">Minimum match: ${criteria.goodToHaveMinMatch} out of ${criteria.goodToHave.length} criteria</div>
      <div class="ra-criteria-items">${criteria.goodToHave.map((item, i) => `<div class="ra-criteria-item good-to-have"><span class="ra-criteria-num good-to-have">${i+1}</span><span class="ra-criteria-text">${item}</span></div>`).join('')}</div>
    </div>
  `;
}

function renderResumeAnalysisFlowConfig(job, panel) {
  const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };
  const isEditing = panel.dataset.raEditing === 'true';
  const renderRows = (items, groupKey, tone) => {
    const rows = (isEditing && items.length === 0) ? [''] : items;
    const html = rows.map((item, i) => isEditing ? `
      <div class="ra-criteria-item-edit">
        <span class="ra-criteria-num ${tone}">${i + 1}</span>
        <input type="text" class="ra-criteria-edit-input" value="${(item || '').replace(/"/g, '&quot;')}" placeholder="Enter criterion..." />
        <button class="btn-ra-remove-criteria" type="button" title="Remove criterion">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    ` : `
      <div class="ra-criteria-item ${tone}">
        <span class="ra-criteria-num ${tone}">${i + 1}</span>
        <span class="ra-criteria-text">${item}</span>
      </div>
    `).join('');
    return html + (isEditing ? `<button class="btn-ra-add-criteria" type="button" data-group="${groupKey}" data-tone="${tone}">+ Add Criterion</button>` : '');
  };

  panel.innerHTML = `
    <div class="jf-config-header">
      <div class="jf-config-header-left">
        <h2 class="jf-config-title">Resume Analysis</h2>
        <p class="jf-config-subtitle">Own shortlist rules here, then run candidate analysis from the Resume Analysis tab</p>
      </div>
      <div class="jf-config-header-actions">
        <button class="btn-jf-edit" id="jf-btn-edit-resume">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${isEditing ? '<polyline points="20 6 9 17 4 12"/>' : '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'}</svg>
          ${isEditing ? 'Save Rules' : 'Edit Rules'}
        </button>
      </div>
    </div>

    <div class="ra-criteria-group must-have">
      <div class="ra-criteria-group-header">
        <span class="ra-criteria-icon must-have"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
        <div>
          <h4 class="ra-criteria-group-title must-have">Must Have</h4>
          <p class="ra-criteria-group-desc">Candidates meeting these rules can move forward automatically</p>
        </div>
      </div>
      <div class="ra-criteria-items">${renderRows(criteria.mustHave, 'mustHave', 'must-have')}</div>
    </div>

    <div class="ra-criteria-divider"><span class="ra-criteria-divider-text">AND</span></div>

    <div class="ra-criteria-group red-flags">
      <div class="ra-criteria-group-header">
        <span class="ra-criteria-icon red-flags"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
        <div>
          <h4 class="ra-criteria-group-title red-flags">Red Flags</h4>
          <p class="ra-criteria-group-desc">Detected items hold or reject a candidate for manual review</p>
        </div>
      </div>
      <div class="ra-criteria-items">${renderRows(criteria.redFlags, 'redFlags', 'red-flags')}</div>
    </div>

    <div class="ra-criteria-divider"><span class="ra-criteria-divider-text">AND</span></div>

    <div class="ra-criteria-group good-to-have">
      <div class="ra-criteria-group-header">
        <span class="ra-criteria-icon good-to-have"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>
        <div>
          <h4 class="ra-criteria-group-title good-to-have">Good To Have</h4>
          <p class="ra-criteria-group-desc">Bonus signals that improve the fit score</p>
        </div>
      </div>
      <div class="ra-criteria-min-match">
        Minimum match:
        ${isEditing ? `<input type="number" class="ra-min-match-input" value="${criteria.goodToHaveMinMatch || 1}" min="1" max="${Math.max(criteria.goodToHave.length, 1)}" />` : criteria.goodToHaveMinMatch}
        out of ${criteria.goodToHave.length} criteria
      </div>
      <div class="ra-criteria-items">${renderRows(criteria.goodToHave, 'goodToHave', 'good-to-have')}</div>
    </div>
  `;

  const renumber = (container) => {
    container.querySelectorAll('.ra-criteria-num').forEach((num, idx) => { num.textContent = idx + 1; });
  };

  panel.querySelectorAll('.btn-ra-add-criteria').forEach(btn => {
    btn.addEventListener('click', () => {
      const container = btn.closest('.ra-criteria-items');
      if (!container) return;
      const tone = btn.dataset.tone || 'must-have';
      const count = container.querySelectorAll('.ra-criteria-item-edit').length + 1;
      const row = document.createElement('div');
      row.className = 'ra-criteria-item-edit';
      row.innerHTML = `
        <span class="ra-criteria-num ${tone}">${count}</span>
        <input type="text" class="ra-criteria-edit-input" value="" placeholder="Enter criterion..." />
        <button class="btn-ra-remove-criteria" type="button" title="Remove criterion">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      container.insertBefore(row, btn);
      row.querySelector('.btn-ra-remove-criteria').addEventListener('click', () => {
        row.remove();
        renumber(container);
      });
      row.querySelector('input')?.focus();
    });
  });

  panel.querySelectorAll('.btn-ra-remove-criteria').forEach(btn => {
    btn.addEventListener('click', () => {
      const container = btn.closest('.ra-criteria-items');
      btn.closest('.ra-criteria-item-edit')?.remove();
      if (container) renumber(container);
    });
  });

  document.getElementById('jf-btn-edit-resume')?.addEventListener('click', () => {
    if (!isEditing) {
      panel.dataset.raEditing = 'true';
      renderResumeAnalysisFlowConfig(job, panel);
      return;
    }

    const next = { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };
    panel.querySelectorAll('.ra-criteria-group.must-have .ra-criteria-edit-input').forEach(input => {
      if (input.value.trim()) next.mustHave.push(input.value.trim());
    });
    panel.querySelectorAll('.ra-criteria-group.red-flags .ra-criteria-edit-input').forEach(input => {
      if (input.value.trim()) next.redFlags.push(input.value.trim());
    });
    panel.querySelectorAll('.ra-criteria-group.good-to-have .ra-criteria-edit-input').forEach(input => {
      if (input.value.trim()) next.goodToHave.push(input.value.trim());
    });
    const min = parseInt(panel.querySelector('.ra-min-match-input')?.value, 10);
    next.goodToHaveMinMatch = Math.min(Math.max(Number.isFinite(min) ? min : 1, 1), Math.max(next.goodToHave.length, 1));
    job.resumeCriteria = next;
    panel.dataset.raEditing = 'false';
    saveStateToLocalStorage();
    scheduleJobSave(job);
    showPremiumToast('Resume analysis rules saved.', 'success');
    renderResumeAnalysisFlowConfig(job, panel);
    renderJobFlowPipeline(job);
  });
}

function renderScreeningConfig(job, panel) {
  const params = job.screeningParams || [];
  const totalParams = params.reduce((a, c) => a + c.params.length, 0);
  // AI-seeded categories render as fixed grids; custom params get editable rows.
  const aiCats = params.filter(c => c.category !== 'Custom');
  const customParams = (params.find(c => c.category === 'Custom') || {}).params || [];

  panel.innerHTML = `
    <div class="jf-config-header">
      <div class="jf-config-header-left">
        <h2 class="jf-config-title">Recruiter Screening</h2>
        <p class="jf-config-subtitle">AI-powered screening with configurable parameters</p>
      </div>
      <div class="jf-config-header-actions">
        <span class="jf-stat-pill"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${totalParams} Parameters</span>
        <span class="jf-stat-pill"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> 5 – 10 mins</span>
      </div>
    </div>

    <div class="jf-screening-tabs">
      <button class="jf-tab active">Screening Parameters</button>
      <button class="jf-tab">Test Interview</button>
      <button class="jf-tab">Settings</button>
    </div>

    ${aiCats.map(cat => `
      <div class="jf-param-category">
        <h4 class="jf-param-category-title">
          ${cat.category === 'Experience' ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' :
            cat.category === 'Location' ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' :
            cat.category === 'Compensation' ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'}
          ${cat.category}
        </h4>
        <div class="jf-param-table-header">
          <span class="jf-ph-drag"></span>
          <span class="jf-ph-req">Req</span>
          <span class="jf-ph-param">Parameter</span>
          <span class="jf-ph-flex">Flexibility</span>
          <span class="jf-ph-resp">Preferred Response</span>
        </div>
        ${cat.params.map(p => `
          <div class="jf-param-row">
            <span class="jf-pr-drag"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg></span>
            <span class="jf-pr-req"><input type="checkbox" ${p.required ? 'checked' : ''} /></span>
            <span class="jf-pr-param">${p.name}</span>
            <span class="jf-pr-flex"><select class="jf-select-sm"><option>Select</option><option>Must Match</option><option>Flexible</option><option>Nice to Have</option></select></span>
            <span class="jf-pr-resp"><input type="text" class="jf-input-sm" value="${p.preferredResponse}" placeholder="Enter preferred response..." /></span>
          </div>
        `).join('')}
      </div>
    `).join('')}

    <div class="jf-custom-section" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h4 class="jf-param-category-title" style="margin:0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Custom Parameters
        </h4>
        <button class="btn-jf-ghost" id="btn-add-screening-param" type="button" style="font-size:12px;">+ Add Parameter</button>
      </div>
      ${customParams.length ? customParams.map((p, i) => `
        <div class="jf-custom-row" data-idx="${i}" style="display:flex;gap:8px;align-items:center;margin:6px 0;">
          <input type="checkbox" class="jf-cp-req" ${p.required ? 'checked' : ''} title="Required" />
          <input type="text" class="jf-input-sm jf-cp-name" value="${escapeHTML(p.name || '')}" placeholder="Parameter name…" style="flex:1;" />
          <input type="text" class="jf-input-sm jf-cp-resp" value="${escapeHTML(p.preferredResponse || '')}" placeholder="Preferred response…" style="flex:2;" />
          <button class="jf-cp-remove" type="button" title="Remove" style="background:none;border:none;color:var(--color-text-faint,#888);cursor:pointer;font-size:18px;line-height:1;">×</button>
        </div>
      `).join('') : '<div style="opacity:.6;padding:6px 0;font-size:13px;">No custom parameters yet — add one to screen on your own criteria.</div>'}
    </div>

    <button class="btn-jf-primary" id="btn-screening-save" style="margin-top: 20px; width: 100%;">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Save Parameters
    </button>
  `;

  panel.querySelectorAll('.jf-param-row').forEach(row => {
    const reqCheckbox = row.querySelector('.jf-pr-req input');
    const flexSelect = row.querySelector('.jf-pr-flex select');
    const respInput = row.querySelector('.jf-pr-resp input');
    const paramName = row.querySelector('.jf-pr-param')?.textContent.trim();

    if (flexSelect) {
      const param = params.flatMap(c => c.params).find(p => p.name === paramName);
      if (param?.flexibility) flexSelect.value = param.flexibility;
    }

    [reqCheckbox, flexSelect, respInput].forEach(el => {
      if (el) el.addEventListener('change', () => { el.closest('.jf-param-row').classList.add('jf-row-dirty'); });
    });
  });

  // Read every row (AI grids + editable custom rows) back into job.screeningParams.
  // Shared by Save and by the add/remove re-render, so in-progress edits in OTHER
  // rows survive a re-render. Keeps blank custom rows (the one being typed); Save
  // prunes them.
  const commitRows = () => {
    panel.querySelectorAll('.jf-param-category').forEach(catEl => {
      const catTitle = catEl.querySelector('.jf-param-category-title')?.textContent.trim();
      const cat = (job.screeningParams || []).find(c => c.category === catTitle);
      if (!cat) return;
      catEl.querySelectorAll('.jf-param-row').forEach(row => {
        const name = row.querySelector('.jf-pr-param')?.textContent.trim();
        const param = cat.params.find(p => p.name === name);
        if (!param) return;
        param.required = row.querySelector('.jf-pr-req input')?.checked ?? param.required;
        param.flexibility = row.querySelector('.jf-pr-flex select')?.value || 'Select';
        param.preferredResponse = row.querySelector('.jf-pr-resp input')?.value || '';
      });
    });
    const customRows = [...panel.querySelectorAll('.jf-custom-row')].map(row => ({
      name: row.querySelector('.jf-cp-name')?.value.trim() || '',
      required: row.querySelector('.jf-cp-req')?.checked || false,
      flexibility: 'Select',
      preferredResponse: row.querySelector('.jf-cp-resp')?.value.trim() || '',
    }));
    const ai = (job.screeningParams || []).filter(c => c.category !== 'Custom');
    job.screeningParams = customRows.length ? [...ai, { category: 'Custom', params: customRows }] : ai;
  };

  // Custom parameters: add / remove (commit edits first so other rows survive).
  document.getElementById('btn-add-screening-param')?.addEventListener('click', () => {
    commitRows();
    let cat = (job.screeningParams || []).find(c => c.category === 'Custom');
    if (!cat) { cat = { category: 'Custom', params: [] }; job.screeningParams = [...(job.screeningParams || []), cat]; }
    cat.params.push({ name: '', required: false, flexibility: 'Select', preferredResponse: '' });
    renderScreeningConfig(job, panel);
    panel.querySelector('.jf-custom-row:last-of-type .jf-cp-name')?.focus();
  });
  panel.querySelectorAll('.jf-cp-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.closest('.jf-custom-row').dataset.idx, 10);
      commitRows();
      const cat = (job.screeningParams || []).find(c => c.category === 'Custom');
      if (cat) cat.params.splice(idx, 1);
      renderScreeningConfig(job, panel);
    });
  });

  document.getElementById('btn-screening-save')?.addEventListener('click', () => {
    commitRows();
    // Drop blank custom rows, then drop an empty Custom category entirely.
    (job.screeningParams || []).forEach(c => { if (c.category === 'Custom') c.params = c.params.filter(p => p.name); });
    job.screeningParams = (job.screeningParams || []).filter(c => c.category !== 'Custom' || c.params.length);
    saveStateToLocalStorage();
    scheduleJobSave(job); // the fix: these edits never reached the backend before
    showPremiumToast('Screening parameters saved.', 'success');
    panel.querySelectorAll('.jf-row-dirty').forEach(r => r.classList.remove('jf-row-dirty'));
  });
}

function renderFunctionalConfig(job, panel) {
  const fb = ensureFunctionalBlueprint(job);
  const cal = computeCalibration(fb);
  const topics = fb.topics || [];

  panel.innerHTML = `
    <div class="jf-config-header">
      <div class="jf-config-header-left">
        <h2 class="jf-config-title">Functional Interview</h2>
        <p class="jf-config-subtitle">The AI avatar conducts this round from the blueprint you author in Question Studio</p>
      </div>
      <div class="jf-config-header-actions">
        <span class="jf-stat-pill"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg> ${cal.questionCount} Questions</span>
        <span class="jf-stat-pill"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${cal.totalMinutes} Minutes</span>
        <span class="jf-stat-pill"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-3.5 7.5-8.5 9C7.5 19.5 4 17 4 12V5l8.5-3L21 5z"/></svg> ${cal.rubricCoverage}% rubric-ready</span>
      </div>
    </div>

    ${topics.length ? `
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
        ${topics.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:var(--color-surface-2);border:1px solid var(--glass-border);border-radius:10px;">
            <span style="font-size:0.85rem;font-weight:600;">${escapeHTML(t.name)}</span>
            <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-muted);">${escapeHTML(t.type)} · ${escapeHTML(t.difficulty)} · ${t.questions.length} Q${t.questions.length !== 1 ? 's' : ''}</span>
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="margin-top:16px;padding:24px;text-align:center;color:var(--color-text-muted);font-size:0.8rem;background:var(--color-surface-2);border:1px solid var(--glass-border);border-radius:12px;">No questions yet. Open Question Studio to generate a rubric-graded interview blueprint.</div>
    `}

    <button class="btn-jf-primary" id="btn-open-studio" style="margin-top:16px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:7px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      Open Question Studio
    </button>
  `;

  document.getElementById('btn-open-studio')?.addEventListener('click', () => {
    navigateToJobDetail(job.id);
    setTimeout(() => {
      const tab = document.querySelector('.jd-tab[data-jd-tab="questions"]');
      if (tab) tab.click();
    }, 60);
  });
}
function renderFunnelStages(job) {
  const container = document.getElementById('jd-funnel-stages');
  if (!container) return;

  const total = Math.max(job.pipeline.total, 1);

  const jobCandidates = AppState.candidates.filter(c => {
    if (getDataSource() === 'api' && job._backend) {
      return c.jobId === job.id;
    }
    return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
  });

  const completedCount = jobCandidates.filter(c => c.interviewStatus === 'Completed').length;
  const qualifiedCount = jobCandidates.filter(c => c.status === 'Hired').length;

  const sourceColors = {
    'Career Page': '#6366f1',
    'ATS': '#06b6d4',
    'Bulk Upload': '#f59e0b',
    'Scheduled': '#ec4899',
    'Direct Link': '#10b981'
  };

  function getSourceBreakdown(candidates) {
    const breakdown = {};
    candidates.forEach(c => {
      const src = c.source || 'Unknown';
      breakdown[src] = (breakdown[src] || 0) + 1;
    });
    return breakdown;
  }

  const stageFilters = {
    'Total Candidates': () => jobCandidates,
    'Resume Analysis': () => jobCandidates.filter(c => c.status === 'Resume'),
    'Recruiter Screening': () => jobCandidates.filter(c => c.status === 'Screening'),
    'Functional Interview': () => jobCandidates.filter(c => c.status === 'Functional'),
    'Completed': () => jobCandidates.filter(c => c.status === 'Functional' || c.status === 'Hired'),
    'Qualified': () => jobCandidates.filter(c => c.status === 'Hired'),
  };

  const stages = [
    { count: job.pipeline.total, label: 'Total Candidates', conv: null },
    { count: job.pipeline.resume,     label: 'Resume Analysis',      conv: Math.round((job.pipeline.resume / total) * 100) },
    { count: job.pipeline.screening,  label: 'Recruiter Screening',  conv: Math.round((job.pipeline.screening / total) * 100) },
    { count: job.pipeline.functional, label: 'Functional Interview', conv: Math.round((job.pipeline.functional / total) * 100) },
    { count: completedCount,           label: 'Completed',            conv: Math.round((completedCount / total) * 100) },
    { count: qualifiedCount,           label: 'Qualified',            conv: Math.round((qualifiedCount / total) * 100) },
  ];

  container.innerHTML = stages.map(s => `
    <div class="jd-stage-item">
      <div class="jds-count">${s.count}</div>
      <div class="jds-label">${s.label}</div>
      ${s.conv !== null ? `<div class="jds-conv">${s.conv}%</div>` : ''}
    </div>
  `).join('');
}

function renderFunnelInsights(job) {
  const container = document.getElementById('jd-insights-body');
  if (!container) return;

  const total = job.pipeline.total;
  const screening = job.pipeline.screening;
  const functional = job.pipeline.functional;
  const insights = [];

  if (total === 0) {
    insights.push({ type: 'info', text: 'No candidates yet. Share interview links to start receiving applications.' });
  } else {
    const screeningPct = Math.round((screening / total) * 100);
    if (job.pipeline.resume === 0) {
      insights.push({ type: 'warn', text: 'Resume Analysis stage has 0 candidates — consider enabling resume screening in job settings.' });
    }
    if (screeningPct >= 50) {
      insights.push({ type: 'good', text: `Strong ${screeningPct}% conversion to Recruiter Screening — pipeline quality is high.` });
    }
    if (functional > 0) {
      insights.push({ type: 'good', text: `${functional} candidate${functional > 1 ? 's' : ''} reached Functional Interview and ${functional === 1 ? 'is' : 'are'} ready for expert vetting.` });
    } else if (screening > 0) {
      insights.push({ type: 'info', text: 'No candidates have advanced to Functional Interview yet. Recruiter screening is in progress.' });
    }
  }

  if (insights.length === 0) {
    insights.push({ type: 'info', text: 'Funnel data looks healthy. Continue monitoring candidate progress.' });
  }

  container.innerHTML = insights.map(ins => `
    <div class="jd-insight-item ${ins.type}">
      <span class="jd-insight-dot"></span>
      <p>${ins.text}</p>
    </div>
  `).join('');
}


export { escapeHTML, getVerboseJobDescription, migrateCandidatesOfJob, openJobFlowView, openPublishJobModal, renderCareerPageConfig, renderFunctionalConfig, renderFunnelInsights, renderFunnelStages, renderJobFlowConfig, renderJobFlowPipeline, renderResumeAnalysisConfig, renderResumeAnalysisFlowConfig, renderScreeningConfig, renderVerboseJobDescription, toggleHeaderElementsForJobFlow };
