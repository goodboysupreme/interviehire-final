// Dashboard API client — the bridge to Krishna's FastAPI backend (see
// STITCH-PLAN.md). Behind a `local | api` flag: in 'local' mode the dashboard
// stays on localStorage (unchanged); in 'api' mode reads/writes hit FastAPI.
// Ships defaulting to 'local' so wiring is dark until the backend is verified.
//
// Translates between the backend's snake_case contract and the dashboard's
// camelCase model so neither side has to change shape (Vansh's model leads —
// see memory: prefer-vansh-version).

import { createTopic, createQuestionBlueprint } from './blueprint-engine.js';

const LS_SOURCE = 'IntervieHire_data_source';
const LS_TOKEN = 'IntervieHire_auth_token';

// Base URL: env override (NEXT_PUBLIC_API_URL) → default local FastAPI.
const API_BASE = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_API_URL)
  || 'http://localhost:8000/api';

export function getDataSource() {
  try { return localStorage.getItem(LS_SOURCE) === 'api' ? 'api' : 'local'; } catch { return 'local'; }
}
export function setDataSource(mode) {
  try { localStorage.setItem(LS_SOURCE, mode === 'api' ? 'api' : 'local'); } catch {}
}
export const isApiMode = () => getDataSource() === 'api';

// Auth is an httponly `token` cookie set by the backend (samesite=lax; reaches
// :8000 because localhost ports are same-site). JS can't read it, so we only
// track a local "signed in" flag for UI — the browser carries the cookie via
// credentials:'include'.
function setAuthed(v) { try { v ? localStorage.setItem(LS_TOKEN, '1') : localStorage.removeItem(LS_TOKEN); } catch {} }

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch (err) {
    throw new Error(`Network error reaching backend (${API_BASE}). Is FastAPI running on :8000? ${err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error || data.message)) || `${res.status} ${res.statusText}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

// ── Auth ─────────────────────────────────────────────────────────────────
export async function apiLogin(email, password) {
  const data = await request('/auth/login', { method: 'POST', body: { email, password } });
  setAuthed(true);
  return { user: data?.user || null, onboardingRequired: !!data?.onboarding_required };
}
export async function apiLogout() { try { await request('/auth/logout', { method: 'POST' }); } catch {} setAuthed(false); }
export const isAuthed = () => { try { return localStorage.getItem(LS_TOKEN) === '1'; } catch { return false; } };

// ── Jobs ─────────────────────────────────────────────────────────────────
export async function apiFetchJobs() {
  const data = await request('/jobs');
  const list = Array.isArray(data) ? data : (data?.jobs || data?.data || []);
  return list.map(mapJobOutToJob);
}
export async function apiFetchJob(id) {
  return mapJobOutToJob(await request(`/jobs/${id}`));
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
// Deep Analysis source: the full canonical CandidateReport, or null until the
// engine has scored the interview (Deep Analysis then shows its pending state).
export async function apiFetchCandidateReport(applicantId) {
  const data = await request(`/jobs/applicants/${applicantId}/functional-report`);
  return mapFullReportToCandidateReport(data);
}

// ── Mappers: backend (snake_case) ⇄ dashboard (camelCase) ──────────────────
const arr = (v) => (Array.isArray(v) ? v : []);

function mapJobOutToJob(j = {}) {
  const rp = j.resume_parameters || {};
  return {
    id: j.id,
    roleName: j.role_name || j.title || '',
    cardName: j.card_name || j.title || j.role_name || '',
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
          prompt: q.text || q.prompt, questionType: q.questionType || guidance.questionType,
          difficulty: q.difficulty, estimatedMinutes: q.estimatedMinutes,
          modelAnswer: guidance.modelAnswer, rubric: guidance.rubric,
        });
      }),
    })),
  };
}

// Dashboard job → backend JobParametersIn. Reuses the engine's contract
// serializers so the wire shape matches ai_sync.py exactly.
function mapJobToParametersPayload(job) {
  const fp = job.functionalParameters || { topics: [] };
  const sb = job.screeningBlueprint || { questions: [] };
  const rc = job.resumeCriteria || {};
  return {
    screening_questions: arr(sb.questions).map((q) => q.prompt),
    functional_parameters: {
      topics: arr(fp.topics).map((t) => ({
        name: t.name, type: t.type, difficulty: t.difficulty,
        questions: arr(t.questions).map((q) => q.prompt),
        questionsDetailed: arr(t.questions).map((q) => ({
          text: q.prompt, questionType: q.questionType, difficulty: q.difficulty,
          estimatedMinutes: q.estimatedMinutes,
          aiEvaluationGuidance: JSON.stringify({
            questionType: q.questionType, modelAnswer: q.modelAnswer,
            rubric: {
              requiredPoints: (q.rubric?.requiredPoints || []).map((p) => ({ id: p.id, description: p.description, keywords: p.keywords, weight: p.weight })),
              secondaryPoints: (q.rubric?.secondaryPoints || []).map((p) => ({ id: p.id, description: p.description, keywords: p.keywords, weight: p.weight })),
              excellentAnswerSignals: q.rubric?.excellentAnswerSignals || [],
              redFlags: (q.rubric?.redFlags || []).map((f) => ({ id: f.id, description: f.description, severity: f.severity })),
            },
          }),
        })),
      })),
    },
    resume_parameters: { must_have: arr(rc.mustHave), red_flags: arr(rc.redFlags), good_to_have: arr(rc.goodToHave) },
  };
}

function mapApplicantOutToCandidate(a = {}) {
  return {
    id: a.id,
    name: a.name || '',
    email: a.email || '',
    jobApplied: a.job_role_title || a.role_name || '',
    status: a.functional_status === 'completed' ? 'Functional' : (a.screening_status === 'completed' ? 'Screening' : 'Resume'),
    source: a.source || 'ATS',
    interviewStatus: a.functional_status === 'completed' ? 'Completed' : (a.functional_status || null),
    interviewScore: a.functional_score ?? a.overall_interview_score ?? null,
    cheatProbability: a.cheat_probability ? a.cheat_probability.charAt(0).toUpperCase() + a.cheat_probability.slice(1) : null,
    matchScore: a.match_score ?? null,
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
