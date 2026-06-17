// Dashboard API client — the bridge to Krishna's FastAPI backend (see
// STITCH-PLAN.md). Behind a `local | api` flag: in 'local' mode the dashboard
// stays on localStorage (unchanged); in 'api' mode reads/writes hit FastAPI.
// Ships defaulting to 'local' so wiring is dark until the backend is verified.
//
// Translates between the backend's snake_case contract and the dashboard's
// camelCase model so neither side has to change shape (Vansh's model leads —
// see memory: prefer-vansh-version).

import { createTopic, createQuestionBlueprint, toFunctionalParameters, toScreeningQuestions } from './blueprint-engine.js';
import { request, apiLogin, apiSignup, apiMe, apiLogout, isAuthed, clearAuthed } from '../auth-client.js';

// Auth + HTTP primitives live in ../auth-client.js (dependency-free so the lean
// /login + /signup pages can reuse them). Re-export for existing callers here.
export { apiLogin, apiSignup, apiMe, apiLogout, isAuthed, clearAuthed };

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
export async function apiFetchApplicants(jobId, tab = 'functional') {
  const data = await request(`/jobs/${jobId}/responses?tab=${encodeURIComponent(tab)}`);
  const list = Array.isArray(data) ? data : (data?.applicants || data?.data || []);
  return list.map(mapApplicantOutToCandidate);
}
// Persist added candidates to the backend (api mode) so they survive refetch —
// without this the dashboard only pushed to local AppState and they vanished on
// the next hydrate. Backend requires a valid EmailStr per applicant, so each
// email is sanitised with a stable placeholder fallback (one blank row can't
// 422 the whole batch). Returns the mapped, backend-id'd candidates.
export async function apiAddApplicantsBulk(jobId, candidates) {
  const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const slug = (n) => ((n || 'candidate').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '').slice(0, 40) || 'candidate');
  const applicants = (candidates || []).map((c, i) => ({
    name: (c.name && String(c.name).trim()) || 'Unnamed Candidate',
    email: isEmail(c.email) ? c.email : `${slug(c.name)}.${i}@placeholder.interviehire.com`,
    phone: c.phone || null,
    source: 'bulk_upload',
  }));
  if (!applicants.length) return [];
  const data = await request(`/jobs/${jobId}/applicants/bulk`, { method: 'POST', body: { applicants } });
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

export async function apiUploadResumes(jobId, files) {
  const fd = new FormData();
  files.forEach(f => {
    fd.append('files', f);
  });
  const base = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_API_URL) || 'http://localhost:8000/api';
  const res = await fetch(`${base}/jobs/${jobId}/applicants/upload-resumes`, {
    method: 'POST',
    credentials: 'include',
    body: fd
  });
  if (!res.ok) {
    const text = await res.text();
    let err = text;
    try { err = JSON.parse(text)?.detail || text; } catch {}
    throw new Error(err);
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data?.applicants || data?.data || []);
  return list.map(mapApplicantOutToCandidate);
}

export async function apiChangePassword(currentPassword, newPassword) {
  return request('/settings/password', {
    method: 'PUT',
    body: {
      current_password: currentPassword,
      new_password: newPassword
    }
  });
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

export async function apiUpdateJobSettings(id, job) {
  const body = {
    title: job.cardName || job.roleName || undefined,
    role_name: job.roleName || job.cardName || undefined,
    experience_band: job.experienceBand || undefined,
    custom_job_id: (job.customJobId && job.customJobId !== '-') ? job.customJobId : undefined,
    status: job.status || undefined,
    is_job_listed: job.pipelineConfig?.careerPage?.listed ?? undefined,
    resume_analysis_enabled: job.pipelineConfig?.resumeAnalysis?.enabled ?? undefined,
    recruiter_screening_enabled: job.pipelineConfig?.recruiterScreening?.enabled ?? undefined,
    functional_interview_enabled: job.pipelineConfig?.functionalInterview?.enabled ?? undefined,
    description: job.description || undefined,
    tags: job.tags || undefined,
    job_type: job.jobType || undefined,
    location: job.location || undefined,
  };
  // Clean undefined properties so we don't send them
  Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);
  return mapJobOutToJob(await request(`/jobs/${id}/settings`, { method: 'PATCH', body }));
}

export async function apiDeleteJob(id) {
  return request(`/jobs/${id}`, { method: 'DELETE' });
}

export async function apiUpdateApplicant(applicantId, details) {
  const body = {};
  if (details.status !== undefined) body.status = details.status;
  if (details.screeningStatus !== undefined) body.screening_status = details.screeningStatus;
  if (details.screeningScore !== undefined) body.screening_score = details.screeningScore;
  if (details.functionalStatus !== undefined) body.functional_status = details.functionalStatus;
  if (details.functionalScore !== undefined) body.functional_score = details.functionalScore;
  if (details.cheatProbability !== undefined) body.cheat_probability = details.cheatProbability;
  if (details.resumeAnalysed !== undefined) body.resume_analysed = details.resumeAnalysed;
  if (details.resumeShortlisted !== undefined) body.resume_shortlisted = details.resumeShortlisted;
  if (details.resumeWaitlisted !== undefined) body.resume_waitlisted = details.resumeWaitlisted;
  if (details.recruiterScreening !== undefined) body.recruiter_screening = details.recruiterScreening;
  if (details.recruiterScreeningScore !== undefined) body.recruiter_screening_score = details.recruiterScreeningScore;
  if (details.attemptedAt !== undefined) body.attempted_at = details.attemptedAt;
  if (details.remarks !== undefined) body.remarks = details.remarks;
  if (details.matchScore !== undefined) body.match_score = details.matchScore;
  if (details.resumeAnalysisReport !== undefined) body.resume_analysis_report = details.resumeAnalysisReport;
  if (details.screeningScheduledAt !== undefined) body.screening_scheduled_at = details.screeningScheduledAt;
  if (details.functionalScheduledAt !== undefined) body.functional_scheduled_at = details.functionalScheduledAt;
  if (details.overallInterviewScore !== undefined) body.overall_interview_score = details.overallInterviewScore;
  if (details.proctoringSeverityFlag !== undefined) body.proctoring_severity_flag = details.proctoringSeverityFlag;
  if (details.calendarSequence !== undefined) body.calendar_sequence = details.calendarSequence;
  if (details.schedulingToken !== undefined) body.scheduling_token = details.schedulingToken;
  if (details.calendarEventId !== undefined) body.calendar_event_id = details.calendarEventId;

  for (const [key, value] of Object.entries(details)) {
    if (body[key] === undefined && key.includes('_')) {
      body[key] = value;
    }
  }

  const data = await request(`/jobs/applicants/${applicantId}`, { method: 'PATCH', body });
  return mapApplicantOutToCandidate(data);
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
    resume_parameters: { must_have: arr(rc.mustHave), red_flags: arr(rc.redFlags), good_to_have: arr(rc.goodToHave) },
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

function mapSource(s) {
  if (!s) return 'ATS';
  const map = {
    career_page: 'Career Page',
    bulk_upload: 'Bulk Upload',
    direct_link: 'Direct Link',
    scheduled: 'Scheduled',
    ats: 'ATS'
  };
  return map[String(s).toLowerCase()] || s;
}

function mapApplicantOutToCandidate(a = {}) {
  const status = a.status || (a.functional_status ? 'Functional' : (a.screening_status ? 'Screening' : 'Resume'));
  const rawInterviewStatus = status === 'Functional' ? a.functional_status : (status === 'Screening' ? a.screening_status : null);
  
  let remarks = [];
  if (a.remarks) {
    try { remarks = JSON.parse(a.remarks); } catch { remarks = []; }
  }
  
  let resumeAnalysis = null;
  if (a.resume_analysis_report) {
    try { resumeAnalysis = JSON.parse(a.resume_analysis_report); } catch { resumeAnalysis = null; }
  }

  return {
    id: a.id,
    name: a.name || '',
    email: a.email || '',
    jobApplied: a.job_role_title || a.role_name || '',
    status: status,
    source: mapSource(a.source),
    interviewStatus: mapInterviewStatus(rawInterviewStatus),
    interviewScore: a.functional_score ?? a.overall_interview_score ?? null,
    cheatProbability: a.cheat_probability ? a.cheat_probability.charAt(0).toUpperCase() + a.cheat_probability.slice(1) : null,
    matchScore: a.match_score ?? null,
    remarks: remarks,
    resumeAnalysis: resumeAnalysis,
    score: a.match_score != null ? `${a.match_score}%` : '—',
    _backend: true,
  };
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

// ── Team ─────────────────────────────────────────────────────────────────
export async function apiFetchTeam() {
  const data = await request('/team');
  const members = Array.isArray(data) ? data : (data?.members || []);
  return members.map(mapUserOutToMember);
}

export async function apiInviteMember(name, email, designation, usertype) {
  const user_type = (usertype === 'Org. Admin') ? 'org_admin' : 'member';
  const body = { name, email, designation, user_type };
  const data = await request('/team/invite', { method: 'POST', body });
  return mapUserOutToMember(data);
}

export async function apiRemoveMember(userId) {
  return request(`/team/${userId}`, { method: 'DELETE' });
}

// ── Usage/Analytics Candidates ───────────────────────────────────────────
export async function apiFetchUsageCandidates() {
  const data = await request('/usage/candidates-table');
  const list = Array.isArray(data) ? data : [];
  return list.map(mapApplicantOutToCandidate);
}

// ── Organisation ──────────────────────────────────────────────────────────
export async function apiFetchOrganisation() {
  return request('/organisation');
}

export async function apiUpdateOrganisation(orgDetails) {
  return request('/organisation', { method: 'PUT', body: orgDetails });
}

function mapUserOutToMember(m = {}) {
  let usertype = 'Recruiter';
  if (m.user_type === 'org_admin' || m.user_type === 'super_admin') {
    usertype = 'Org. Admin';
  } else if (m.designation && /interview/i.test(m.designation)) {
    usertype = 'Interviewer';
  }
  
  const statusMap = {
    active: 'Active',
    invited: 'Invited',
    inactive: 'Inactive'
  };

  return {
    id: m.id,
    name: m.name,
    email: m.email,
    designation: m.designation || '',
    usertype: usertype,
    registeredOn: m.registered_on ? new Date(m.registered_on).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
    status: statusMap[m.status] || 'Active',
    _backend: true
  };
}
