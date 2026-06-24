// Dashboard API client — the bridge to Krishna's FastAPI backend (see
// STITCH-PLAN.md). Behind a `local | api` flag: in 'local' mode the dashboard
// stays on localStorage (unchanged); in 'api' mode reads/writes hit FastAPI.
// Ships defaulting to 'local' so wiring is dark until the backend is verified.
//
// Translates between the backend's snake_case contract and the dashboard's
// camelCase model so neither side has to change shape (Vansh's model leads —
// see memory: prefer-vansh-version).

import { createTopic, createQuestionBlueprint, toFunctionalParameters, toScreeningQuestions } from './blueprint-engine.js';
import { request, API_BASE, apiLogin, apiSignup, apiMe, apiLogout, isAuthed, clearAuthed, apiOnboarding, apiListOrganisations, apiSwitchContext } from '../auth-client.js';

// Auth + HTTP primitives live in ../auth-client.js (dependency-free so the lean
// /login + /signup pages can reuse them). Re-export for existing callers here.
export { apiLogin, apiSignup, apiMe, apiLogout, isAuthed, clearAuthed, apiOnboarding, apiListOrganisations, apiSwitchContext };

const LS_SOURCE = 'IntervieHire_data_source';

// The candidate interview room (ai_components/apps/web). apps/web hardcodes
// `next dev -p 3000` which collides with the dashboard, so it is run on 3001.
export const ENGINE_WEB_URL = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_ENGINE_WEB_URL)
  || 'http://localhost:3001';

export function getDataSource() {
  // Default to 'api' (live backend); only stay local if explicitly opted in.
  try { return localStorage.getItem(LS_SOURCE) === 'local' ? 'local' : 'api'; } catch { return 'api'; }
}
export function setDataSource(mode) {
  try { localStorage.setItem(LS_SOURCE, mode === 'api' ? 'api' : 'local'); } catch {}
}
export const isApiMode = () => getDataSource() === 'api';

// ── Jobs ─────────────────────────────────────────────────────────────────
export async function apiFetchJobs() {
  const data = await request('/jobs');
  const list = Array.isArray(data) ? data : (data?.jobs || data?.data || []);
  return list.map(mapJobOutToJob);
}
export async function apiFetchJob(id) {
  return mapJobOutToJob(await request(`/jobs/${id}`));
}
// Create a job on the backend (api mode) so it persists across refetches.
// Returns the mapped job with its real backend id + organisation_name.
export async function apiCreateJob(job) {
  const body = {
    title: job.cardName || job.roleName || 'Untitled Job',
    role_name: job.roleName || job.cardName || 'Untitled Role',
    experience_band: job.experienceBand || null,
    custom_job_id: (job.customJobId && job.customJobId !== '-') ? job.customJobId : null,
    status: job.status || 'draft',
    resume_analysis_enabled: job.pipelineConfig?.resumeAnalysis?.enabled ?? true,
    recruiter_screening_enabled: job.pipelineConfig?.recruiterScreening?.enabled ?? true,
    functional_interview_enabled: job.pipelineConfig?.functionalInterview?.enabled ?? true,
    description: job.description || null,
  };
  return mapJobOutToJob(await request('/jobs', { method: 'POST', body }));
}
// Persist the authored blueprint — the exact JobParametersIn shape the backend
// + ai_sync.py consume (functional_parameters carries questionsDetailed).
export async function apiPatchJobParameters(id, job) {
  const body = mapJobToParametersPayload(job);
  return request(`/jobs/${id}/parameters`, { method: 'PATCH', body });
}
// Delete a job on the backend so it stays gone after a refetch. The backend
// cascades its applicants + collaborators (see jobs.py delete_job).
export async function apiDeleteJob(id) {
  return request(`/jobs/${id}`, { method: 'DELETE' });
}
// Persist a job's status (archive / unarchive / publish) so it survives a refetch.
export async function apiUpdateJobStatus(id, status) {
  return request(`/jobs/${id}/settings`, { method: 'PATCH', body: { status } });
}

// Debounced backend autosave for job parameters (scoring config, criteria, flow,
// questions). Any feature that mutates a job calls this right after
// saveStateToLocalStorage(); no-op outside API mode or for local-only jobs.
const _jobSaveTimers = {};
export function scheduleJobSave(job) {
  if (getDataSource() !== 'api' || !job || !job._backend || !job.id) return;
  clearTimeout(_jobSaveTimers[job.id]);
  _jobSaveTimers[job.id] = setTimeout(() => {
    apiPatchJobParameters(job.id, job).catch((e) => console.warn('Job sync failed:', e));
  }, 800);
}
export async function apiFetchApplicants(jobId, tab = 'functional') {
  const data = await request(`/jobs/${jobId}/responses?tab=${encodeURIComponent(tab)}`);
  const list = Array.isArray(data) ? data : (data?.applicants || data?.data || []);
  return list.map(mapApplicantOutToCandidate);
}
// Deep Analysis source: the full canonical CandidateReport, or null until the
// engine has scored the interview (Deep Analysis then shows its pending state).
export async function apiFetchCandidateReport(applicantId) {
  const data = await request(`/jobs/applicants/${applicantId}/functional-report`);
  return mapFullReportToCandidateReport(data);
}
// Dev launcher: create a throwaway test interview from the job's blueprint and
// return its session id (= the test applicant id) for the candidate room.
export async function apiCreateTestSession(jobId) {
  const data = await request(`/jobs/${jobId}/test-session`, { method: 'POST' });
  return data?.session_id || null;
}

// Persist a candidate to the backend so it has a real UUID (and can be scheduled
// / interviewed). Used when a candidate was added in the UI but only carries a
// local "CAN-…" code. Returns the mapped candidate with its backend UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A candidate added in the UI may carry only a local "CAN-…" code (not yet on the
// backend). Some actions need a real backend UUID — create the applicant on demand
// and adopt its UUID. Mutates c2 (id + _backend). Returns the backend id.
export async function ensureBackendApplicantId(c2, jobId) {
  if (UUID_RE.test(String(c2.id || ''))) return c2.id;
  if (c2.backendId && UUID_RE.test(String(c2.backendId))) return c2.backendId; // already registered (e.g. by resume analysis)
  if (!c2.email) throw new Error(`${c2.name || 'Candidate'} has no email — add one before syncing to the backend.`);
  const created = await apiAddApplicant(jobId, { name: c2.name, email: c2.email, phone: c2.phone });
  if (!created || !created.id) throw new Error('Could not register the candidate in the backend.');
  c2.backendId = created.id;
  c2.id = created.id;       // adopt the real backend UUID for all future actions
  c2._backend = true;
  return created.id;
}

export async function apiAddApplicant(jobId, { name, email, phone, source } = {}) {
  const data = await request(`/jobs/${jobId}/applicants`, {
    method: 'POST',
    body: {
      name: name || 'Candidate',
      email,
      phone: phone || null,
      // Optional. 'scheduled' → backend sets screening_status=pending (lands in
      // Recruiter Screening); 'functional' → functional_status=pending; omitted
      // → Resume Analysis only. Sent only when provided so existing callers are unaffected.
      ...(source ? { source } : {}),
    },
  });
  return mapApplicantOutToCandidate(data);
}

export async function apiScheduleCandidate(applicantId, scheduledAt, stage = 'screening') {
  const data = await request(`/jobs/applicants/${applicantId}/schedule`, {
    method: 'POST',
    body: {
      scheduled_at: scheduledAt,
      stage: stage,
    },
  });
  return mapApplicantOutToCandidate(data);
}

// Persist a partial applicant update (resume score/report, shortlist flag, etc.)
// to the backend. `patch` keys are backend snake_case (ApplicantUpdateIn). The
// route ignores unset fields, so send only what changed. Returns the mapped row.
export async function apiUpdateApplicant(applicantId, patch) {
  const data = await request(`/jobs/applicants/${applicantId}`, { method: 'PATCH', body: patch });
  return mapApplicantOutToCandidate(data);
}

// Fetch the real parsed resume text the backend has on file for this applicant.
// Returns '' when the backend has nothing stored, so callers can fall back
// cleanly instead of scoring fabricated text.
export async function apiGetResumeText(applicantId) {
  const data = await request(`/jobs/applicants/${applicantId}/resume-text`);
  return (data && data.text) || '';
}

// Upload one or more resume files to a job's applicant pool.
// `source` controls what stage new candidates land in:
//   'scheduled'  → Recruiter Screening (screening_status = pending)
//   'functional' → Functional Interview (functional_status = pending)
//   (default)    → Resume Analysis (bulk_upload, no status set)
// Uses raw fetch so FormData is sent as multipart/form-data — the JSON
// `request()` helper would override Content-Type and break the upload.
export async function apiUploadResumes(jobId, files, source = null) {
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  const url = `${API_BASE}/jobs/${jobId}/applicants/upload-resumes${source ? `?source=${encodeURIComponent(source)}` : ''}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });
  } catch (err) {
    throw new Error(`Network error uploading resumes: ${err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error || data.message)) || `${res.status} ${res.statusText}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return Array.isArray(data) ? data.map(mapApplicantOutToCandidate) : [];
}

// ── Team ───────────────────────────────────────────────────────────────────
// The recruiter's organisation members. Backed by /api/team — invite creates a
// real User row (so the invitee can log in), list/patch/delete keep the team
// table in sync with the shared DB instead of living only in localStorage.
export async function apiListTeam() {
  const data = await request('/team');
  const list = Array.isArray(data?.members) ? data.members : (Array.isArray(data) ? data : []);
  return list.map(mapMemberOutToTeam);
}
export async function apiInviteMember({ name, email, designation, usertype } = {}) {
  const data = await request('/team/invite', {
    method: 'POST',
    body: {
      name: name || 'Member',
      email,
      designation: designation || null,
      user_type: mapUsertypeOut(usertype),
    },
  });
  return mapMemberOutToTeam(data);
}
// Persist an inline role/status edit. Pass dashboard-facing keys (usertype /
// status / designation); only the ones provided are sent to the backend.
export async function apiUpdateMember(userId, { usertype, status, designation } = {}) {
  const body = {};
  if (usertype !== undefined) body.user_type = mapUsertypeOut(usertype);
  if (status !== undefined) body.status = String(status).toLowerCase();
  if (designation !== undefined) body.designation = designation;
  return mapMemberOutToTeam(await request(`/team/${userId}`, { method: 'PATCH', body }));
}
export async function apiRemoveMember(userId) {
  return request(`/team/${userId}`, { method: 'DELETE' });
}

// ── Usage / Analytics ───────────────────────────────────────────────────────
// Backs the Usage Overview page (view-analytics). These hit the org-scoped
// /api/usage/* endpoints — the active_org_id cookie rides along with request(),
// so the data is always the *active* organisation's, never a cross-org aggregate.

// Headline funnel stats for the active org. start/end are optional Date bounds
// (from getDateRangeBounds()); when present they're sent as date_from/date_to so
// the cards reflect the chosen range. Returns the raw UsageStatsOut (snake_case)
// — applyUsageStats() reads those fields directly, no mapping needed.
export async function apiFetchUsageStats(start, end) {
  const qs = new URLSearchParams();
  if (start) qs.set('date_from', start.toISOString());
  if (end) qs.set('date_to', end.toISOString());
  const q = qs.toString();
  return request(`/usage/stats${q ? `?${q}` : ''}`);
}

// Every applicant across the active org's visible jobs, mapped to the dashboard
// candidate shape. Usage rows carry job_id/created_at/match_score but no role
// title, so we fill the table-specific fields the shared mapper omits: jobId
// (per-job filtering + role join), registeredOn (the date column + date filter),
// and score (the "Match Score" column). jobApplied is joined from AppState.jobs
// by the caller (hydrateUsageAnalytics) since the row has no role name.
export async function apiFetchUsageCandidates() {
  const rows = await request('/usage/candidates-table');
  return arr(rows).map((r) => {
    const c = mapApplicantOutToCandidate(r);
    c.jobId = r.job_id || null;
    c.registeredOn = fmtRegisteredOn(r.created_at);
    c.score = r.match_score ?? '—';
    return c;
  });
}

// ISO timestamp → the same human string the demo candidates use
// ('04 Mar 2026, 10:15 AM') so parseFuzzyDate()/the date filter keep working and
// the column matches local mode exactly.
function fmtRegisteredOn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${MON[d.getMonth()]} ${d.getFullYear()}, ${String(h).padStart(2, '0')}:${min} ${ampm}`;
}


// ── Mappers: backend (snake_case) ⇄ dashboard (camelCase) ──────────────────
const arr = (v) => (Array.isArray(v) ? v : []);

function mapJobOutToJob(j = {}) {
  const rp = j.resume_parameters || {};
  return {
    id: j.id,
    roleName: j.role_name || j.title || '',
    cardName: j.card_name || j.title || j.role_name || '',
    companyName: j.organisation_name || '',
    customJobId: j.custom_job_id || '-',
    status: j.status || 'published',
    experienceBand: j.experience_band || '',
    description: j.description || '',
    tags: arr(j.tags),
    createdBy: j.created_by_name || '',
    resumeCriteria: {
      mustHave: arr(rp.must_have || rp.mustHave),
      redFlags: arr(rp.red_flags || rp.redFlags),
      goodToHave: arr(rp.good_to_have || rp.goodToHave),
      goodToHaveMinMatch: rp.good_to_have_min_match ?? 1,
    },
    scoringConfig: rp.scoring_config || undefined,
    screeningParams: mapScreeningParamsIn(j.screening_parameters),
    screeningBlueprint: { questions: arr(j.screening_questions).map((q) => createQuestionBlueprint({ prompt: typeof q === 'string' ? q : q.text, questionType: 'hr_screening', difficulty: 'Easy' })) },
    functionalParameters: mapFunctionalIn(j.functional_parameters),
    pipelineConfig: {
      careerPage: { enabled: true, listed: !!j.is_job_listed },
      resumeAnalysis: { enabled: !!j.resume_analysis_enabled },
      recruiterScreening: { enabled: !!j.recruiter_screening_enabled },
      functionalInterview: { enabled: !!j.functional_interview_enabled },
    },
    pipeline: j.pipeline || { total: 0, resume: 0, screening: 0, functional: 0 },
    _backend: true,
  };
}

// Backend screening_parameters {experience:[{parameter,preferred_response,required}],...}
// → dashboard screeningParams [{category, params:[{name,required,preferredResponse}]}].
function mapScreeningParamsIn(sp) {
  if (!sp || typeof sp !== 'object') return [];
  return Object.entries(sp).map(([category, params]) => ({
    category: category.charAt(0).toUpperCase() + category.slice(1),
    params: arr(params).map((p) => ({ name: p.parameter || p.name || '', required: !!p.required, flexibility: '', preferredResponse: p.preferred_response || p.preferredResponse || '' })),
  }));
}

// Dashboard screeningParams → backend screening_parameters (reverse of
// mapScreeningParamsIn). Without this the screening grid — including recruiter
// custom params — only lived in localStorage and never reached the backend.
function mapScreeningParamsOut(screeningParams) {
  const out = {};
  arr(screeningParams).forEach((cat) => {
    if (!cat || !cat.category) return;
    out[cat.category.toLowerCase()] = arr(cat.params).map((p) => ({
      parameter: p.name || '',
      preferred_response: p.preferredResponse || '',
      required: !!p.required,
    }));
  });
  return out;
}

// Backend functional_parameters.topics[] → dashboard functionalParameters via the
// engine factories (carries questionsDetailed → rubric when present).
function mapFunctionalIn(fp) {
  const topics = arr(fp?.topics);
  if (!topics.length) return { topics: [] };
  return {
    topics: topics.map((t) => createTopic({
      name: t.name,
      type: t.type,
      difficulty: t.difficulty,
      questions: (arr(t.questionsDetailed).length ? t.questionsDetailed : arr(t.questions)).map((q) => {
        if (typeof q === 'string') return createQuestionBlueprint({ prompt: q });
        let guidance = {};
        try { guidance = q.aiEvaluationGuidance ? JSON.parse(q.aiEvaluationGuidance) : {}; } catch { guidance = {}; }
        return createQuestionBlueprint({
          // Preserve the stable id across the round-trip so edits map back to
          // the same backend Question row instead of minting a fresh id.
          id: q.id || guidance.blueprintQuestionId,
          prompt: q.text || q.prompt, questionType: q.questionType || guidance.questionType,
          difficulty: q.difficulty, estimatedMinutes: q.estimatedMinutes,
          competency: guidance.competency, targetRequirement: guidance.targetRequirement,
          followUpIntent: guidance.followUpIntent, edited: guidance.edited,
          modelAnswer: guidance.modelAnswer, rubric: guidance.rubric,
        });
      }),
    })),
  };
}

// Dashboard job → backend JobParametersIn. Delegates to the engine's contract
// serializers (toFunctionalParameters / toScreeningQuestions) so there is ONE
// source of truth for the wire shape — the v2 aiEvaluationGuidance envelope
// (stable blueprintQuestionId + competency/targetRequirement/followUpIntent)
// flows automatically and can't drift from a duplicated serializer here.
function mapJobToParametersPayload(job) {
  const fp = job.functionalParameters || { topics: [] };
  const sb = job.screeningBlueprint || { questions: [] };
  const rc = job.resumeCriteria || {};
  return {
    screening_questions: toScreeningQuestions(sb),
    functional_parameters: toFunctionalParameters(fp),
    // scoring_config rides inside resume_parameters (a freeform JSON column) so the
    // recruiter's weights/criteria persist without a schema change.
    resume_parameters: {
      must_have: arr(rc.mustHave), red_flags: arr(rc.redFlags), good_to_have: arr(rc.goodToHave),
      ...(job.scoringConfig ? { scoring_config: job.scoringConfig } : {}),
    },
    // Only send when present — the handler skips null fields, so a save from a
    // job without screening params loaded won't wipe the backend's copy.
    ...(arr(job.screeningParams).length ? { screening_parameters: mapScreeningParamsOut(job.screeningParams) } : {}),
  };
}

// Normalise a backend interview status (snake_case) to the dashboard enum so the
// status chips never mislabel — unknown/absent reads as null (→ "Not Started").
function mapInterviewStatus(s) {
  if (!s) return null;
  const k = String(s).toLowerCase().replace(/\s+/g, '_');
  const map = {
    completed: 'Completed', incomplete: 'Incomplete', evaluating: 'Evaluating',
    attempting: 'Attempting', in_progress: 'Attempting', not_started: 'Not Started',
    scheduled: 'Not Started', pending: 'Not Started', slot_missed: 'Slot Missed', missed: 'Slot Missed',
  };
  return map[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
}

function mapApplicantOutToCandidate(a = {}) {
  return {
    id: a.id,
    name: a.name || '',
    email: a.email || '',
    jobApplied: a.job_role_title || a.role_name || '',
    // decision (the recruiter's explicit call) wins over derived stage so Hired/Rejected
    // and a pre-schedule shortlist survive a refetch. 'shortlisted' shows as Screening
    // (advanced past resume); exact Screening-vs-Functional persists once scheduled.
    status: a.decision === 'hired' ? 'Hired'
      : a.decision === 'rejected' ? 'Rejected'
      : a.functional_status ? 'Functional'
      : (a.screening_status || a.decision === 'shortlisted') ? 'Screening'
      : 'Resume',
    source: a.source || 'ATS',
    interviewStatus: mapInterviewStatus(a.functional_status),
    interviewScore: a.functional_score ?? a.overall_interview_score ?? null,
    cheatProbability: a.cheat_probability ? a.cheat_probability.charAt(0).toUpperCase() + a.cheat_probability.slice(1) : null,
    matchScore: a.match_score ?? null,
    // Stored resume text + analysis flags (ApplicantOut). resumeText hydrates the
    // analysis cache so "Reanalyse" doesn't need an extra resume-text fetch.
    resumeText: a.resume_text ?? null,
    resumeAnalysed: a.resume_analysed ?? null,
    resumeShortlisted: a.resume_shortlisted ?? null,
    decision: a.decision ?? null,
    // Recruiter screening result — the backend sends these (ApplicantOut), the
    // dashboard's report + Deep Analysis read them off the candidate. Without this
    // mapping the screening block stays blank in api mode even when scored.
    recruiterScreening: a.recruiter_screening ?? null,
    recruiterScreeningScore: a.recruiter_screening_score ?? null,
    screeningStatus: mapInterviewStatus(a.screening_status),
    screeningScore: a.screening_score ?? null,
    attemptedAt: a.attempted_at ?? null,
    // Rehydrate the stored analysis so a re-opened report shows the saved result
    // instead of re-scoring from scratch.
    ...(() => { try { const p = a.resume_analysis_report ? JSON.parse(a.resume_analysis_report) : null; return p ? { resumeAnalysis: p } : {}; } catch { return {}; } })(),
    _backend: true,
  };
}

// Backend user (UserOut) → dashboard team member. The backend's user_type
// (super_admin|org_admin|member) is coarser than the UI's role label, so member
// defaults to "Recruiter"; backendId carries the UUID needed for PATCH/DELETE.
function mapMemberOutToTeam(u = {}) {
  const ut = String(u.user_type || '').toLowerCase();
  const usertype = (ut === 'org_admin' || ut === 'super_admin') ? 'Org. Admin' : 'Recruiter';
  const st = String(u.status || 'active').toLowerCase();
  const status = st.charAt(0).toUpperCase() + st.slice(1);
  let registeredOn = '';
  if (u.registered_on) {
    try {
      registeredOn = new Date(u.registered_on).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { registeredOn = ''; }
  }
  return {
    backendId: u.id,
    name: u.name || '',
    email: u.email || '',
    designation: u.designation || '',
    usertype,
    registeredOn,
    status,
    _backend: true,
  };
}
// Dashboard role label → backend user_type enum. Only "Org. Admin" maps to an
// admin; Recruiter/Interviewer both map to "member" (the backend has no finer role).
function mapUsertypeOut(usertype) {
  return usertype === 'Org. Admin' ? 'org_admin' : 'member';
}

// Backend functional-report → canonical CandidateReport. The engine's stored
// evaluation already matches the dashboard's Deep Analysis shape, so a real
// report (with questionBreakdown) passes straight through; otherwise null so
// Deep Analysis shows its honest pending/empty state (no sample fabrication).
function mapFullReportToCandidateReport(data) {
  if (!data) return null;
  const report = data.report;
  if (data.evaluated && report && Array.isArray(report.questionBreakdown)) return report;
  return null;
}
