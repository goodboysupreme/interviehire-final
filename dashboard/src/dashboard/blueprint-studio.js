// Interview Blueprint Studio — the redesigned Question Generator surface.
// Renders the laptop-first studio (mode toggle, topic-grouped canvas with
// per-question rubric authoring, one collapsible inspector) into
// #jd-pane-questions and wires it to the contract-aligned blueprint-engine.
// Replaces the old renderQuestionsPane / flat job.questions surface.

import { document, setTimeout, clearTimeout } from './runtime.js';
import { escapeHTML } from './escape.js';
import { saveStateToLocalStorage } from './ai-api.js';
import { soundEngine } from './sound.js';
import { showPremiumToast } from './sourcing.js';
import { isApiMode, apiPatchJobParameters } from './api.js';
import {
  MODE_FUNCTIONAL, MODE_SCREENING, CONTRACT_DIFFICULTY, TOPIC_TYPES, QUESTION_TYPES, SEVERITY_LEVELS,
  migrateLegacyQuestions, emptyScreeningBlueprint, createTopic, createQuestionBlueprint, createRubricPoint, createRedFlag,
  generateFunctionalOutline, enrichQuestionRubric, generateScreeningQuestions,
  localFunctionalBlueprint, localScreeningQuestions,
  computeCoverage, computeCalibration, rubricStrength,
} from './blueprint-engine.js';

// Shared mutable UI state — imported bindings are read-only, so studio view
// state lives on a plain object (same pattern as questionStaging/spotlightUi).
const studioUi = {
  mode: MODE_FUNCTIONAL,
  inspectorOpen: false,
  inspectorTab: 'coverage',
  expandedTopicId: null,
  expandedQuestionId: null,
  generating: false,
};

let dragState = null;

// The job currently rendered in the studio — so persist() can target the right
// backend record without threading `job` through every call site.
let activeJob = null;

// Debounced autosave to the live backend (api mode only). Latest-wins: rapid
// edits and the generation batch coalesce into one PATCH; an edit landing
// mid-flight queues exactly one follow-up save. 'local' mode is untouched.
const backendSave = { timer: null, inflight: false, again: false, status: 'idle', toasted: false };

const TYPE_TINT = {
  technical_theory: '#38bdf8', coding: '#38bdf8', system_design: '#38bdf8',
  behavioral: '#a855f7', case_study: '#34d399', hr_screening: '#fbbf24',
  sales_roleplay: '#f472b6', general: '#9a9a9a', custom: '#9a9a9a',
};
const DIFF_TINT = { Easy: '#34d399', Medium: '#fbbf24', Hard: '#f87171' };
const SEV_TINT = { low: '#9a9a9a', medium: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const tint = (map, key) => map[key] || '#9a9a9a';

// ── Data accessors (own the canonical objects on the job so edits persist) ───
function functionalOf(job) {
  if (!job.functionalParameters || !Array.isArray(job.functionalParameters.topics)) {
    job.functionalParameters = migrateLegacyQuestions(job.questions);
  }
  return job.functionalParameters;
}
function screeningOf(job) {
  if (!job.screeningBlueprint || !Array.isArray(job.screeningBlueprint.questions)) {
    job.screeningBlueprint = emptyScreeningBlueprint();
  }
  return job.screeningBlueprint;
}
function allQuestions(fb) {
  return (fb.topics || []).flatMap((t) => t.questions.map((q) => ({ q, topic: t })));
}
function findQuestion(job, qid) {
  for (const t of functionalOf(job).topics) {
    const q = t.questions.find((x) => x.id === qid);
    if (q) return { q, topic: t };
  }
  const sq = screeningOf(job).questions.find((x) => x.id === qid);
  return sq ? { q: sq, topic: null } : { q: null, topic: null };
}
// Every mutation flows through persist(): localStorage always (the local cache
// + 'local' mode source of truth), plus a debounced backend PATCH in api mode.
const persist = () => { saveStateToLocalStorage(); scheduleBackendSave(); };

// ── Backend autosave ─────────────────────────────────────────────────────────
const SAVE_UI = {
  idle:   ['#6b7280', 'Synced'],
  saving: ['#fbbf24', 'Saving…'],
  saved:  ['#34d399', 'Saved'],
  error:  ['#f87171', 'Save failed'],
};
function saveStatusInner(status) {
  const [color, label] = SAVE_UI[status] || SAVE_UI.idle;
  return `<span class="bs-save-dot ${status === 'saving' ? 'spin' : ''}" style="--c:${color};"></span>${label}`;
}
function saveStatusMarkup() {
  if (!(isApiMode() && activeJob && activeJob._backend)) return '';
  return `<span class="bs-save" id="bs-save-status" data-state="${backendSave.status}" title="Authored blueprint syncs to the live backend">${saveStatusInner(backendSave.status)}</span>`;
}
function setSaveStatus(status, detail) {
  backendSave.status = status;
  const el = document.getElementById('bs-save-status');
  if (el) { el.dataset.state = status; el.innerHTML = saveStatusInner(status); }
  if (status === 'error' && !backendSave.toasted) {
    backendSave.toasted = true;
    showPremiumToast(`Couldn't save to the backend: ${detail || 'unknown error'}`, 'error');
  }
  if (status === 'saved' || status === 'saving') backendSave.toasted = false;
}
function scheduleBackendSave() {
  if (!activeJob || !isApiMode() || !activeJob._backend || !activeJob.id) return;
  // During generation many partial saves would fire — batch into the single
  // save that finish() schedules once `generating` clears.
  if (studioUi.generating) return;
  setSaveStatus('saving');
  if (backendSave.timer) clearTimeout(backendSave.timer);
  backendSave.timer = setTimeout(flushBackendSave, 1000);
}
async function flushBackendSave() {
  const job = activeJob;
  if (!job || !job.id) return;
  if (backendSave.inflight) { backendSave.again = true; return; }
  backendSave.inflight = true;
  backendSave.again = false;
  setSaveStatus('saving');
  try {
    await apiPatchJobParameters(job.id, job);
    if (!backendSave.again) setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error', (e && e.message) || '');
  } finally {
    backendSave.inflight = false;
    if (backendSave.again) { backendSave.again = false; flushBackendSave(); }
  }
}

// ── Entry ────────────────────────────────────────────────────────────────
export function renderBlueprintStudio(job) {
  const pane = document.getElementById('jd-pane-questions');
  if (!pane) return;
  activeJob = job;
  functionalOf(job);
  screeningOf(job);
  pane.innerHTML = shellMarkup(job);
  bindStudio(pane, job);
}

// ── Markup ─────────────────────────────────────────────────────────────────
function shellMarkup(job) {
  const fb = functionalOf(job);
  const cal = computeCalibration(fb);
  const cov = computeCoverage(job, fb);
  const covOk = cov.filter((c) => c.status === 'ok').length;
  const isFn = studioUi.mode === MODE_FUNCTIONAL;
  const screeningCount = screeningOf(job).questions.length;

  return `
  <div class="bs-studio ${studioUi.inspectorOpen ? 'inspector-open' : ''}">
    <div class="bs-topbar">
      <div class="bs-tb-heading">
        <span class="bs-tb-crumb">${escapeHTML(job.roleName || job.cardName || 'Role')}</span>
        <h2 class="bs-tb-title"><span class="bs-dot"></span> Interview Blueprint Studio</h2>
      </div>
      <div class="bs-mode-toggle" role="tablist">
        <button class="bs-mode-btn ${!isFn ? 'active alt' : ''}" data-action="mode" data-mode="${MODE_SCREENING}"><span class="bs-md"></span> Screening</button>
        <button class="bs-mode-btn ${isFn ? 'active' : ''}" data-action="mode" data-mode="${MODE_FUNCTIONAL}"><span class="bs-md"></span> Functional</button>
      </div>
      <button class="bs-btn-generate ${studioUi.generating ? 'generating' : ''}" data-action="generate" ${studioUi.generating ? 'disabled' : ''}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span class="bs-btn-text">${studioUi.generating ? (studioUi.genLabel || 'Generating…') : (isFn ? 'Generate blueprint' : 'Generate questions')}</span>
      </button>
    </div>

    <div class="bs-strip">
      ${isFn ? `
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <b>${cal.totalMinutes}</b> min</span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/></svg> <b>${cal.questionCount}</b> question${cal.questionCount !== 1 ? 's' : ''}</span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg> coverage <b>${covOk}/${cov.length || 0}</b></span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-3.5 7.5-8.5 9C7.5 19.5 4 17 4 12V5l8.5-3L21 5z"/></svg> rubric <b>${cal.rubricCoverage}%</b></span>
      ` : `
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg> <b>${screeningCount}</b> question${screeningCount !== 1 ? 's' : ''}</span>
        <span class="bs-sep"></span>
        <span class="bs-stat bs-stat-muted">Recruiter gate · keep it short, ~3 min each</span>
      `}
      <span class="bs-spacer"></span>
      ${saveStatusMarkup()}
      <button class="bs-insp-toggle" data-action="toggle-inspector">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        ${studioUi.inspectorOpen ? 'Hide' : 'Inspector'}
      </button>
    </div>

    <div class="bs-work">
      <div class="bs-canvas">
        <div class="bs-panel">
          ${isFn ? functionalCanvas(job, fb) : screeningCanvas(job)}
        </div>
      </div>
      ${studioUi.inspectorOpen ? `<div class="bs-inspector">${inspectorMarkup(job, fb, cov, cal)}</div>` : ''}
    </div>
  </div>`;
}

function functionalCanvas(job, fb) {
  if (!fb.topics.length) return emptyState('No blueprint yet', 'Add a job description, then Generate to draft a topic-grouped interview with graded rubrics.');
  return `
    <div class="bs-canvas-head">
      <div><div class="bs-canvas-title">Functional blueprint</div><div class="bs-canvas-sub">${fb.topics.length} topic${fb.topics.length !== 1 ? 's' : ''} · drag to reorder · every question carries a graded rubric</div></div>
      <button class="bs-mini-btn" data-action="add-topic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Topic</button>
    </div>
    ${fb.topics.map((t) => topicMarkup(t)).join('')}`;
}

function topicMarkup(topic) {
  const open = studioUi.expandedTopicId === topic.id;
  const typeClass = topic.type === 'Experiential' ? 'exp' : 'theo';
  const diffClass = topic.difficulty.toLowerCase();
  return `
  <div class="bs-topic ${open ? 'open' : ''}" data-topic-id="${topic.id}">
    <div class="bs-topic-bar" draggable="true" data-action="toggle-topic" data-topic-id="${topic.id}">
      <svg class="bs-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      <span class="bs-topic-name">${escapeHTML(topic.name)}</span>
      <span class="bs-tspacer"></span>
      <span class="bs-chip ${typeClass}">${escapeHTML(topic.type)}</span>
      <span class="bs-chip ${diffClass}">${escapeHTML(topic.difficulty)}</span>
      <span class="bs-chip cnt">${topic.questions.length}</span>
    </div>
    ${open ? `
      <div class="bs-topic-body">
        ${topic.questions.map((q) => questionMarkup(q)).join('')}
        <button class="bs-mini-btn bs-add-q" data-action="add-question" data-topic-id="${topic.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add question</button>
      </div>` : ''}
  </div>`;
}

function strengthBadge(q) {
  const s = rubricStrength(q);
  const map = { ready: ['#34d399', 'rubric ready'], light: ['#fbbf24', 'rubric · light'], missing: ['#f87171', 'no rubric'] };
  const [c, label] = map[s];
  return `<span class="bs-qchip" style="color:${c};border-color:${c}40;background:${c}14;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-3.5 7.5-8.5 9C7.5 19.5 4 17 4 12V5l8.5-3L21 5z"/></svg> ${label}</span>`;
}

function questionMarkup(q) {
  const open = studioUi.expandedQuestionId === q.id;
  const tt = tint(TYPE_TINT, q.questionType);
  return `
  <div class="bs-qcard ${open ? 'open' : ''}" draggable="${open ? 'false' : 'true'}" data-q-id="${q.id}">
    <div class="bs-q-top" data-action="toggle-question" data-q-id="${q.id}">
      <span class="bs-q-num">Q</span>
      <div class="bs-q-head">
        <div class="bs-q-prompt">${escapeHTML(q.prompt) || '<span class="bs-faint">Untitled question</span>'}</div>
        <div class="bs-q-chips">
          <span class="bs-qchip type" style="color:${tt};border-color:${tt}40;background:${tt}14;">${escapeHTML(q.questionType)}</span>
          <span class="bs-qchip"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${q.estimatedMinutes} min</span>
          ${strengthBadge(q)}
        </div>
      </div>
    </div>
    ${open ? `<div class="bs-q-edit">${questionEditor(q)}</div>` : ''}
  </div>`;
}

function questionEditor(q) {
  const r = q.rubric;
  return `
    <label class="bs-fld-label">Question prompt <span class="bs-faint">· spoken aloud by the avatar</span></label>
    <textarea class="bs-input bs-prompt" data-action="edit" data-q-id="${q.id}" data-field="prompt" rows="2" placeholder="One clear idea, conversational…">${escapeHTML(q.prompt)}</textarea>

    <div class="bs-meta-row">
      <select class="bs-input bs-select" data-action="edit" data-q-id="${q.id}" data-field="questionType">
        ${QUESTION_TYPES.map((t) => `<option value="${t}" ${q.questionType === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select class="bs-input bs-select" data-action="edit" data-q-id="${q.id}" data-field="difficulty">
        ${CONTRACT_DIFFICULTY.map((d) => `<option value="${d}" ${q.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <div class="bs-min"><input class="bs-input" type="number" min="1" max="15" value="${q.estimatedMinutes}" data-action="edit" data-q-id="${q.id}" data-field="estimatedMinutes" /> min</div>
      <button class="bs-icon-btn danger" data-action="delete-question" data-q-id="${q.id}" title="Delete question"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    </div>

    <div class="bs-rubric">
      <div class="bs-model">
        <div class="bs-model-label">Model answer <span class="bs-faint">· what strong looks like</span></div>
        <textarea class="bs-input" data-action="edit" data-q-id="${q.id}" data-field="modelAnswer" rows="2" placeholder="2–3 sentences the evaluator grades against…">${escapeHTML(q.modelAnswer)}</textarea>
      </div>

      <div class="bs-rg-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Required points <span class="bs-faint">· weighted 1–3</span></div>
      ${r.requiredPoints.map((p, i) => pointRow(q.id, 'required', i, p)).join('')}
      <button class="bs-mini-btn ghost" data-action="add-point" data-q-id="${q.id}" data-kind="required">+ point</button>

      <div class="bs-rg-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Red flags</div>
      ${r.redFlags.map((f, i) => flagRow(q.id, i, f)).join('')}
      <button class="bs-mini-btn ghost" data-action="add-flag" data-q-id="${q.id}">+ red flag</button>

      <label class="bs-fld-label" style="margin-top:12px;">Follow-up intent <span class="bs-faint">· when the avatar should probe</span></label>
      <textarea class="bs-input" data-action="edit" data-q-id="${q.id}" data-field="followUpIntent" rows="1" placeholder="e.g. if vague on numbers, press for a concrete estimate">${escapeHTML(q.followUpIntent)}</textarea>
    </div>`;
}

function pointRow(qid, kind, idx, p) {
  return `
  <div class="bs-point">
    <input class="bs-input bs-point-text" data-action="edit-point" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}" data-field="description" value="${escapeHTML(p.description)}" placeholder="What a correct answer covers…" />
    <div class="bs-weight" data-action="set-weight" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}">
      ${[1, 2, 3].map((w) => `<span class="bs-wdot ${p.weight >= w ? 'on' : ''}" data-w="${w}" title="weight ${w}"></span>`).join('')}
    </div>
    <button class="bs-icon-btn" data-action="remove-point" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`;
}

function flagRow(qid, idx, f) {
  const c = tint(SEV_TINT, f.severity);
  return `
  <div class="bs-point">
    <input class="bs-input bs-point-text" data-action="edit-flag" data-q-id="${qid}" data-idx="${idx}" data-field="description" value="${escapeHTML(f.description)}" placeholder="A realistic failure signal…" />
    <select class="bs-input bs-sev-select" style="color:${c};border-color:${c}40;" data-action="edit-flag" data-q-id="${qid}" data-idx="${idx}" data-field="severity">
      ${SEVERITY_LEVELS.map((s) => `<option value="${s}" ${f.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <button class="bs-icon-btn" data-action="remove-flag" data-q-id="${qid}" data-idx="${idx}" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`;
}

function screeningCanvas(job) {
  const sb = screeningOf(job);
  if (!sb.questions.length) return emptyState('No screening questions yet', 'Generate a short recruiter gate — background, motivation, and logistics like notice period and compensation.');
  return `
    <div class="bs-canvas-head">
      <div><div class="bs-canvas-title">Recruiter screening</div><div class="bs-canvas-sub">${sb.questions.length} questions · short, warm, voice-friendly</div></div>
      <button class="bs-mini-btn" data-action="add-screening"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Question</button>
    </div>
    ${sb.questions.map((q, i) => `
      <div class="bs-screen-row">
        <span class="bs-q-num">${i + 1}</span>
        <textarea class="bs-input" data-action="edit" data-q-id="${q.id}" data-field="prompt" rows="1" placeholder="Ask something short…">${escapeHTML(q.prompt)}</textarea>
        <button class="bs-icon-btn danger" data-action="delete-question" data-q-id="${q.id}" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>`).join('')}`;
}

function emptyState(title, desc) {
  return `<div class="bs-empty"><div class="bs-empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p class="bs-empty-title">${escapeHTML(title)}</p><p class="bs-empty-desc">${escapeHTML(desc)}</p></div>`;
}

// ── Inspector (one section at a time) ────────────────────────────────────────
function inspectorMarkup(job, fb, cov, cal) {
  const tabs = [['coverage', 'Coverage'], ['preview', 'Preview'], ['calibrate', 'Calibrate']];
  return `
    <div class="bs-panel">
      <div class="bs-seg">
        ${tabs.map(([k, label]) => `<button class="bs-seg-btn ${studioUi.inspectorTab === k ? 'active' : ''}" data-action="inspector-tab" data-tab="${k}">${label}</button>`).join('')}
      </div>
      ${studioUi.inspectorTab === 'coverage' ? coveragePanel(cov)
        : studioUi.inspectorTab === 'preview' ? previewPanel(job, fb)
        : calibratePanel(cal)}
    </div>`;
}

function coveragePanel(cov) {
  if (!cov.length) return `<p class="bs-faint" style="font-size:12px;">No must-have requirements on this job yet. Add them in the Resume stage to see coverage.</p>`;
  const ico = { ok: ['#34d399', 'M20 6 9 17l-5-5'], thin: ['#fbbf24', 'M12 9v4M12 17h.01'], gap: ['#f87171', 'M18 6 6 18M6 6l12 12'] };
  return `
    <div class="bs-insp-h">JD coverage · ${cov.length} must-have${cov.length !== 1 ? 's' : ''}</div>
    ${cov.map((c) => {
      const [color, path] = ico[c.status];
      return `<div class="bs-cov-item">
        <span class="bs-cov-ico" style="background:${color}22;color:${color};"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="${path}"/></svg></span>
        <span class="bs-cov-name">${escapeHTML(c.requirement)}</span>
        <span class="bs-cov-tag">${c.status === 'gap' ? 'gap' : c.status === 'thin' ? 'thin' : `${c.count} Qs`}</span>
      </div>`;
    }).join('')}`;
}

function previewPanel(job, fb) {
  const first = allQuestions(fb)[0];
  const prompt = first ? first.q.prompt : 'Generate a blueprint to preview how Lina will ask it.';
  return `
    <div class="bs-insp-h">Preview as avatar</div>
    <div class="bs-preview">
      <div class="bs-av-row"><div class="bs-avatar">L</div><div><div class="bs-av-name">Lina</div><div class="bs-av-status"><span class="bs-pulse"></span> ${first ? 'asking Q1 · voice' : 'idle'}</div></div></div>
      <div class="bs-bubble">${escapeHTML(prompt)}</div>
      <div class="bs-wave">${[40, 70, 100, 55, 85, 35, 65, 95, 45, 75, 30, 60, 88, 50, 72].map((h) => `<i style="height:${h}%"></i>`).join('')}</div>
    </div>
    <p class="bs-faint" style="font-size:11px;margin-top:10px;">Scripted read now — becomes a live VAPI test call once wired to the backend.</p>`;
}

function calibratePanel(cal) {
  const dims = [['Questions', cal.questionCount], ['Topics', cal.topicCount], ['Minutes', cal.totalMinutes], ['Rubric ready', `${cal.rubricCoverage}%`]];
  const mix = CONTRACT_DIFFICULTY.map((d) => [d, cal.difficultyMix[d] || 0]);
  const maxMix = Math.max(1, ...mix.map(([, n]) => n));
  return `
    <div class="bs-insp-h">Calibration</div>
    <div class="bs-metric-grid">${dims.map(([l, v]) => `<div class="bs-metric"><div class="bs-m-label">${l}</div><div class="bs-m-val">${v}</div></div>`).join('')}</div>
    <div class="bs-rg-label" style="margin-top:14px;">Difficulty curve</div>
    ${mix.map(([d, n]) => `<div class="bs-dim-row"><span class="bs-dim-name">${d}</span><span class="bs-dim-track"><span class="bs-dim-fill" style="width:${Math.round((n / maxMix) * 100)}%;background:${tint(DIFF_TINT, d)};"></span></span><span class="bs-dim-pct">${n}</span></div>`).join('')}`;
}

// ── Interactions (event delegation on the pane) ──────────────────────────────
function bindStudio(pane, job) {
  const reRender = () => renderBlueprintStudio(job);

  pane.onclick = async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const qid = el.dataset.qid || el.dataset.qId || el.getAttribute('data-q-id');

    switch (action) {
      case 'mode':
        studioUi.mode = el.dataset.mode;
        studioUi.expandedQuestionId = null;
        soundEngine.playClick(); reRender(); break;
      case 'toggle-inspector':
        studioUi.inspectorOpen = !studioUi.inspectorOpen; soundEngine.playClick(); reRender(); break;
      case 'inspector-tab':
        studioUi.inspectorTab = el.dataset.tab; reRender(); break;
      case 'toggle-topic': {
        const tid = el.dataset.topicId;
        studioUi.expandedTopicId = studioUi.expandedTopicId === tid ? null : tid;
        soundEngine.playClick(); reRender(); break;
      }
      case 'toggle-question':
        studioUi.expandedQuestionId = studioUi.expandedQuestionId === qid ? null : qid;
        soundEngine.playClick(); reRender(); break;
      case 'generate':
        await handleGenerate(job, reRender); break;
      case 'add-topic': {
        functionalOf(job).topics.push(createTopic({ name: 'New topic' }));
        persist(); reRender(); break;
      }
      case 'add-question': {
        const topic = functionalOf(job).topics.find((t) => t.id === el.dataset.topicId);
        if (topic) { const nq = createQuestionBlueprint({ difficulty: topic.difficulty }); topic.questions.push(nq); studioUi.expandedQuestionId = nq.id; persist(); reRender(); }
        break;
      }
      case 'add-screening': {
        const nq = createQuestionBlueprint({ questionType: 'hr_screening', difficulty: 'Easy' });
        screeningOf(job).questions.push(nq); persist(); reRender(); break;
      }
      case 'delete-question': deleteQuestion(job, qid); persist(); reRender(); break;
      case 'add-point': { const { q } = findQuestion(job, qid); if (q) { (el.dataset.kind === 'required' ? q.rubric.requiredPoints : q.rubric.secondaryPoints).push(createRubricPoint('', el.dataset.kind === 'required' ? 2 : 1)); persist(); reRender(); } break; }
      case 'remove-point': { const { q } = findQuestion(job, qid); if (q) { q.rubric.requiredPoints.splice(Number(el.dataset.idx), 1); persist(); reRender(); } break; }
      case 'add-flag': { const { q } = findQuestion(job, qid); if (q) { q.rubric.redFlags.push(createRedFlag('', 'medium')); persist(); reRender(); } break; }
      case 'remove-flag': { const { q } = findQuestion(job, qid); if (q) { q.rubric.redFlags.splice(Number(el.dataset.idx), 1); persist(); reRender(); } break; }
      case 'set-weight': {
        const dot = e.target.closest('.bs-wdot'); if (!dot) break;
        const { q } = findQuestion(job, qid); if (!q) break;
        const w = Number(dot.dataset.w);
        const pt = q.rubric.requiredPoints[Number(el.dataset.idx)];
        if (pt) pt.weight = w;
        // update dots in place so the editor doesn't re-render and lose focus/flicker
        el.querySelectorAll('.bs-wdot').forEach((d) => d.classList.toggle('on', Number(d.dataset.w) <= w));
        persist(); break;
      }
      default: break;
    }
  };

  // Live edits — update model + save without a full re-render (keeps focus).
  pane.oninput = (e) => {
    const el = e.target.closest('[data-action="edit"], [data-action="edit-point"], [data-action="edit-flag"]');
    if (!el) return;
    const { q } = findQuestion(job, el.getAttribute('data-q-id'));
    if (!q) return;
    const field = el.dataset.field;
    if (el.dataset.action === 'edit') {
      q[field] = field === 'estimatedMinutes' ? Number(el.value) : el.value;
    } else if (el.dataset.action === 'edit-point') {
      const p = q.rubric.requiredPoints[Number(el.dataset.idx)];
      if (p) p[field] = el.value;
    } else if (el.dataset.action === 'edit-flag') {
      const f = q.rubric.redFlags[Number(el.dataset.idx)];
      if (f) f[field] = el.value;
    }
    persist();
  };

  // questionType/difficulty/severity are <select> — re-render so chips/tints update.
  pane.onchange = (e) => {
    const el = e.target.closest('.bs-select, .bs-sev-select');
    if (el) reRender();
  };

  // Drag-to-reorder: topics anywhere, questions within their topic.
  pane.ondragstart = (e) => {
    const tBar = e.target.closest('.bs-topic-bar');
    const qCard = e.target.closest('.bs-qcard');
    if (tBar) {
      const topic = tBar.closest('.bs-topic');
      dragState = { kind: 'topic', id: topic.dataset.topicId };
      topic.classList.add('bs-dragging');
    } else if (qCard && qCard.getAttribute('draggable') === 'true') {
      dragState = { kind: 'q', id: qCard.dataset.qId };
      qCard.classList.add('bs-dragging');
    } else {
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
  };
  pane.ondragover = (e) => { if (dragState) e.preventDefault(); };
  pane.ondrop = (e) => {
    if (!dragState) return;
    e.preventDefault();
    if (dragState.kind === 'topic') {
      const t = e.target.closest('.bs-topic');
      if (t && t.dataset.topicId !== dragState.id) reorderTopics(job, dragState.id, t.dataset.topicId, e);
    } else {
      const c = e.target.closest('.bs-qcard');
      if (c && c.dataset.qId !== dragState.id) reorderQuestion(job, dragState.id, c.dataset.qId, e);
    }
    dragState = null;
    persist(); reRender();
  };
  pane.ondragend = () => {
    dragState = null;
    pane.querySelectorAll('.bs-dragging').forEach((el) => el.classList.remove('bs-dragging'));
  };
}

function dropsAfter(targetEl, e) {
  if (!targetEl) return false;
  const r = targetEl.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}

function reorderTopics(job, fromId, toId, e) {
  const topics = functionalOf(job).topics;
  const moved = topics.find((t) => t.id === fromId);
  if (!moved) return;
  topics.splice(topics.indexOf(moved), 1);
  const idx = topics.findIndex((t) => t.id === toId);
  if (idx < 0) { topics.push(moved); return; }
  const after = dropsAfter(document.querySelector(`.bs-topic[data-topic-id="${toId}"]`), e);
  topics.splice(after ? idx + 1 : idx, 0, moved);
}

function reorderQuestion(job, fromId, toId, e) {
  for (const t of functionalOf(job).topics) {
    const fi = t.questions.findIndex((q) => q.id === fromId);
    const ti = t.questions.findIndex((q) => q.id === toId);
    if (fi >= 0 && ti >= 0) {
      const [moved] = t.questions.splice(fi, 1);
      const idx = t.questions.findIndex((q) => q.id === toId);
      const after = dropsAfter(document.querySelector(`.bs-qcard[data-q-id="${toId}"]`), e);
      t.questions.splice(after ? idx + 1 : idx, 0, moved);
      return;
    }
  }
}

function deleteQuestion(job, qid) {
  for (const t of functionalOf(job).topics) {
    const i = t.questions.findIndex((q) => q.id === qid);
    if (i >= 0) { t.questions.splice(i, 1); return; }
  }
  const sb = screeningOf(job);
  const j = sb.questions.findIndex((q) => q.id === qid);
  if (j >= 0) sb.questions.splice(j, 1);
}

async function handleGenerate(job, reRender) {
  if (studioUi.generating) return;
  if (!(job.description || '').trim() && !(job.resumeCriteria?.mustHave || []).length) {
    showPremiumToast('Add a job description so the AI can target questions.', 'error');
    return;
  }
  studioUi.generating = true;
  studioUi.genLabel = studioUi.mode === MODE_FUNCTIONAL ? 'Outlining…' : 'Generating…';
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  const finish = (msg) => {
    studioUi.generating = false; studioUi.genLabel = null; persist(); reRender();
    showPremiumToast(msg, 'success');
    soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
  };

  if (studioUi.mode === MODE_SCREENING) {
    let sb, offline = false;
    try { sb = await generateScreeningQuestions(job); if (!sb.questions.length) throw new Error('empty'); }
    catch { sb = localScreeningQuestions(job); offline = true; }
    job.screeningBlueprint = sb;
    finish(offline ? 'Screening questions drafted offline.' : 'Screening questions generated.');
    return;
  }

  // Functional — phase 1: outline (small, fits the token cap)
  let fb, aiOk = true;
  try { fb = await generateFunctionalOutline(job); if (!fb.topics.length) throw new Error('empty'); }
  catch { fb = localFunctionalBlueprint(job); aiOk = false; }
  job.functionalParameters = fb;
  studioUi.expandedTopicId = fb.topics[0] ? fb.topics[0].id : null;

  if (!aiOk) { finish('Blueprint drafted offline (template rubrics).'); return; }

  // Phase 2: enrich each question's rubric in its own small call, bounded
  // concurrency, re-rendering as each lands so badges fill in progressively.
  persist(); reRender();
  const queue = fb.topics.flatMap((t) => t.questions.map((q) => ({ q, topicName: t.name })));
  const total = queue.length;
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const { q, topicName } = queue.shift();
      try {
        const r = await enrichQuestionRubric(job, q, topicName);
        q.modelAnswer = r.modelAnswer; q.rubric = r.rubric;
        if (r.followUpIntent) q.followUpIntent = r.followUpIntent;
      } catch { /* keep the outline-only question; rubric badge stays 'missing' */ }
      done += 1;
      studioUi.genLabel = `Authoring rubrics ${done}/${total}`;
      persist(); reRender();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
  finish('Blueprint ready.');
}
