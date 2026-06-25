# IntervieHire API Reference

> This file is the **single source-of-truth API contract** for IntervieHire across all three services. It **MUST be kept in sync on every route change** — any time an API route is added, modified, refactored, or removed, this file is updated in the same unit of work. See `CLAUDE.md` ("`api.md` is a living API contract") for the enforcement rules.

## Changelog

> Append-only, newest first. A new entry is **prepended** here whenever a route is added, modified, refactored, or removed. Never rewrite history.

- **2026-06-25** — Added optional `entry_method` (string, nullable, default null) to `AddApplicantIn` and `ApplicantOut`; `BulkApplicantsIn` inherits it (wraps `List[AddApplicantIn]`). It records the candidate's input method — how they were added to the pipeline (`bulk_upload` | `ats` | `direct_link` | `career_page`) — independent of the overloaded `source` field (which is reused for stage routing: scheduled/functional). Stored as a plain nullable VARCHAR, NOT a Postgres enum. `POST /api/jobs/{job_id}/applicants/upload-resumes` now defaults newly-created applicants' `entry_method` to `"bulk_upload"` (existing matched applicants left unchanged). Affected routes: `POST /api/jobs/{job_id}/applicants`, `POST /api/jobs/{job_id}/applicants/bulk`, `POST /api/jobs/{job_id}/applicants/upload-resumes`, `PATCH /api/jobs/applicants/{applicant_id}`, `POST /api/jobs/applicants/{applicant_id}/schedule`, and `GET /api/jobs/{job_id}/responses` (all return `ApplicantOut`).
- **2026-06-24** — Documented Talent Finder (13 routes under `/api/talent-finder`), merged in from origin/master's talent-finder feature (`backend/app/talent_finder/`, mounted in `main.py`). Route groups: search (POST /search, GET /search/{search_id}/status, GET /search/{search_id}/results), candidates (GET·DELETE /candidates/{candidate_id}, POST /candidates/{candidate_id}/shortlist·/reject·/opt-out·/move-to-pipeline·/generate-outreach), extract-brief (POST /extract-brief), import/csv (POST /import/csv), sources (GET /sources, POST /sources/configure). All require auth (get_current_user) and are org-scoped via get_active_org_id; responses are plain dicts (no Pydantic response_model).
- **2026-06-24** — Added PATCH /api/team/{user_id} — update a team member's designation, user_type, and/or status (org-scoped). New UpdateMemberIn request schema.
- **2026-06-24** — Initial api.md generated — documented 54 endpoints across backend (FastAPI), interview-engine (Fastify), and dashboard (Next route handlers).

## Conventions

- **Backend — FastAPI** runs on **port `8000`**; all HTTP routes are mounted under the **`/api`** prefix (e.g. `/api/auth`, `/api/jobs`). Its WebSocket route (`/ws`) is mounted with **no prefix** (root).
- **Interview Engine — Fastify** runs on **port `4000`** (host `0.0.0.0`, `PORT` env override). Per-module prefixes: `companyRoutes → /api/company`, `interviewRoutes → /api/interview`, `transcriptRoutes → /api/interviews`, `assistantRoutes → /api/assistant`. The health check (`/health`) and the WebSocket gateway (`/ws`) are at the **root** (no `/api` prefix).
- **Dashboard — Next route handlers** run on **port `3000`**, under `dashboard/app/api/*` (e.g. `/api/parse-file`, `/api/fetch-doc`, `/api/deepseek`).
- **Auth model:** Backend authentication uses a **JWT in an httpOnly cookie** named `token`, valid for **7 days** (`max_age=604800s`). The token may also be supplied via an `Authorization: Bearer <jwt>` header. Super Admins additionally carry an `active_org_id` cookie that selects the active organisation context. Interview-engine and dashboard routes are largely public (no user auth); they rely on global rate limiting and/or server-side API keys.
- **WebSocket endpoints** are denoted with the pseudo-method **`WS`** and collected in the final **WebSocket Endpoints** section. All WS frames are JSON text.

---

## Backend — FastAPI (`/api/*`)

### `backend/app/routers/auth.py`

#### POST /api/auth/signup

Register a brand-new org_admin user, OR finalize an existing invited user's account. On success sets the JWT httpOnly `token` cookie (7-day) and logs the user in.

- **Auth:** public (none) — no `get_current_user` dependency
- **Path params:** none
- **Query params:** none

Request:
```json
{
  "name": "string (required)",
  "email": "string, EmailStr format (required)",
  "password": "string (required)"
}
```
Pydantic model `SignupIn`: name: str; email: EmailStr; password: str. All required, no defaults.

Response:
```json
{
  "user": {
    "id": "UUID",
    "name": "string",
    "email": "string",
    "user_type": "super_admin | org_admin | member",
    "status": "active | invited | inactive",
    "organisation_id": "UUID | null"
  },
  "onboarding_required": "boolean"
}
```
Plain dict (no response_model). `onboarding_required` = (organisation_id is None) AND (user_type != super_admin).

Status codes: 200 OK (default); 400 Bad Request — "User with this email already exists." (email already exists with status != invited); 422 Unprocessable Entity — Pydantic validation error.

Notes: Two branches — (1) existing user with status=invited → accepts invite (name/hashed_password updated, status→active); (2) no existing user → creates new User(user_type=org_admin, status=active, organisation_id=None). Sets cookie `token` (httponly, max_age=604800, samesite=COOKIE_SAMESITE default 'lax', secure=COOKIE_SECURE default false, path='/'). Password hashed with bcrypt.

#### POST /api/auth/login

Authenticate via email + password. On success sets JWT httpOnly `token` cookie (7-day); for super_admin also sets `active_org_id` cookie to the first organisation if one exists.

- **Auth:** public (none)
- **Path params:** none
- **Query params:** none

Request:
```json
{
  "email": "string, EmailStr format (required)",
  "password": "string (required)"
}
```
Pydantic model `LoginIn`: email: EmailStr; password: str. Both required, no defaults.

Response:
```json
{
  "user": {
    "id": "UUID",
    "name": "string",
    "email": "string",
    "user_type": "super_admin | org_admin | member",
    "status": "active | invited | inactive",
    "organisation_id": "UUID | null"
  },
  "onboarding_required": "boolean"
}
```
Plain dict (no response_model). `onboarding_required` = (organisation_id is None) AND (user_type != super_admin).

Status codes: 200 OK; 401 Unauthorized — "Incorrect email or password." (user not found OR no hashed_password OR password mismatch); 403 Forbidden — "Your account has been deactivated." (status == inactive); 422 Unprocessable Entity — Pydantic validation error.

Notes: Password verified with bcrypt.checkpw. Sets cookie `token` (httponly, max_age=604800, samesite=COOKIE_SAMESITE default 'lax', secure=COOKIE_SECURE default false, path='/'). If user_type == super_admin and ≥1 Organisation exists, additionally sets `active_org_id` cookie to str(first_org.id).

#### POST /api/auth/logout

Clear auth cookies (`token` and `active_org_id`).

- **Auth:** public (none); only manipulates response cookies
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
{
  "message": "Successfully logged out"
}
```

Status codes: 200 OK.

Notes: Deletes cookie `token` (path='/') and cookie `active_org_id` (path='/') via `response.delete_cookie`. No request body, no auth required.

#### POST /api/auth/onboarding

Create the current user's Organisation and associate the authenticated user with it (one-time org setup post-signup).

- **Auth:** JWT httpOnly cookie (required) — Depends(get_current_user). Token from `token` cookie or `Authorization: Bearer <jwt>` header.
- **Path params:** none
- **Query params:** none

Request:
```json
{
  "org_name": "string (required)",
  "domain": "string | null (optional, default null)",
  "contact_email": "string | null (optional, default null)",
  "website_link": "string | null (optional, default null)",
  "location": "string | null (optional, default null)",
  "description": "string | null (optional, default null)"
}
```
Pydantic model `OnboardingIn`: org_name: str (required); domain/contact_email/website_link/location/description: Optional[str]=None.

Response:
```json
{
  "user": {
    "id": "UUID",
    "name": "string",
    "email": "string",
    "user_type": "super_admin | org_admin | member",
    "status": "active | invited | inactive",
    "organisation_id": "UUID"
  },
  "organisation": {
    "id": "UUID",
    "org_name": "string",
    "domain": "string | null"
  }
}
```
Plain dict. `organisation_id` now populated with the new org's id.

Status codes: 200 OK; 400 Bad Request — "Organisation already set up." (current_user.organisation_id is not None); 401 Unauthorized — get_current_user failures ("Not authenticated" / "Invalid credentials token" / "Could not validate credentials" / "User not found"); 422 Unprocessable Entity — missing org_name.

Notes: Creates Organisation(org_name, domain, contact_email = data.contact_email or current_user.email, website_link, location, description), then sets current_user.organisation_id = org.id and commits. contact_email defaults to the user's email when not provided.

#### GET /api/auth/me

Return the authenticated user's profile, including resolved organisation name. For super_admin, organisation context resolves to the `active_org_id` cookie (or first org fallback).

- **Auth:** JWT httpOnly cookie (required) — Depends(get_current_user).
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
{
  "id": "UUID",
  "name": "string",
  "email": "string",
  "designation": "string | null",
  "user_type": "super_admin | org_admin | member",
  "status": "active | invited | inactive",
  "organisation_id": "UUID | null",
  "organisation_name": "string | null",
  "onboarding_required": "boolean"
}
```
response_model = `UserProfileOut` (Config.from_attributes=True). designation/organisation_id/organisation_name optional, default None.

Status codes: 200 OK; 401 Unauthorized — get_current_user failures.

Notes: For super_admin, org_id resolved via get_active_org_id (active_org_id cookie, fallback first Organisation). For non-super_admin with organisation_id set, organisation_name looked up from current_user.organisation_id. `onboarding_required` = (resolved org_id is None) AND (user_type != super_admin).

#### GET /api/auth/organisations

List all organisations in the database. Super Admin only.

- **Auth:** JWT httpOnly cookie (required); role gate: user_type must be super_admin (else 403).
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
[
  {
    "id": "UUID",
    "org_name": "string",
    "domain": "string | null",
    "contact_email": "string | null",
    "website_link": "string | null",
    "location": "string | null",
    "logo_url": "string | null",
    "description": "string | null",
    "created_at": "datetime | null",
    "updated_at": "datetime | null"
  }
]
```
No response_model — returns raw list of SQLAlchemy Organisation ORM objects (FastAPI serializes columns).

Status codes: 200 OK; 401 Unauthorized — get_current_user failures; 403 Forbidden — "Only Super Admins can list all organisations." (user_type != super_admin).

#### POST /api/auth/switch-context

Super Admin only: switch active organisation context by setting the `active_org_id` httpOnly cookie.

- **Auth:** JWT httpOnly cookie (required); role gate: user_type must be super_admin (else 403).
- **Path params:** none
- **Query params:** none

Request:
```json
{
  "organisation_id": "UUID (required)"
}
```
Pydantic model `SwitchContextIn`: organisation_id: UUID (required, no default).

Response:
```json
{
  "message": "Switched context to organisation: <org_name>",
  "organisation_id": "UUID",
  "organisation_name": "string"
}
```

Status codes: 200 OK; 401 Unauthorized — get_current_user failures; 403 Forbidden — "Only Super Admins can switch organisation context."; 404 Not Found — "Organisation not found."; 422 Unprocessable Entity — invalid/missing UUID.

Notes: On success sets cookie `active_org_id` = str(org.id) (httponly, max_age=604800, samesite/secure from env, path='/').

### `backend/app/routers/jobs.py`

#### GET /api/jobs

List jobs visible to the current user (org-scoped; members only see jobs they collaborate on), with aggregate status counts.

- **Auth:** JWT httpOnly cookie (required). Org scoping: super_admin → active_org_id; org_admin/member → own organisation_id; members further filtered to jobs they are a JobCollaborator on.
- **Path params:** none
- **Query params:** `status`:string (optional) — JobStatus filter ('published'|'draft'|'archived'); 'all' or omitted returns all. Only filters the returned `jobs` list, not the counts.

Request: none

Response:
```json
// JobListOut
{
  "jobs": [ /* JobOut[] */ {
    "id": "uuid",
    "custom_job_id": "string|null",
    "title": "string",
    "role_name": "string",
    "status": "published|draft|archived",
    "experience_band": "string|null",
    "description": "string|null",
    "is_job_listed": true,
    "created_at": "datetime",
    "created_by_name": "string|null",
    "resume_analysis_enabled": true,
    "recruiter_screening_enabled": true,
    "functional_interview_enabled": true,
    "pipeline": { "total": 0, "resume": 0, "screening": 0, "functional": 0 },
    "resume_parameters": {}|null,
    "screening_parameters": {}|null,
    "functional_parameters": {}|null,
    "screening_questions": ["string"]|null,
    "tags": ["string"]|null
  } ],
  "total": 0,
  "published": 0,
  "draft": 0,
  "archived": 0
}
```
JobPipelineCounts: total:int, resume:int|null, screening:int, functional:int. Counts exclude test/sentinel applicants and hired/rejected; stage bucket derived from functional_status/screening_status/decision.

Status codes: 200 OK; 401 not authenticated.

Notes: response_model=JobListOut. total/published/draft/archived computed over all visible jobs (pre-status-filter). tags stored as JSON string or comma list in DB and deserialized to array.

#### POST /api/jobs

Create a new job/blueprint; auto-adds the creator as a collaborator and seeds default screening questions if none provided.

- **Auth:** JWT httpOnly cookie (required). org_id = active_org_id for super_admin else current_user.organisation_id.
- **Path params:** none
- **Query params:** none

Request:
```json
// JobCreateIn
{
  "title": "string (required)",
  "role_name": "string (required)",
  "experience_band": "string|null (optional)",
  "custom_job_id": "string|null (optional)",
  "status": "published|draft|archived (optional, default 'draft')",
  "resume_analysis_enabled": "bool (optional, default true)",
  "recruiter_screening_enabled": "bool (optional, default true)",
  "functional_interview_enabled": "bool (optional, default true)",
  "description": "string|null (optional)",
  "resume_parameters": "dict|null (optional)",
  "screening_parameters": "dict|null (optional)",
  "functional_parameters": "dict|null (optional)",
  "screening_questions": "string[]|null (optional)"
}
```

Response:
```json
// JobOut (see GET /api/jobs jobs[] item shape)
{
  "id": "uuid", "custom_job_id": "string|null", "title": "string", "role_name": "string",
  "status": "published|draft|archived", "experience_band": "string|null", "description": "string|null",
  "is_job_listed": true, "created_at": "datetime", "created_by_name": "string|null",
  "resume_analysis_enabled": true, "recruiter_screening_enabled": true, "functional_interview_enabled": true,
  "pipeline": { "total": 0, "resume": 0, "screening": 0, "functional": 0 },
  "resume_parameters": {}|null, "screening_parameters": {}|null, "functional_parameters": {}|null,
  "screening_questions": ["string"]|null, "tags": ["string"]|null
}
```

Status codes: 200 OK; 400 'User does not belong to any organisation.'; 401 not authenticated; 422 body validation error.

Notes: response_model=JobOut. If screening_questions omitted, defaults to 4 canned questions. dict params are JSON-serialized into the Job text columns.

#### POST /api/jobs/upload-jd

Step 1 of Create Job: upload a PDF/DOCX job description file to the server.

- **Auth:** JWT httpOnly cookie (required).
- **Path params:** none
- **Query params:** none

Request: `multipart/form-data`
```
file: UploadFile (required) — must end with .pdf or .docx
```

Response:
```json
{ "file_path": "uploads/jd/<filename>", "filename": "<filename>" }
```

Status codes: 200 OK; 400 'Only .pdf and .docx files are supported'; 401 not authenticated; 422 missing file.

Notes: Plain dict response (no response_model). Saves to uploads/jd/.

#### POST /api/jobs/extract-jd

Parse an uploaded PDF/DOCX/TXT job description and extract structured job metadata via LLM (DeepSeek → Groq → Grok → Gemini), falling back to filename/heuristic extraction with no key.

- **Auth:** JWT httpOnly cookie (required).
- **Path params:** none
- **Query params:** none

Request: `multipart/form-data`
```
file: UploadFile (required) — must end with .pdf, .docx, or .txt
prompt: string (optional, Form field) — user refinement instructions
```

Response:
```json
{
  "role_name": "string",
  "card_name": "string",
  "experience_band": "string",
  "description": "string",
  "skills": "string (comma-separated)",
  "screening_questions": ["string"],
  "functional_questions": ["string"],
  "resume_parameters": { "must_have": ["string"], "red_flags": ["string"], "good_to_have": ["string"], "mustHave?": ["string"], "redFlags?": ["string"], "goodToHave?": ["string"] },
  "screening_parameters": { "experience": [ {"parameter":"string","preferred_response":"string","required":true} ], "academic?": [], "location": [], "compensation": [] },
  "functional_parameters": { "topics": [ {"name":"string","type":"Theoretical|Experiential","difficulty":"Medium|Hard","questions":["string"]} ] },
  "file_path": "uploads/jd/<filename>"
}
```

Status codes: 200 OK; 400 'Only .pdf, .docx, and .txt files are supported'; 401 not authenticated; 422 file empty/scanned/no readable text (<30 chars), or missing file.

Notes: Plain dict (no response_model); fixed key set but nested param sub-shapes vary by LLM output / heuristic domain (ml|pm|frontend|hr|general). Heuristic (no-key) path adds a 1.2s sleep and returns raw file_text as description. LLM keys from env: DEEPSEEK_API_KEY, GROQ_API_KEY, GROK_API_KEY/XAI_API_KEY, GEMINI_API_KEY.

#### GET /api/jobs/{job_id}

Get full detail for a single job (blueprint, parameters, questions, settings).

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access (org match; member must be collaborator).
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request: none

Response:
```json
// JobDetailOut
{
  "id": "uuid",
  "custom_job_id": "string|null",
  "title": "string",
  "role_name": "string",
  "status": "published|draft|archived",
  "description": "string|null",
  "location": "string|null",
  "job_type": "string|null",
  "experience_band": "string|null",
  "is_job_listed": true,
  "resume_analysis_enabled": true,
  "recruiter_screening_enabled": true,
  "functional_interview_enabled": true,
  "created_at": "datetime",
  "resume_parameters": {}|null,
  "screening_parameters": {}|null,
  "functional_parameters": {}|null,
  "screening_questions": ["string"]|null,
  "tags": ["string"]|null
}
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'.

Notes: response_model=JobDetailOut.

#### PATCH /api/jobs/{job_id}/settings

Update job settings/metadata (title, role, toggles, status, tags, questions, etc.). Partial update (exclude_unset).

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request:
```json
// JobSettingsIn — all optional, only provided keys applied
{
  "resume_analysis_enabled": "bool|null",
  "recruiter_screening_enabled": "bool|null",
  "functional_interview_enabled": "bool|null",
  "is_job_listed": "bool|null",
  "title": "string|null",
  "role_name": "string|null",
  "experience_band": "string|null",
  "description": "string|null",
  "custom_job_id": "string|null",
  "tags": "string[]|null",
  "status": "published|draft|archived|null",
  "screening_questions": "string[]|null",
  "job_type": "string|null",
  "location": "string|null"
}
```

Response:
```json
// JobDetailOut (same as GET /api/jobs/{job_id})
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'; 422 body validation error.

Notes: response_model=JobDetailOut. tags and screening_questions are JSON-serialized to DB columns; other keys set directly.

#### DELETE /api/jobs/{job_id}

Delete a job and cascade-delete its applicants and collaborator rows.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request: none

Response:
```json
{ "message": "Job <job_id> successfully deleted" }
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'.

Notes: Plain dict response. Bulk-deletes Applicant and JobCollaborator rows for the job before deleting the Job.

#### PATCH /api/jobs/{job_id}/parameters

Update the job's resume/screening/functional parameters and screening questions (Blueprint Studio).

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request:
```json
// JobParametersIn — only non-null keys applied
{
  "resume_parameters": "dict|null",
  "screening_parameters": "dict|null",
  "functional_parameters": "dict|null",
  "screening_questions": "string[]|null"
}
```

Response:
```json
// JobDetailOut (same as GET /api/jobs/{job_id})
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'; 422 body validation error.

Notes: response_model=JobDetailOut. Each provided field is JSON-serialized into its Job text column.

#### POST /api/jobs/{job_id}/test-session

Create/reset a throwaway functional interview session from this job's blueprint so the recruiter can run it end-to-end (excluded from funnel/analytics).

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request: none

Response:
```json
{ "session_id": "<applicant_uuid as string>" }
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'; 500 "Could not create a test interview from this job's blueprint. Make sure the job has functional questions authored.".

Notes: Plain dict response. Reuses one tagged Test Candidate applicant (remarks='__ih_test_session__') per job; sets functional_status=scheduled, functional_scheduled_at=now-1min, calls sync_applicant_to_ai. session_id equals the applicant id.

#### GET /api/jobs/{job_id}/responses

Get candidates for a job filtered by pipeline tab; overview returns a funnel + score distribution. Reconciles completed AI interview sessions first.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** `tab`:string (optional, default 'overview') — 'overview'|'resume'|'screening'|'functional'. overview returns funnel; resume returns all applicants; screening returns those with screening_status; functional returns those with functional_status.

Request: none

Response: No response_model (shape depends on tab).

For `tab='overview'` (FunnelOut shape):
```json
{
  "stages": [ {"label":"Total Candidates","count":0,"conversion":null}, {"label":"Resume Analysis","count":0,"conversion":0}, {"label":"Recruiter Screening","count":0,"conversion":0}, {"label":"Functional Interview","count":0,"conversion":0}, {"label":"Completed","count":0,"conversion":0}, {"label":"Qualified","count":0,"conversion":0} ],
  "score_distribution": { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 }
}
```
For `tab` in resume|screening|functional (and any other value): array of serialized Applicant ORM objects (ApplicantOut-like fields).

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'.

Notes: Excludes test/sentinel applicants. _reconcile_functional_from_sessions may mutate applicants (mark completed, copy score/report_url) before building the response. Non-overview tabs serialize raw ORM Applicants, not strictly ApplicantOut.

#### POST /api/jobs/{job_id}/collaborators

Add a user as a collaborator on the job.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request:
```json
// CollaboratorIn
{ "user_id": "uuid (required)" }
```

Response:
```json
{ "message": "Collaborator added" }
// or, if already present:
{ "message": "Collaborator already added" }
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found' / 'User not found'; 422 body validation error.

Notes: Plain dict response.

#### DELETE /api/jobs/{job_id}/collaborators/{user_id}

Remove a collaborator from the job.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id; `user_id`:UUID — the collaborator user id
- **Query params:** none

Request: none

Response:
```json
{ "message": "Collaborator removed" }
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found' / 'Collaborator not found'.

Notes: Plain dict response.

#### POST /api/jobs/{job_id}/applicants

Add a single applicant/candidate to a job; sets stage status based on source; broadcasts a WebSocket update.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request:
```json
// AddApplicantIn
{
  "name": "string (required)",
  "email": "EmailStr (required)",
  "phone": "string|null (optional)",
  "source": "career_page|bulk_upload|direct_link|scheduled|ats|functional|null (optional)",
  "entry_method": "string|null (optional, default null) — input method: how the candidate was added (bulk_upload|ats|direct_link|career_page); plain string, independent of source",
  "recruiter_screening": "string|null (optional)",
  "recruiter_screening_score": "float|null (optional)",
  "attempted_at": "datetime|null (optional)"
}
```

Response:
```json
// ApplicantOut
{
  "id": "uuid", "name": "string", "email": "string", "phone": "string|null",
  "source": "ApplicantSource|null", "entry_method": "string|null", "remarks": "string|null",
  "match_score": "float|null", "resume_analysis_report": "string|null", "resume_text": "string|null",
  "resume_analysed": "bool|null", "resume_shortlisted": "bool|null", "decision": "string|null",
  "screening_status": "InterviewStatus|null", "screening_score": "float|null",
  "functional_status": "InterviewStatus|null", "functional_score": "float|null",
  "cheat_probability": "low|medium|high|null", "report_url": "string|null",
  "recruiter_screening": "string|null", "recruiter_screening_score": "float|null",
  "attempted_at": "datetime|null", "screening_scheduled_at": "datetime|null", "functional_scheduled_at": "datetime|null",
  "overall_interview_score": "float|null", "proctoring_severity_flag": "string|null",
  "calendar_sequence": 0, "scheduling_token": "string|null", "calendar_event_id": "string|null"
}
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'; 422 body validation error.

Notes: response_model=ApplicantOut. source='scheduled' → screening_status=pending; source='functional' → functional_status=pending. Broadcasts OutgoingMessage type 'candidate_update' to room 'global'.

#### POST /api/jobs/{job_id}/applicants/bulk

Add multiple applicants to a job in one call; broadcasts a WebSocket update.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** none

Request:
```json
// BulkApplicantsIn — applicants[] items are AddApplicantIn (inherits entry_method)
{
  "applicants": [
    { "name": "string", "email": "EmailStr", "phone": "string|null", "source": "ApplicantSource|null", "entry_method": "string|null (optional) — input method (bulk_upload|ats|direct_link|career_page); independent of source", "recruiter_screening": "string|null", "recruiter_screening_score": "float|null", "attempted_at": "datetime|null" }
  ]
}
```

Response:
```json
// List[ApplicantOut] — array of ApplicantOut objects (see POST /applicants)
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'; 422 body validation error.

Notes: response_model=List[ApplicantOut]. Per-applicant source→status mapping same as single add.

#### POST /api/jobs/{job_id}/applicants/upload-resumes

Upload one or more resume files (PDF/DOCX/TXT or ZIP archives); parses each with DeepSeek, dedupes against existing candidates by email/name, creates or updates applicants, persists raw resume text.

- **Auth:** JWT httpOnly cookie (required) + _verify_job_access.
- **Path params:** `job_id`:UUID — the job id
- **Query params:** `source`:ApplicantSource (optional) — career_page|bulk_upload|direct_link|scheduled|ats|functional; defaults to bulk_upload for new applicants.

Request: `multipart/form-data`
```
files: UploadFile[] (required) — .pdf/.docx/.txt files and/or .zip archives (zips extracted, non-doc entries skipped)
```

Response:
```json
// List[ApplicantOut] — created or updated applicants (see POST /applicants for shape)
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Job not found'; 422 missing files.

Notes: response_model=List[ApplicantOut]. Saves to uploads/resumes/. DEEPSEEK_API_KEY read from env for parse_resume_with_deepseek. Dedup: matches existing applicant by lowercase email (ignores @candidate.io dummies) then by lowercase name (ignores 'Candidate'). Newly-created applicants are assigned `entry_method="bulk_upload"` (existing matched applicants are left unchanged). New applicants get email fallback candidate.<hex>@candidate.io, phone '+1 555-0199', resume_analysed=False. Broadcasts WebSocket update.

#### PATCH /api/jobs/applicants/{applicant_id}

Update an applicant (stage statuses, scores, decision, resume analysis fields, scheduling, etc.). Advancing a stage regenerates a scheduling token and syncs a fresh AI interview session.

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access (resolves job and runs _verify_job_access).
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request:
```json
// ApplicantUpdateIn — all optional, only provided keys applied (exclude_unset)
{
  "screening_status": "pending|scheduled|completed|slot_missed|incomplete|null",
  "screening_score": "float|null",
  "functional_status": "pending|scheduled|completed|slot_missed|incomplete|null",
  "functional_score": "float|null",
  "cheat_probability": "low|medium|high|null",
  "resume_analysed": "bool|null",
  "resume_shortlisted": "bool|null",
  "resume_waitlisted": "bool|null",
  "recruiter_screening": "string|null",
  "recruiter_screening_score": "float|null",
  "attempted_at": "datetime|null",
  "remarks": "string|null",
  "match_score": "float|null",
  "resume_analysis_report": "string|null",
  "resume_text": "string|null",
  "decision": "'shortlisted'|'on_hold'|'rejected'|'hired'|null",
  "screening_scheduled_at": "datetime|null",
  "functional_scheduled_at": "datetime|null",
  "overall_interview_score": "float|null",
  "proctoring_severity_flag": "string|null",
  "calendar_sequence": "int|null",
  "scheduling_token": "string|null",
  "calendar_event_id": "string|null"
}
```

Response:
```json
// ApplicantOut (see POST /applicants for full shape)
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'; 422 body validation error.

Notes: response_model=ApplicantOut. If screening_status or functional_status provided and truthy: regenerates scheduling_token (uuid4) and calls sync_applicant_to_ai. Broadcasts WebSocket update.

#### POST /api/jobs/applicants/{applicant_id}/schedule

Schedule a screening or functional interview for a candidate: sets scheduled time/status, creates/updates a Google Calendar event, emails an iCal invite + interview link, and syncs the AI session.

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access.
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request: raw JSON object (Body as `dict`, no Pydantic model)
```json
{
  "stage": "screening|functional (optional, default 'functional')",
  "scheduled_at": "ISO datetime string (required) — e.g. 2026-06-24T10:00:00Z"
}
```

Response:
```json
// ApplicantOut (see POST /applicants for full shape)
```

Status codes: 200 OK; 400 'scheduled_at is required' / 'Invalid scheduled_at format'; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'.

Notes: response_model=ApplicantOut. Untyped dict body. stage!='screening' treated as functional. Always regenerates scheduling_token. Calendar/email/AI-sync failures are caught and logged (non-fatal), so a 200 may still be returned even if email or calendar failed. interview_link = INTERVIEW_ROOM_URL/interview?sessionId=<applicant_id>.

#### DELETE /api/jobs/applicants/{applicant_id}

Delete an applicant from a job; broadcasts a WebSocket removal update.

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access.
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request: none

Response:
```json
{ "message": "Applicant successfully deleted" }
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'.

Notes: Plain dict response.

#### GET /api/jobs/applicants/{applicant_id}/resume-text

Get the candidate's resume text (prefers persisted resume_text, else extracts from resume_url file).

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access.
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request: none

Response:
```json
{ "text": "string" }
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'.

Notes: Plain dict response. Returns `{"text": ""}` when no persisted text and resume_url missing/nonexistent on disk.

#### GET /api/jobs/applicants/{applicant_id}/screening-report

Get the recruiter-screening report for an applicant (delegates to ai_sync.get_applicant_screening_report).

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access.
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request: none

Response (from `ai_sync.get_applicant_screening_report`, no response_model — always returns a dict):
```json
{
  "candidateName": "string",
  "email": "string",
  "phone": "string (applicant.phone or \"—\")",
  "jobTitle": "string (job.role_name or job.title or \"N/A\")",
  "score": "float (applicant.screening_score or 80.0)",
  "status": "string (applicant.screening_status.value or \"completed\")",
  "fitLevel": "string (applicant.recruiter_screening, or \"Good fit\" | \"Moderate fit\" | \"Poor fit\")",
  "summary": "string (constructed narrative)",
  "checklist": [
    {
      "category": "string (title case)",
      "parameter": "string",
      "preferred": "string",
      "required": "boolean",
      "met": "boolean",
      "reason": "string"
    }
  ],
  "dialogue": [
    { "speaker": "Recruiter | Candidate", "text": "string" }
  ],
  "attemptedAt": "string (ISO 8601) | null"
}
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'.

Notes: No response_model; always returns a dict (constructs placeholder data if fields missing). See `app/utils/ai_sync.py:get_applicant_screening_report`.

#### GET /api/jobs/applicants/{applicant_id}/functional-vetting

Get functional vetting data for an applicant (delegates to ai_sync.get_applicant_vetting).

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access.
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request: none

Response (from `ai_sync.get_applicant_vetting`, no response_model — always returns a dict; mock/default shape if no interview session):
```json
{
  "summary": "string (status narrative, varies by session.status)",
  "caveats": [
    { "type": "info | warning | success", "text": "string" }
  ],
  "pros": ["string"],
  "cons": ["string"],
  "rubrics": [
    { "label": "string (e.g. \"Technical Fit\", \"Communication\")", "score": "float (0–10, dimensionScore/10)" }
  ],
  "transcript": [
    { "speaker": "AI Interviewer | Candidate | <generic>", "text": "string" }
  ],
  "reportUrl": "string | null"
}
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'.

Notes: No response_model; delegates with str(applicant_id). `pros`/`cons` come from `session.evaluation.strengths`/`.weaknesses`. See `app/utils/ai_sync.py:get_applicant_vetting`.

#### GET /api/jobs/applicants/{applicant_id}/functional-report

Get the full canonical CandidateReport (raw InterviewSession.evaluation) for Deep Analysis (delegates to ai_sync.get_applicant_full_report).

- **Auth:** JWT httpOnly cookie (required) + _verify_applicant_access.
- **Path params:** `applicant_id`:UUID — the applicant id
- **Query params:** none

Request: none

Response (from `ai_sync.get_applicant_full_report`, no response_model — always returns a dict, never raises):
```json
{
  "status": "string (session.status.value or \"not_scheduled\")",
  "evaluated": "boolean (true if session.evaluation exists)",
  "report": "object (raw session.evaluation — canonical CandidateReport from the engine) | null",
  "reportUrl": "string | null"
}
```

Status codes: 200 OK; 401 not authenticated; 403 'Access denied'; 404 'Applicant not found' / 'Job not found'.

Notes: No response_model; delegates with str(applicant_id). `report` is `null` until the engine scores the interview (`evaluated=false`). The `report` payload is the canonical `CandidateReport` defined by the dashboard. See `app/utils/ai_sync.py:get_applicant_full_report`.

#### POST /api/jobs/webhooks/interview-completed

Webhook (called by the interview engine) marking an interview complete: copies evaluation score, derives proctoring/cheat flags from ProctoringLog, sets functional_status=completed, writes/updates InterviewReport, broadcasts a WebSocket update.

- **Auth:** NO user cookie. Shared-secret header `X-Webhook-Secret` must equal settings.WEBHOOK_SECRET (fallback 'super-secret-webhook-key').
- **Path params:** none
- **Query params:** none

Request: Header `X-Webhook-Secret`: string (required). Body (raw JSON object, Body as `dict`):
```json
{ "sessionId": "uuid string (required) — equals the applicant id" }
```

Response:
```json
{ "status": "synced", "applicant_id": "<applicant_uuid as string>" }
```

Status codes: 200 OK; 400 'sessionId is required' / 'Invalid UUID format for sessionId'; 401 'Invalid webhook secret'; 404 'Applicant not found' / 'Interview session not found'; 422 missing X-Webhook-Secret header / missing body.

Notes: Plain dict response. No get_current_user dependency. proctoring_severity_flag derived from ProctoringLog.severity (critical/high/medium/low); cheat_probability mapped from flag (critical|high→high, medium→medium, else low). overall_interview_score=functional_score=evaluation.overallScore. report_url=session.reportUrl. Upserts InterviewReport(summary, transcript, video_url, detailed_scores).

### `backend/app/routers/team.py`

#### GET /api/team

List all team members (users) in the caller's active organisation, with status rollup counts (total / active / invited / inactive).

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required via get_current_user. No explicit role gate. Org scoping: super_admin → get_active_org_id (active_org_id cookie, falling back to first org in DB); others → own organisation_id. If no org resolvable, returns an empty list with zero counts (200).
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
// TeamListOut (200)
{
  "members": [
    {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "designation": "string | null",
      "user_type": "super_admin | org_admin | member",
      "status": "active | invited | inactive",
      "registered_on": "datetime ISO8601 | null"
    }
  ],
  "total": 0,
  "active": 0,
  "invited": 0,
  "inactive": 0
}
```

Status codes: 200 OK (list, possibly empty if no active org); 401 Not authenticated.

Notes: members built from all User rows where organisation_id == resolved org_id (serialized via UserOut, from_attributes=True). Counts computed server-side. UserOut omits hashed_password, organisation_id, google_* tokens, created_at. Route decorator is `@router.get("")` so full path is exactly `/api/team` (no trailing slash).

#### POST /api/team/invite

Invite (create) a new user into the caller's active organisation with status=invited and no password set.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. No explicit role gate (any authenticated user may invite). Org resolution: super_admin → get_active_org_id; others → own organisation_id. 400 if no org resolvable.
- **Path params:** none
- **Query params:** none

Request:
```json
// InviteMemberIn
{
  "name": "string (required)",
  "email": "string, EmailStr (required, validated email)",
  "designation": "string | null (optional, default null)",
  "user_type": "super_admin | org_admin | member (optional, default 'member')"
}
```

Response:
```json
// UserOut (200)
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "designation": "string | null",
  "user_type": "super_admin | org_admin | member",
  "status": "invited",
  "registered_on": "datetime ISO8601 | null"
}
```

Status codes: 200 OK (created user returned); 400 'Cannot invite users without an active organisation.' (no org_id); 400 'User with this email already exists' (email already present globally, not just within the org); 401 Not authenticated; 422 Unprocessable Entity (Pydantic validation).

Notes: New user created with status=invited and organisation_id=resolved org_id; hashed_password left null until invite acceptance. Email uniqueness checked against the entire users table, not scoped to org. user_type defaults to 'member' if omitted. Response status code is 200 (default), not 201.

#### DELETE /api/team/{user_id}

Remove (hard delete) a team member from the caller's active organisation.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. No explicit role gate. Org resolution: super_admin → get_active_org_id; others → own organisation_id. 400 if no org resolvable. Target user must belong to the same resolved org.
- **Path params:** `user_id`:UUID — id of the user to remove (invalid format → 422)
- **Query params:** none

Request: none

Response:
```json
// 200 (no response_model declared; plain dict)
{
  "message": "Member removed"
}
```

Status codes: 200 OK; 400 'Action not allowed' (no resolvable org_id); 404 'User not found in your organisation'; 401 Not authenticated; 422 invalid user_id UUID.

Notes: Hard delete (db.delete(user)). Lookup scoped: User.id == user_id AND organisation_id == org_id, so members of other organisations report 404. No self-deletion guard and no last-admin guard.

#### PATCH /api/team/{user_id}

Update a team member's designation, user_type, and/or status within the caller's active organisation. Partial update (only provided fields applied).

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required via get_current_user + get_active_org_id. No explicit role gate. Org resolution: super_admin → active_org_id; others → own organisation_id. 400 if no org resolvable. Target user must belong to the same resolved org.
- **Path params:** `user_id`:UUID — id of the user to update (invalid format → 422)
- **Query params:** none

Request:
```json
// UpdateMemberIn — all optional, only provided fields applied (exclude_unset)
{
  "designation": "string | null (optional, default null)",
  "user_type": "super_admin | org_admin | member (optional, default null)",
  "status": "active | invited | inactive (optional, default null)"
}
```

Response:
```json
// UserOut (200)
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "designation": "string | null",
  "user_type": "super_admin | org_admin | member",
  "status": "active | invited | inactive",
  "registered_on": "datetime ISO8601 | null"
}
```

Status codes: 200 OK (updated user returned); 400 'Action not allowed' (no resolvable org_id); 404 'User not found in your organisation'; 401 Not authenticated; 422 invalid user_id UUID / body validation error.

Notes: Lookup scoped to User.id == user_id AND organisation_id == org_id, so members of other organisations report 404. Only fields present in the request body (model_dump(exclude_unset=True)) are applied to the user. user_type and status are validated against the UserType / UserStatus enums.

### `backend/app/routers/organisation.py`

#### GET /api/organisation

Fetch the active organisation's settings/profile.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. super_admin resolves org from active_org_id cookie (fallback first org); others use own organisation_id.
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
// OrganisationOut (from_attributes=True)
{
  "id": "uuid",
  "org_name": "string",
  "domain": "string | null",
  "contact_email": "string | null",
  "website_link": "string | null",
  "location": "string | null",
  "logo_url": "string | null",
  "description": "string | null"
}
```

Status codes: 200 OK; 401 (from get_current_user); 404 'No active organisation context.' (no resolvable org_id); 404 'Organisation settings not set up yet' (org row not found); 422 validation error.

Notes: org_id = active_org_id if super_admin else current_user.organisation_id. OrganisationOut omits created_at and updated_at even though the model has them.

#### PUT /api/organisation

Create or update (upsert) the active organisation's settings.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. super_admin context via get_active_org_id; others use organisation_id.
- **Path params:** none
- **Query params:** none

Request:
```json
// OrganisationIn (JSON body)
{
  "org_name": "string",
  "domain": "string | null (optional, default null)",
  "contact_email": "string | null (optional, default null)",
  "website_link": "string | null (optional, default null)",
  "location": "string | null (optional, default null)",
  "description": "string | null (optional, default null)"
}
```

Response:
```json
// OrganisationOut
{
  "id": "uuid",
  "org_name": "string",
  "domain": "string | null",
  "contact_email": "string | null",
  "website_link": "string | null",
  "location": "string | null",
  "logo_url": "string | null",
  "description": "string | null"
}
```

Status codes: 200 OK; 401 (from get_current_user); 422 validation error (e.g. missing org_name).

Notes: Three-branch upsert — (1) no resolvable org_id → create new Organisation from model_dump(), set current_user.organisation_id (onboarding); (2) org_id resolves + row exists → partial update via model_dump(exclude_unset=True); (3) org_id resolves but no row → create with id=org_id and full model_dump() (exclude_unset NOT applied, so unset optionals written as None). Success is 200.

#### POST /api/organisation

Create or update (upsert) the active organisation's settings — alias of the PUT handler.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. Same org resolution as PUT.
- **Path params:** none
- **Query params:** none

Request:
```json
// OrganisationIn (JSON body)
{
  "org_name": "string",
  "domain": "string | null (optional, default null)",
  "contact_email": "string | null (optional, default null)",
  "website_link": "string | null (optional, default null)",
  "location": "string | null (optional, default null)",
  "description": "string | null (optional, default null)"
}
```

Response:
```json
// OrganisationOut
{
  "id": "uuid",
  "org_name": "string",
  "domain": "string | null",
  "contact_email": "string | null",
  "website_link": "string | null",
  "location": "string | null",
  "logo_url": "string | null",
  "description": "string | null"
}
```

Status codes: 200 OK; 401 (from get_current_user); 422 validation error.

Notes: upsert_organisation_post directly delegates to upsert_organisation, so behavior is identical to PUT /api/organisation. Provided for clients that POST instead of PUT.

#### POST /api/organisation/logo

Upload an organisation logo image; saves it to the server's uploads/logos dir and stores the path on the organisation.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. super_admin context via get_active_org_id; others use organisation_id.
- **Path params:** none
- **Query params:** none

Request: `multipart/form-data`
```
file: binary (required)   # UploadFile = File(...)
```

Response:
```json
{
  "logo_url": "string"   // server file path, e.g. "uploads/logos/<original_filename>"
}
```

Status codes: 200 OK; 401 (from get_current_user); 400 'No active organisation context.' (no resolvable org_id); 422 validation error (missing file).

Notes: Plain dict (no response_model). File written to UPLOAD_DIR='uploads/logos' as `{UPLOAD_DIR}/{file.filename}` via shutil.copyfileobj — original client filename used verbatim (no sanitization/uniqueness; same-named uploads overwrite). If org row exists, org.logo_url set and committed; if not, file saved + path returned but nothing persisted (silent no-op). Returned logo_url is a local relative server path, not a public URL.

### `backend/app/routers/usage.py`

#### GET /api/usage/stats

Aggregate usage statistics across all jobs visible to the current user (org-scoped; members restricted to jobs they collaborate on), counting applicants by source and per-stage outcome. Optionally filtered by applicant created_at date range.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. No admin/super_admin gate. Visibility: super_admin → active_org_id (cookie/first-org fallback); non-super_admin → organisation_id; members further restricted to JobCollaborator jobs.
- **Path params:** none
- **Query params:** `date_from`:datetime (optional, default None) — lower bound on Applicant.created_at (>=); ISO 8601. `date_to`:datetime (optional, default None) — upper bound (<=); ISO 8601.

Request: none

Response:
```json
// UsageStatsOut — all fields are required integers
{
  "total_applicants": 0,
  "career_page": 0,
  "bulk_upload": 0,
  "scheduled": 0,
  "direct_link": 0,
  "resume_analysed": 0,
  "resume_shortlisted": 0,
  "resume_waitlisted": 0,
  "screening_attempted": 0,
  "screening_scheduled": 0,
  "screening_shortlisted": 0,
  "screening_waitlisted": 0,
  "functional_attempted": 0,
  "functional_scheduled": 0,
  "functional_shortlisted": 0,
  "functional_waitlisted": 0
}
```

Status codes: 200 OK (all-zero when no visible jobs / no resolvable org); 401 Unauthorized; 422 Unprocessable Entity (un-parseable date value).

Notes: ApplicantSource values are career_page, bulk_upload, direct_link, scheduled, ats, functional — 'ats'/'functional' sources are NOT reflected in any source count field. screening/functional_scheduled compare the .value of InterviewStatus (pending, scheduled, completed, slot_missed, incomplete). Shortlisted counts use hardcoded >= 60 threshold. waitlisted counts are always 0. Date filtering uses Applicant.created_at.

#### GET /api/usage/jobs-table

Flat list of jobs (one row per job) for the usage/reporting jobs table, scoped to the current user's organisation and, for members, to collaborated jobs. Returns a plain JSON array of dicts (NOT the JobTableRow Pydantic model).

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. No gate. Org scoping: super_admin → active_org_id (cookie/first-org fallback); others → organisation_id; members filtered to JobCollaborator rows.
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
// Array of plain dicts (NOT response_model-validated). Empty array [] if no resolvable org.
[
  {
    "id": "string",
    "custom_job_id": "string|null",
    "role_name": "string",
    "title": "string",
    "experience_band": "string|null",
    "tags": "string|null",
    "created_by_name": "string|null"
  }
]
```

Status codes: 200 OK (returns [] when org cannot be resolved); 401 Unauthorized.

Notes: No response_model, so returned shape is the hand-built dict above (not JobTableRow). 'tags' returned as the raw model column value (string). created_by_name read from job.created_by relationship's .name.

#### GET /api/usage/candidates-table

Flat list of all candidates (applicants) across the user's visible jobs. As a side effect it lazily re-syncs each applicant's functional stage from the matching InterviewSession (status, functional_score, report_url, cheat_probability, attempted_at) and commits changes before returning.

- **Auth:** JWT httpOnly cookie `token` (or Bearer) required. No gate. Visibility identical to /stats.
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
// Array of plain dicts (no response_model). Empty array [] if no visible jobs.
[
  {
    "id": "string",
    "name": "string",
    "email": "string",
    "phone": "string|null",
    "source": "ApplicantSource|null",
    "job_id": "string",
    "screening_status": "InterviewStatus|null",
    "screening_score": 0.0,
    "functional_status": "InterviewStatus|null",
    "functional_score": 0.0,
    "cheat_probability": "CheatProbability|null",
    "recruiter_screening": "string|null",
    "recruiter_screening_score": 0.0,
    "attempted_at": "string|null",
    "created_at": "string|null",
    "resume_url": "string|null",
    "resume_analysed": false,
    "match_score": 0.0,
    "resume_analysis_report": "string|null"
  }
]
```

Status codes: 200 OK (returns [] when no visible jobs); 401 Unauthorized; 500 if the side-effect db.commit() fails.

Notes: Side effects (writes to DB): for each applicant whose id matches an InterviewSession.id, may update functional_status (EVALUATED→completed, IN_PROGRESS→scheduled), functional_score (session.evaluation['overallScore']), report_url, cheat_probability (high if any CRITICAL/HIGH ProctoringLog severity, medium if any MEDIUM, else low), attempted_at (session.completedAt or updatedAt). A single db.commit() runs if any applicants exist. Enum fields emitted as raw .value strings.

### `backend/app/routers/settings.py`

#### PUT /api/settings/password

Change the authenticated user's password. Requires the current password, verifies against stored bcrypt hash, then sets a new bcrypt hash.

- **Auth:** JWT httpOnly cookie (required). No role gate — operates only on the authenticated caller.
- **Path params:** none
- **Query params:** none

Request:
```json
{
  "current_password": "string (required)",
  "new_password": "string (required)"
}
```
Pydantic model `ChangePasswordIn`: current_password: str; new_password: str.

Response:
```json
{
  "message": "Password updated successfully"
}
```
Plain dict (default 200, application/json). No response_model.

Status codes: 200 OK; 400 Bad Request — "No password is set for this account; use account recovery instead." (hashed_password falsy) OR "Current password is incorrect"; 404 Not Found — "User not found"; 401 Unauthorized — missing/invalid JWT cookie; 422 Unprocessable Entity — body validation failure.

Notes: Loads user fresh via db.query(User).filter(User.id == current_user.id).first(). Rejects accounts with no existing password hash. On success sets hashed_password = get_password_hash(new_password). No minimum-length/strength validation beyond non-null string.

#### POST /api/settings/password

Alias for PUT /api/settings/password. Delegates directly to change_password(...), so behavior is identical.

- **Auth:** JWT httpOnly cookie (required). No role gate.
- **Path params:** none
- **Query params:** none

Request:
```json
{
  "current_password": "string (required)",
  "new_password": "string (required)"
}
```
Pydantic model `ChangePasswordIn`.

Response:
```json
{
  "message": "Password updated successfully"
}
```
No response_model; default 200 application/json.

Status codes: 200 OK; 400 "No password is set for this account; use account recovery instead." OR "Current password is incorrect"; 404 "User not found"; 401 missing/invalid JWT cookie; 422 body validation failure.

Notes: Implementation is `return change_password(data, current_user, db)` — fully identical semantics to the PUT route.

### `backend/app/routers/deepseek.py`

#### POST /api/deepseek

LLM chat-completion proxy. Forwards OpenAI-style chat messages to a cascade of providers (DeepSeek → Groq → Grok/xAI → Gemini), returning the first successful response. Each provider tried only if its API key is configured.

- **Auth:** none (no get_current_user dependency; route is public). Server-side use of provider API keys from settings/env.
- **Path params:** none
- **Query params:** none

Request:
```python
class DeepSeekRequest(BaseModel):
    messages: List[Dict[str, Any]]   # required. OpenAI-style chat messages
    jsonMode: Optional[bool] = False # optional, default False
```
When jsonMode true, requests JSON-object output mode (DeepSeek/Groq/Grok: response_format={"type":"json_object"}; Gemini: generationConfig.responseMimeType="application/json").

Response: shape depends on which provider succeeded. Body is passed through verbatim except for Gemini.
```
# DeepSeek (deepseek-chat) / Groq (llama-3.1-8b-instant) / Grok (grok-beta):
#   Returns raw upstream OpenAI-compatible JSON verbatim, e.g.:
{
  "id": "...",
  "object": "chat.completion",
  "created": 0,
  "model": "deepseek-chat",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}

# Gemini (gemini-1.5-flash) fallback: reshaped by the backend into:
{
  "choices": [
    { "message": { "role": "assistant", "content": "<text>" } }
  ]
}
```

Status codes: 200 OK (first successful upstream provider, or reshaped Gemini); 422 Unprocessable Entity (body fails DeepSeekRequest validation); 500 Internal Server Error ("No LLM API key configured (DeepSeek, Groq, Grok, Gemini), or all attempts failed.").

Notes: Upstream calls — DeepSeek https://api.deepseek.com/v1/chat/completions (deepseek-chat, temp 0.7, max_tokens 3000, 40s); Groq https://api.groq.com/openai/v1/chat/completions (llama-3.1-8b-instant, 30s); Grok/xAI https://api.xai.com/v1/chat/completions (grok-beta, 30s); Gemini https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent (30s; messages flattened to 'ROLE: content' joined by blank lines; unwrapped from candidates[0].content.parts[0].text). Keys: DEEPSEEK_API_KEY, GROQ_API_KEY, GROK_API_KEY/XAI_API_KEY, GEMINI_API_KEY. Providers tried strictly in order; skipped if key falsy, falls through on exception. No streaming. Route decorator path is "" → full path exactly /api/deepseek (no trailing slash).

### `backend/app/routers/public.py`

#### GET /api/public/oauth/connect

Begin Google OAuth flow to connect a recruiter's Google Calendar. Builds an authorization URL (calendar scope, offline access, consent prompt) carrying user_id in OAuth state, then 302-redirects to Google's consent screen.

- **Auth:** public (no cookie/JWT). User identity via the user_id query param.
- **Path params:** none
- **Query params:** `user_id`:str (required) — the recruiter User UUID; echoed back as the OAuth `state` param.

Request: none

Response:
```
302 Redirect (RedirectResponse)
Location: https://accounts.google.com/o/oauth2/auth?...&state=<user_id>&access_type=offline&prompt=consent
No JSON body.
```

Status codes: 302 redirect (success); 400 "Google OAuth client credentials are not configured globally." (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET); 422 if user_id absent.

Notes: Scopes: ["https://www.googleapis.com/auth/calendar"]. redirect_uri = settings.GOOGLE_REDIRECT_URI. Uses Flow.from_client_config. No DB access.

#### GET /api/public/oauth2callback

Google OAuth redirect handler. Exchanges the authorization code for tokens, looks up the User by the UUID in `state`, persists the Google refresh token + client credentials onto that User, returns a styled HTML success page.

- **Auth:** public (no cookie/JWT). Trust via Google-issued code; user identified by UUID in `state`.
- **Path params:** none
- **Query params:** `code`:str (required) — Google OAuth authorization code. `state`:str (required) — the user_id (User UUID) round-tripped from /oauth/connect.

Request: none

Response:
```html
200 OK, Content-Type: text/html (HTMLResponse)
<html>...<h1>Google Calendar Connected!</h1>... "Your calendar has been successfully connected to IntervieHire." ...</html>
```

Status codes: 200 HTML success page; 400 "Google OAuth client credentials are not configured globally."; 400 "Invalid user ID in state." (state not a valid UUID); 404 "User not found"; 422 if code or state missing.

Notes: Side effects (committed): user.google_refresh_token = credentials.refresh_token; user.google_client_id = settings.GOOGLE_CLIENT_ID; user.google_client_secret = settings.GOOGLE_CLIENT_SECRET. Scopes: ["https://www.googleapis.com/auth/calendar"]. redirect_uri = settings.GOOGLE_REDIRECT_URI.

#### GET /api/public/schedule/{token}

Public lookup of scheduling info for a candidate by their opaque scheduling_token. Returns candidate name/email, resolved job title, current interview stage, and the proposed/scheduled time.

- **Auth:** public (no cookie/JWT). Possession of applicant.scheduling_token is the only access control.
- **Path params:** `token`:str — the Applicant.scheduling_token (opaque string).
- **Query params:** none

Request: none

Response:
```json
{
  "candidate_name": "string",
  "email": "string",
  "job_title": "string",
  "stage": "string",
  "scheduled_at": "string|null"
}
```
job_title = Job.role_name or Job.title, else "General Position". stage = "Functional Interview" | "Recruiter Screening" | "Resume". scheduled_at = ISO-8601 datetime or null.

Status codes: 200 OK; 404 "Invalid or expired scheduling token." (no Applicant with that token).

Notes: Plain dict (no Pydantic model). Stage resolution: functional_status not None → "Functional Interview" (scheduled_at=functional_scheduled_at); elif screening_status not None → "Recruiter Screening" (scheduled_at=screening_scheduled_at); else "Resume" (scheduled_at=None). Presence/absence (not value) drives the stage.

#### GET /api/public/interview-session/{session_id}

Public lookup of interview-session info by Applicant id (used as the session id). Same payload shape as /schedule/{token} but keyed on the Applicant UUID.

- **Auth:** public (no cookie/JWT). Access gated only by knowing the Applicant UUID.
- **Path params:** `session_id`:UUID — the Applicant.id, treated as the interview session id.
- **Query params:** none

Request: none

Response:
```json
{
  "candidate_name": "string",
  "email": "string",
  "job_title": "string",
  "stage": "string",
  "scheduled_at": "string|null"
}
```

Status codes: 200 OK; 404 "Session not found." (no Applicant with that id); 422 if session_id is not a valid UUID.

Notes: Plain dict (no Pydantic model). Identical stage-resolution logic to /schedule/{token}.

#### GET /api/public/confirm/{token}

Candidate confirms the proposed interview slot via their scheduling_token (typically from the invitation email). Sets a default slot (1 PM next day) if none exists, marks the stage status scheduled, resets the calendar sequence, creates a Google Calendar event, sends an iCal confirmation email, returns an HTML confirmation page.

- **Auth:** public (no cookie/JWT). Possession of applicant.scheduling_token authorizes confirmation.
- **Path params:** `token`:str — the Applicant.scheduling_token.
- **Query params:** none

Request: none

Response:
```html
200 OK, Content-Type: text/html (HTMLResponse)
<html>...<h1>Interview Confirmed!</h1>
  "Your {stage} has been scheduled for the following time:"
  <div class="time">{Month DD, YYYY at HH:MM AM/PM UTC}</div>
  <a href="{FRONTEND_URL}/interview?sessionId={applicant.id}" class="btn">Go to Interview Room</a>
...</html>
```

Status codes: 200 HTML confirmation page; 404 "Invalid or expired scheduling token."; 400 "No proposed time is set for the interview." (proposed_time falsy — neither functional_status nor screening_status set).

Notes: Mutates and commits the Applicant: functional stage sets functional_scheduled_at (default next-day 13:00 UTC) and functional_status=scheduled, plus sync_applicant_to_ai (non-fatal); screening stage sets screening_scheduled_at (default next-day 13:00 UTC) and screening_status=scheduled. Always sets calendar_sequence=0. Creates Google Calendar event via create_calendar_event and stores id in calendar_event_id (non-fatal). Sends send_ical_invitation_email (duration_minutes=30, sequence=0, uid=interview-{stage-slug}-{applicant.id}@interviehire.com; non-fatal). Organizer from Organisation (org_name/contact_email) falling back to "IntervieHire Host" and settings.SMTP_FROM or "hr@interviehire.com". reschedule_link={FRONTEND_URL}/reschedule.html?token=...; interview_link={FRONTEND_URL}/interview?sessionId={applicant.id}.

#### POST /api/public/reschedule/{token}

Candidate reschedules their interview to a new time via scheduling_token. Parses the supplied ISO datetime, updates the relevant stage's scheduled_at and status, bumps the calendar sequence, updates the existing Google Calendar event, resends an iCal invitation email.

- **Auth:** public (no cookie/JWT). Possession of applicant.scheduling_token authorizes the reschedule.
- **Path params:** `token`:str — the Applicant.scheduling_token.
- **Query params:** none

Request:
```json
{
  "new_time": "string"   // required; ISO-8601 datetime. Body(..., embed=True) — MUST be a JSON object with top-level "new_time". Parsed via datetime.fromisoformat(new_time.replace('Z','+00:00')).
}
```

Response:
```json
{
  "status": "success",
  "new_scheduled_time": "string"   // parsed_time.isoformat()
}
```

Status codes: 200 OK; 404 "Invalid or expired scheduling token."; 400 "Invalid ISO datetime format."; 422 if request body missing the required "new_time" field.

Notes: Mutates and commits the Applicant: functional stage sets functional_scheduled_at=parsed_time, functional_status=scheduled, sync_applicant_to_ai (non-fatal); screening stage sets screening_scheduled_at=parsed_time, screening_status=scheduled. Always increments calendar_sequence = (calendar_sequence or 0) + 1. If calendar_event_id exists, calls update_calendar_event (non-fatal). Resends send_ical_invitation_email (duration_minutes=30, sequence=calendar_sequence; non-fatal). Unlike /confirm, does NOT raise if no stage status is set.

### `backend/app/routers/leaderboard.py`

#### GET /api/leaderboard/jobs/{job_id}

Returns a ranked leaderboard of all applicants for a given job. Each entry blends resume match, recruiter-screening, and functional-interview scores into a weighted overall score (resume*0.2 + screening*0.3 + functional*0.5), pulls per-dimension rubric scores and pros/cons counts from the candidate's InterviewSession evaluation, counts proctoring warnings, reports cheat probability and current stage. Sorted by overall_score descending.

- **Auth:** JWT httpOnly cookie required (get_current_user + get_active_org_id). No explicit role gate, but org-scoping enforced: non-super_admin → own organisation_id; super_admin → active_org_id cookie (or first org fallback). If job belongs to a different organisation than active_org_id, rejected with 403.
- **Path params:** `job_id`:UUID (required) — the Job.id (422 if not a valid UUID).
- **Query params:** none

Request: none

Response:
```json
// 200 OK — JSON array, sorted by overall_score descending. One object per applicant.
[
  {
    "candidate_id": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "overall_score": 0.0,
    "resume_match_score": 0.0,
    "screening_score": 0.0,
    "functional_score": 0.0,
    "cheat_probability": "low",
    "proctoring_warnings": 0,
    "pros_count": 0,
    "cons_count": 0,
    "rubrics": {
      "Some Dimension": 0
    },
    "status": "string"
  }
]
```
Derivation: `overall_score` = resume_score*0.2 + screening_score*0.3 + functional_score*0.5 (rounded 1 dp). `resume_match_score` is the raw Applicant.match_score (un-normalized), unlike resume_score used in the calc (which is *10 if <=10). `screening_score` = Applicant.screening_score else recruiter_screening_score else 0.0. `cheat_probability` ∈ low|medium|high (default low). `proctoring_warnings` = count of ProctoringLog where sessionId == str(applicant.id). `pros_count`/`cons_count` = len(evaluation['strengths'/'weaknesses']) else 0. `rubrics` from evaluation['dimensionScores'] (Title-Cased keys → dim['score']); fallback {"Technical Fit","Communication","Problem Solving","Culture Fit"}=functional_score if empty and functional_score not None. `status` = remarks else "Functional Stage"/"Screening Stage"/"Resume Stage".

Status codes: 200 OK (possibly empty array); 401 Unauthorized; 403 Forbidden — "Not authorized to access this job's candidates" (job.organisation_id and active_org_id both set and differ); 404 Not Found — "Job not found"; 422 Unprocessable Entity — invalid UUID.

Notes: Untyped list of dicts (no response_model). Cross-service linkage uses str(applicant.id) as the key into ProctoringLog.sessionId and InterviewSession.id. 403 org check only fires when BOTH job.organisation_id and active_org_id are truthy. Router prefix '/api/leaderboard' applied at mount in main.py.

### `backend/app/talent_finder/routes.py`

> AI-driven candidate sourcing ("Talent Finder"). Router mounted in `main.py` with prefix `/api/talent-finder`. **Every route** depends on `get_current_user` (auth required — JWT `token` cookie or `Authorization: Bearer`) and `get_active_org_id` (org scoping). `org_id` is `Optional[UUID]`: for super_admin it resolves from the `active_org_id` cookie (first-org fallback); for others it is the user's `organisation_id`; it may be `None`. **There is no explicit super_admin/admin role gate on any route** (docstrings label delete/configure as "admin", but the code does not enforce a role). Org isolation: `_get_search`/`_get_candidate` 404 when the row's `organisation_id` is set and differs from the caller's `org_id` (rows with a null `organisation_id`, or a caller with a null `org_id`, are not isolated). **No route declares a `response_model`** — all responses are plain dicts (shapes below are the literal dicts the handlers return). Most mutating routes also append a `TalentFinderAuditLog` row (best-effort; failures are swallowed). Enum string values referenced below come from `backend/app/talent_finder/models.py`: `SearchStatus` (pending|searching|normalizing|deduping|ranking|done|failed), `ResultStatus` (new|shortlisted|rejected|saved|invited), `OutreachStatus` (none|draft|approved|sent|opted_out).

#### POST /api/talent-finder/extract-brief

Auto-derive a search brief from a job (authored blueprint topics → must-haves; JD skill extraction → good-to-haves) and/or raw JD text. Deterministic, keyless.

- **Auth:** required (get_current_user) + get_active_org_id.
- **Path params:** none
- **Query params:** none

Request: raw JSON object (body typed as `dict`, no Pydantic model):
```json
{
  "jobRoleId": "uuid string | null (optional) — if present, the Job is loaded by id (no org check) and used to seed the brief",
  "jdText": "string | null (optional) — raw JD text used when no job description is available"
}
```

Response:
```json
{
  "ok": true,
  "brief": {
    "title": "string | null",
    "location": "string | null",
    "experienceMin": "number | null",
    "experienceMax": "number | null",
    "mustHaveSkills": ["string"],
    "goodToHaveSkills": ["string"],
    "jdText": "string"
  }
}
```

Status codes: 200 OK; 401 not authenticated.

Notes: `mustHaveSkills` come from the job's `functional_parameters.topics[].name`; if none, seeded from the top 6 extracted JD skills. `goodToHaveSkills` = up to 8 extracted skills not already in must-haves. `experienceMin`/`experienceMax` parsed from the job's `experience_band`. No audit log. If `jobRoleId` is absent or not found, `job` is None and the brief is derived from `jdText` only.

#### POST /api/talent-finder/search

Create and run a talent search synchronously: builds a brief from the (optional) job + request body, discovers candidates across the selected sources, dedups, hard-filters, weight-scores, persists profiles/sources/fit-scores/results, and returns a summary.

- **Auth:** required (get_current_user) + get_active_org_id.
- **Path params:** none
- **Query params:** none

Request: raw JSON object (body typed as `dict`, no Pydantic model). Fields consumed by `service.build_brief` / `service._selected_sources` / the search runner:
```json
{
  "jobRoleId": "uuid string | null (optional) — Job loaded by id (no org check) to merge into the brief",
  "title": "string | null (optional) — used when no job",
  "location": "string | null (optional)",
  "remoteOrOnsite": "string | null (optional)",
  "experienceRange": { "min": "number | null", "max": "number | null" },
  "mustHaveSkills": ["string"],
  "goodToHaveSkills": ["string"],
  "shouldNotHave": ["string"],
  "excludeKeywords": ["string"],
  "educationRequirement": "string | null (optional)",
  "industryPreference": "string | null (optional)",
  "jdText": "string | null (optional)",
  "requireAvailable": "boolean (optional, default false)",
  "includeInternational": "boolean (optional, default false)",
  "studentFocus": "boolean (optional, default false)",
  "targetCountries": ["string"],
  "maxCandidates": "integer (optional, default 50)",
  "sources": ["string (source_type)"],
  "includeInternalDatabase": "boolean (optional, default true)",
  "includeUploadedFiles": "boolean (optional)",
  "includePublicWeb": "boolean (optional)",
  "includeApprovedAPIs": "boolean (optional)",
  "csvRows": [ { } ],
  "manualProfiles": [ { } ],
  "sourceConfig": { }
}
```
Source selection: if `sources` is provided it is used verbatim; otherwise it is derived from the `include*` flags (`includeInternalDatabase` → `internal_db`,`resume_db`; `includeUploadedFiles` → `uploaded_csv`,`manual_import`; `includePublicWeb` → `public_web`; `includeApprovedAPIs` → `approved_api`), defaulting to `["internal_db","resume_db"]`.

Response:
```json
{
  "searchId": "uuid string",
  "status": "done",
  "found": 0,
  "deduped": 0,
  "ranked": 0,
  "source_notes": { "<source_type>": "string note (e.g. \"ok\" or a permission/error message)" },
  "no_results_hint": "string | null"
}
```
(The `status`/`found`/`deduped`/`ranked`/`source_notes`/`no_results_hint` keys are the `run_search` summary spread into the response; on success `status` is `done`.)

Status codes: 200 OK; 401 not authenticated; 500 — "Search failed: <error>" (any exception during `run_search`; the TalentSearch row is marked `status='failed'` with the error stored).

Notes: Persists a `TalentSearch` row (status pending→searching→deduping→ranking→done) plus `CandidateProfile` (upserted by `dedup_key` within the org), `CandidateSource`, `CandidateFitScore`, and `TalentSearchResult` rows (ranked, capped at `max_candidates`). `no_results_hint` is a non-null guidance string when zero candidates ranked, else null. Audit: `search.run`.

#### GET /api/talent-finder/search/{search_id}/status

Poll a search's progress/counters.

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_search`).
- **Path params:** `search_id`:UUID (required) — the TalentSearch id.
- **Query params:** none

Request: none

Response:
```json
{
  "searchId": "uuid string",
  "status": "pending | searching | normalizing | deduping | ranking | done | failed",
  "found": 0,
  "deduped": 0,
  "ranked": 0,
  "error": "string | null",
  "source_notes": { "<source_type>": "string" }
}
```

Status codes: 200 OK; 401 not authenticated; 404 — "Search not found" (missing, or org mismatch); 422 invalid UUID.

Notes: `found`/`deduped`/`ranked` map to the row's `found_count`/`deduped_count`/`ranked_count`. `source_notes` read from `brief._source_notes` (empty object until the search has run).

#### GET /api/talent-finder/search/{search_id}/results

List a search's ranked candidates with full normalized profiles.

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_search`).
- **Path params:** `search_id`:UUID (required) — the TalentSearch id.
- **Query params:** none

Request: none

Response:
```json
{
  "searchId": "uuid string",
  "count": 0,
  "brief": { },
  "results": [
    {
      "id": "uuid string",
      "full_name": "string",
      "current_title": "string | null",
      "current_company": "string | null",
      "location": "string | null",
      "email": "string | null",
      "phone": "string | null",
      "profile_url": "string | null",
      "source_name": "string | null",
      "source_type": "string | null",
      "source_permission_status": "string | null",
      "skills": ["string"],
      "years_of_experience": "number | null",
      "education": ["string"],
      "previous_companies": ["string"],
      "resume_url": "string | null",
      "portfolio_url": "string | null",
      "github_url": "string | null",
      "linkedin_url": "string | null",
      "availability_status": "string | null",
      "salary_expectation": "string | null",
      "notice_period": "string | null",
      "consent_status": "string",
      "outreach_status": "none | draft | approved | sent | opted_out",
      "fit_score": "number | null",
      "fit_breakdown": { },
      "fit_reasoning": "string | null",
      "risk_flags": ["string"],
      "completeness": "number",
      "sources": [
        { "source_name": "string | null", "source_type": "string | null", "source_permission_status": "string | null", "profile_url": "string | null" }
      ],
      "rank": "integer | null",
      "result_status": "new | shortlisted | rejected | saved | invited",
      "result_id": "uuid string"
    }
  ]
}
```

Status codes: 200 OK; 401 not authenticated; 404 — "Search not found"; 422 invalid UUID.

Notes: `brief` is the stored TalentSearch.brief (includes `_source_notes`). Results ordered by `fit_score` descending. Each item is `_serialize_profile(profile, sources)` plus `rank`, `result_status` (the `TalentSearchResult.status`), and `result_id`. No audit log.

#### POST /api/talent-finder/candidates/{candidate_id}/shortlist

Mark a sourced candidate shortlisted (sets every TalentSearchResult row for that candidate to `shortlisted`).

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_candidate`).
- **Path params:** `candidate_id`:UUID (required) — the CandidateProfile id.
- **Query params:** none

Request: none

Response:
```json
{ "ok": true, "status": "shortlisted" }
```

Status codes: 200 OK; 401 not authenticated; 404 — "Candidate not found" (missing, or org mismatch); 422 invalid UUID.

Notes: Audit: `candidate.shortlist`.

#### POST /api/talent-finder/candidates/{candidate_id}/reject

Mark a sourced candidate rejected (sets every TalentSearchResult row for that candidate to `rejected`).

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_candidate`).
- **Path params:** `candidate_id`:UUID (required) — the CandidateProfile id.
- **Query params:** none

Request: none

Response:
```json
{ "ok": true, "status": "rejected" }
```

Status codes: 200 OK; 401 not authenticated; 404 — "Candidate not found"; 422 invalid UUID.

Notes: Audit: `candidate.reject`.

#### POST /api/talent-finder/candidates/{candidate_id}/opt-out

Honor an opt-out: set the candidate's `outreach_status=opted_out` and `consent_status="opted_out"`.

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_candidate`).
- **Path params:** `candidate_id`:UUID (required) — the CandidateProfile id.
- **Query params:** none

Request: none

Response:
```json
{ "ok": true, "status": "opted_out" }
```

Status codes: 200 OK; 401 not authenticated; 404 — "Candidate not found"; 422 invalid UUID.

Notes: Audit: `candidate.opt_out`.

#### POST /api/talent-finder/candidates/{candidate_id}/move-to-pipeline

Move a sourced candidate into the existing interview pipeline by creating an `Applicant` on a target job, and mark the candidate's result rows `invited`.

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_candidate`).
- **Path params:** `candidate_id`:UUID (required) — the CandidateProfile id.
- **Query params:** none

Request: raw JSON object (body typed as `dict`, optional — may be omitted/null):
```json
{ "jobId": "uuid string | null (optional) — target Job; if omitted, falls back to the job_id of the candidate's first TalentSearchResult's search" }
```

Response:
```json
{ "ok": true, "applicantId": "uuid string", "jobId": "uuid string" }
```

Status codes: 200 OK; 400 — "jobId required to move into the interview pipeline." (no jobId and none derivable) OR "Candidate has no email (needs a permissioned source) to invite." (candidate.email is null); 401 not authenticated; 404 — "Candidate not found"; 422 invalid UUID.

Notes: Creates `Applicant(name, email, phone, job_id, source=ApplicantSource.scheduled, resume_url, resume_text=raw_source_payload.resume_text)`; sets all of the candidate's `TalentSearchResult` rows to `invited`. Audit: `candidate.move_to_pipeline` (detail includes applicant_id, job_id).

#### POST /api/talent-finder/candidates/{candidate_id}/generate-outreach

Generate a DRAFT outreach message for a candidate (recruiter must approve before sending). Refused if the candidate opted out.

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_candidate`).
- **Path params:** `candidate_id`:UUID (required) — the CandidateProfile id.
- **Query params:** none

Request: raw JSON object (body typed as `dict = None`, optional — may be omitted/null):
```json
{
  "channel": "string (optional, default \"email\") — stored on the outreach message",
  "brief": "object | null (optional) — context for message generation; falls back to the candidate's fit_breakdown"
}
```

Response:
```json
{
  "ok": true,
  "outreachId": "uuid string",
  "message": "string (generated draft message body)",
  "status": "draft",
  "note": "Draft only — recruiter must approve before sending."
}
```

Status codes: 200 OK; 401 not authenticated; 404 — "Candidate not found"; 409 — "Candidate has opted out of outreach." (outreach_status == opted_out); 422 invalid UUID.

Notes: Persists a `CandidateOutreachMessage(channel, message, status='draft')` and sets the candidate's `outreach_status='draft'`. Company name resolved from the active Organisation's `org_name` (else "our team"). Audit: `outreach.generate`.

#### DELETE /api/talent-finder/candidates/{candidate_id}

Privacy: hard-delete a candidate's sourced data (cascades sources / fit-scores / results / outreach via FK ondelete).

- **Auth:** required (get_current_user) + get_active_org_id (org-isolated via `_get_candidate`). Docstring calls this admin-only, but **no role gate is enforced**.
- **Path params:** `candidate_id`:UUID (required) — the CandidateProfile id.
- **Query params:** none

Request: none

Response:
```json
{ "ok": true, "deleted": "uuid string (the candidate_id)" }
```

Status codes: 200 OK; 401 not authenticated; 404 — "Candidate not found"; 422 invalid UUID.

Notes: `db.delete(candidate)`; FK cascades remove CandidateSource / CandidateFitScore / TalentSearchResult rows (CandidateOutreachMessage.search_id is SET NULL on search delete but candidate_id cascades). Audit: `data.delete`.

#### POST /api/talent-finder/import/csv

Upload a CSV of candidates; parses + normalizes header keys, records an import batch, and returns the parsed rows (does not create CandidateProfiles directly — rows are meant to be fed back into a search via `csvRows`).

- **Auth:** required (get_current_user) + get_active_org_id.
- **Path params:** none
- **Query params:** none

Request: `multipart/form-data`
```
file: UploadFile (required) — CSV; decoded utf-8 (errors ignored), parsed with csv.DictReader
```

Response:
```json
{
  "ok": true,
  "batchId": "uuid string",
  "rows": [ { "<normalized_header>": "string value" } ],
  "imported": 0,
  "skipped": 0
}
```

Status codes: 200 OK; 401 not authenticated; 422 — missing file.

Notes: Header keys are lowercased, trimmed, spaces→underscores. A row is kept only if it has `full_name`, `name`, or `email`; otherwise it counts toward `skipped`. Persists a `CandidateImportBatch(source_type="uploaded_csv", filename, row_count, imported_count, skipped_count)`. Audit: `import.csv`.

#### GET /api/talent-finder/sources

List all configured sourcing adapters with live enabled/permission status (powers the admin source panel).

- **Auth:** required (get_current_user) + get_active_org_id.
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
{
  "sources": [
    {
      "source_type": "string (e.g. internal_db | resume_db | uploaded_csv | manual_import | github | web_search | public_web | approved_api | linkedin | internshala | naukri | indeed)",
      "source_name": "string",
      "permission_mode": "permissioned | public_allowed | user_provided | requires_permission",
      "is_enabled": "boolean",
      "available": "boolean",
      "note": "string | null (recruiter-facing reason when not available)",
      "rate_limit": { "max_per_minute": 30, "concurrency": 1 }
    }
  ]
}
```

Status codes: 200 OK; 401 not authenticated.

Notes: One entry per adapter in the registry. `available`/`note` come from each adapter's `validate_permissions()`; restricted adapters (linkedin/internshala/naukri/indeed) ship disabled with a permission note. `rate_limit` is the adapter's `rate_limit_config`. No audit log.

#### POST /api/talent-finder/sources/configure

Create or update an organisation's source-adapter config (enable/disable, permission mode, opaque config). Docstring calls this admin-only.

- **Auth:** required (get_current_user) + get_active_org_id. **No role gate is enforced** despite the "admin" label.
- **Path params:** none
- **Query params:** none

Request: raw JSON object (body typed as `dict`, no Pydantic model):
```json
{
  "source_type": "string (required)",
  "source_name": "string | null (optional, default = source_type when creating)",
  "is_enabled": "boolean (optional, default = existing value)",
  "permission_mode": "string (optional, default = existing value)",
  "config": "object | null (optional) — only applied when non-null"
}
```

Response:
```json
{ "ok": true, "source_type": "string", "is_enabled": "boolean" }
```

Status codes: 200 OK; 400 — "source_type required" (missing source_type); 401 not authenticated.

Notes: Upserts a `SourceAdapterConfig` keyed by (organisation_id, source_type). `config` is stored verbatim (intended to hold API-key refs/endpoints, never raw secrets in logs). Audit: `sources.configure` (detail includes is_enabled).

---

## Interview Engine — Fastify

### `interview-engine/apps/api/src/routes/assistant.routes.ts`

#### POST /api/assistant/chat

Conversational IntervieHire help assistant. Takes a chat history (plus optional current-page/topic context), prepends a fixed system instruction, and proxies to DeepSeek for a plain-text reply.

- **Auth:** public (no preHandler, no API-key check). Subject only to the global rate limit: 200 requests / 1 minute.
- **Path params:** none
- **Query params:** none

Request: JSON body, validated by zod
```
{
  messages: Array<{
    role: "user" | "assistant",  // required, enum (only these two values)
    content: string             // required, min length 1
  }>,                          // required, .min(1)
  page?: string,               // optional
  topic?: string               // optional
}
```
The zod schema permits only "user" and "assistant" roles; the server injects the system message before forwarding.

Response: 200 OK, application/json
```
{
  answer: string   // DeepSeek's plain-text reply (choices[0].message.content trimmed; "" if nothing)
}
```

Status codes: 200 OK; 400 (Fastify default on thrown ZodError — invalid/missing body); 429 Too Many Requests (global rate limit exceeded); 500 Internal Server Error if DeepSeek not configured ('DeepSeek is not configured. Set DEEPSEEK_API_KEY to enable LLM calls.') or upstream call fails ('DeepSeek failed: <status> <text>').

Notes: Registered via `app.register(assistantRoutes, { prefix: '/api/assistant' })`; route `app.post('/chat', ...)`. Validation done manually with zod (no Fastify schema). System instruction is fixed lines plus `Current page: ${page}.` / `User topic: ${topic}.` when present; model returns plain text only. Forwarded array: [{role:'system', content: systemInstruction}, ...body.messages]. DeepSeek config: model DEEPSEEK_MODEL (default 'deepseek-v4-flash'), baseUrl DEEPSEEK_BASE_URL (default 'https://api.deepseek.com/chat/completions'). No deterministic fallback — errors with no key.

### `interview-engine/apps/api/src/routes/company.routes.ts`

#### GET /api/company/dashboard/{companyId}

Returns the full company dashboard payload: the company record, all candidates (newest first), all job roles with their questions, and all interview sessions (newest first) with candidate, jobRole and proctoringLogs included.

- **Auth:** none (globally rate-limited 200/min; CORS origin:true credentials:true).
- **Path params:** `companyId`:string — Prisma Company.id
- **Query params:** none

Request: none

Response:
```
// 200 OK — no Fastify response schema; raw Prisma query result:
{
  company: Company | null,        // findUnique; null if not found
  candidates: Candidate[],         // findMany, orderBy createdAt desc
  roles: JobRole[],                // findMany, include: { questions: Question[] }
  sessions: InterviewSession[]     // findMany, orderBy createdAt desc,
                                   //   include: { candidate, jobRole, proctoringLogs }
}
// Each entry is the full Prisma model row (field names/types from prisma/schema.prisma).
```

Status codes: 200 OK (always, even when company is null); 500 on Prisma/DB error.

Notes: No validation on companyId. company is null (not 404) when id does not exist. No DTO mapping. Globally rate limited (429 if exceeded).

#### POST /api/company/candidates

Upserts a candidate for a company (by companyId+email), computes a deterministic ATS screening score against the target JobRole, persists the score/breakdown, and creates a new SCHEDULED interview session for the candidate against that role.

- **Auth:** none (globally rate-limited 200/min).
- **Path params:** none
- **Query params:** none

Request: validated with zod (throws → 500)
```
{
  companyId: string,                       // required
  fullName: string,                        // required
  email: string,                           // required, valid email
  phone?: string,                          // optional
  parsedResume?: Record<string, any>,      // optional, default {}
  resumeText?: string,                     // optional
  jobRoleId: string                        // required (JobRole must exist → findUniqueOrThrow)
}
```

Response:
```
// 200 OK — no Fastify response schema; raw object:
{
  candidate: Candidate,   // upserted row: companyId, fullName, email, phone, parsedResume,
                          //   resumeText, atsScore (Float), atsBreakdown (Json)
  ats: {
    score: number,        // 0..100, rounded to 1 decimal
    breakdown: {
      primary: number,        // 0..1 normalized term match vs role.primaryCriteria
      secondary: number,      // 0..1 vs role.secondaryCriteria
      education: number,      // 0..1
      experience: number,     // 0..1 (yearsOfExperience | experienceYears / 8)
      communication: number,  // 0..1
      weights: { primary: number, secondary: number, education: number, experience: number, communication: number }
    }
  },
  session: InterviewSession  // newly created: { companyId, candidateId, jobRoleId, status: 'SCHEDULED', ... }
}
```

Status codes: 200 OK; 500 on zod validation failure, jobRoleId not found (P2025), or any DB error; 429 if rate limited.

Notes: Upsert key is the composite unique companyId_email. On existing candidate updates fullName/phone/parsedResume/resumeText/atsScore/atsBreakdown (not email). scoreCandidate is fully deterministic (no AI). Always creates a fresh SCHEDULED InterviewSession.

#### POST /api/company/questions/generate

Generates interview questions for a job role using DeepSeek (falls back to a single deterministic question if the AI call fails), persists up to the first 10, and returns the created Question rows.

- **Auth:** none (globally rate-limited 200/min).
- **Path params:** none
- **Query params:** none

Request: validated with zod (throws → 500)
```
{
  companyId: string,        // required
  jobRoleId: string,        // required
  jobDescription: string,   // required
  roleType: string,         // required (roleApplicability enum value & competency map key)
  companyName: string,      // required
  jobTitle?: string         // optional
}
```

Response:
```
// 200 OK — no Fastify response schema:
{
  questions: Question[]   // up to 10 created Question rows. Each created with:
  // {
  //   companyId, jobRoleId, text,
  //   difficulty: 'EASY' | 'MEDIUM' | 'HARD' (default 'MEDIUM'),
  //   topicCategories: string[],
  //   roleApplicability: [roleType],
  //   aiEvaluationGuidance: string  // JSON string: { questionType, modelAnswer,
  //     rubric: { requiredPoints:[{id,description,keywords[],weight}], secondaryPoints:[...],
  //       excellentAnswerSignals:[...], redFlags:[{id,description,severity:'low'|'medium'|'high'|'critical'}] } }
  //   // plus model defaults (id, createdAt, etc.)
  // }
}
```

Status codes: 200 OK; 500 on zod validation failure or DB/transaction error; 429 if rate limited.

Notes: generateQuestions calls DeepSeek; on any error returns ONE deterministic fallback question (so this route can succeed with a single question even without an API key). Only the first 10 generated questions persisted (slice(0,10)) inside a prisma.$transaction. aiEvaluationGuidance stored as a stringified JSON blob.

#### PUT /api/company/questions/{id}

Updates a single Question by id with the raw request body and returns the updated row.

- **Auth:** none (globally rate-limited 200/min).
- **Path params:** `id`:string — Prisma Question.id to update
- **Query params:** none

Request: NO zod validation — req.body passed directly as Prisma update `data`.
```
{
  text?: string,
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD',
  topicCategories?: string[],
  roleApplicability?: string[],
  aiEvaluationGuidance?: string,
  // ...any other writable Question column (passed through unfiltered)
}
```

Response:
```
// 200 OK — updated Question row verbatim:
Question  // { id, companyId, jobRoleId, text, difficulty, topicCategories[], roleApplicability[], aiEvaluationGuidance, createdAt, ... }
```

Status codes: 200 OK; 500 if id not found (P2025) or body contains an invalid/unknown column; 429 if rate limited.

Notes: Unsafe/unvalidated — entire body forwarded to Prisma update with no allowlist. No auth, so any caller who knows a question id can mutate it. Throws (500) rather than 404 when id does not exist.

### `interview-engine/apps/api/src/routes/interview.routes.ts`

#### GET /api/interview/demo-session

Idempotently self-seeds a demo company (slug 'demo-junior-sde'), a 'Junior Software Development Engineer' job role, 4 seeded junior SDE questions, a demo candidate (Aarav Sharma), and a SCHEDULED interview session; returns IDs for bootstrapping a zero-config demo interview.

- **Auth:** Public (no preHandler, no api key). Global rate limit (200/min).
- **Path params:** none
- **Query params:** none

Request: none

Response:
```
200 OK (application/json)
{
  sessionId: string,    // InterviewSession.id (cuid)
  companyId: string,    // Company.id
  roleId: string,       // JobRole.id
  candidateId: string   // Candidate.id
}
```

Status codes: 200 OK; 429 rate limited; 500 on Prisma/upsert failure.

Notes: No Fastify schema. Upserts company by slug; finds-or-creates role/questions/candidate/session. Side-effecting GET (writes to DB).

#### GET /api/interview/sessions/:id

Fetches a single interview session with related company, candidate, jobRole (incl. its questions), and proctoringLogs.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id (cuid)
- **Query params:** none

Request: none

Response:
```
200 OK (application/json)
Result of prisma.interviewSession.findUnique({ where:{id}, include:{ company, candidate, jobRole:{ include:{ questions } }, proctoringLogs } })

InterviewSession {
  id, companyId, candidateId, jobRoleId,
  status: 'SCHEDULED'|'IN_PROGRESS'|'COMPLETED'|...,
  scheduledAt: string|null, startedAt: string|null, completedAt: string|null,
  transcript: Json|null,   // array of {speaker:'ai'|'candidate', text, timestamp, questionIndex, ...}
  reportUrl: string|null,
  createdAt: string, updatedAt: string,
  company: Company { id, name, slug, description, reportEmail, primaryColor, ... },
  candidate: Candidate { id, companyId, fullName, email, parsedResume:Json, atsScore, atsBreakdown:Json, ... },
  jobRole: JobRole { id, companyId, title, roleType, description, requirements, primaryCriteria:string[], secondaryCriteria:string[], atsScoringWeights:Json, evaluationCriteria:Json, questions: Question[] },
  proctoringLogs: ProctoringLog[]
}
// null if not found
```

Status codes: 200 OK (body may be null if session not found); 429 rate limited; 500 on DB error.

Notes: No Fastify schema; field set governed by the Prisma schema. Returns null (not 404) for unknown id.

#### POST /api/interview/sessions/:id/start

Marks the session IN_PROGRESS, sets startedAt (if unset), seeds the first AI question into the transcript if no AI turn exists yet, opens the transcript metadata row (status: recording), and returns the updated session plus the initial question text.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: none (body ignored)

Response:
```
200 OK (application/json)
{
  session: InterviewSession,   // full updated row (status='IN_PROGRESS', startedAt set, transcript updated)
  initialQuestion: string      // first active question text, or fallback 'Tell me about your software engineering background.'
}
```

Status codes: 200 OK; 404/500 — uses findUniqueOrThrow, so unknown id throws (P2025) surfaced as 500-class; 429 rate limited.

Notes: No Fastify schema. firstQuestion = first isActive question (orderBy createdAt asc) of the jobRole, else fallback. Calls ensureTranscriptMeta(id).

#### GET /api/interview/sessions/:id/vapi-config

Builds and returns a Vapi voice-assistant configuration object derived from the session's company, job role, questions, and evaluation criteria.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: none

Response:
```
200 OK (application/json)
Vapi assistant config object produced by buildVapiAssistantConfig({
  companyName, companyDescription?, jobRole (title),
  roleRequirements, questions: string[], evaluationCriteria
})
// shape defined by services/vapi-config.service.ts (name, model, voice, transcriber, firstMessage, systemPrompt/messages, etc.)
```

Status codes: 200 OK; 404/500 — findUniqueOrThrow throws on unknown id; 429 rate limited.

Notes: No Fastify schema. Exact shape is whatever buildVapiAssistantConfig returns (see vapi-config.service.ts).

#### POST /api/interview/sessions/:id/complete

Marks the session COMPLETED, sets completedAt, and best-effort finalizes the transcript (.txt). A finalize failure is logged but does not fail the request.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: none (body ignored)

Response:
```
200 OK (application/json)
{
  session: InterviewSession,        // updated row (status='COMPLETED', completedAt set)
  transcript: <finalizeTranscript result> | null   // null if finalize failed (logged, non-fatal)
}
```

Status codes: 200 OK; 404/500 — prisma.update throws on unknown id (P2025); 429 rate limited.

Notes: No Fastify schema. finalizeTranscript(id) wrapped in .catch → returns null on error. Transcript .txt can also be rebuilt via POST /api/interviews/:id/transcript/finalize.

#### POST /api/interview/sessions/:id/answers

Submits a candidate's text answer; the conversation director appends the answer to the transcript, decides whether to ask a follow-up / next question / closing line, persists the transcript, auto-captures both turns into the event log, and returns the AI's next utterance.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: application/json
```
{
  text: string,                          // required, trimmed; empty/missing → 400
  metrics?: Record<string, unknown>      // optional, default {} (stored on the candidate transcript turn)
}
```

Response:
```
200 OK (application/json)
{
  answer: { text: string },              // echo of the submitted (trimmed) answer text
  ai: {                                   // from handleCandidateTranscript()
    text: string,                         // AI's next utterance
    interviewPhase: 'questioning' | 'follow_up' | 'closing',
    emotionState: 'curious' | 'encouraging'
  }
}
```

Status codes: 400 'Answer text is required' (empty/missing text); 200 OK; 404/500 — handleCandidateTranscript throws 'Interview session not found' for unknown id (surfaced as 500); 429 rate limited.

Notes: No Fastify schema. Determines active question index from last AI transcript entry; enforces MAX_FOLLOWUPS_PER_QUESTION; updates session.status to IN_PROGRESS. Best-effort recordEventSafe for both turns.

#### POST /api/interview/sessions/:id/transcript-text

Ingests a pasted/structured interview transcript (Convai memory paste, {turns:[]}, {interaction:[]}, or raw 'Speaker: text' lines), normalizes it into the evaluator's {speaker,text,questionIndex,timestamp} shape, and overwrites session.transcript.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: application/json (any one of these forms; parsed leniently)
```
{
  turns?: Array<{ speaker?: string, role?: string, text?: string, message?: string, content?: string }>,
  interaction?: Array<{ speaker?: string, role?: string, text?: string, message?: string, content?: string }>,  // Convai chatHistory shape
  text?: string   // raw transcript with 'Speaker: line' prefixes
}
// body may also be a raw JSON string (typeof body === 'string')
```

Response:
```
200 OK (application/json)
{
  ok: true,
  turns: number,                 // count of normalized turns
  transcript: Array<{
    speaker: 'ai' | 'candidate',
    text: string,
    questionIndex: number,        // >= 0; increments on each ai turn
    timestamp: string (ISO)
  }>
}
```

Status codes: 404 'Session not found'; 400 'Could not parse any interview turns. Paste the conversation with "Speaker: text" lines, or send a {turns:[{speaker,text}]} array.' (zero parsed turns); 200 OK; 429 rate limited.

Notes: No Fastify schema. Speaker classified by regex: aiRe=/character|interviewer|assistant|^ai\b|\bai\b|lina|bot/i, candidateRe=/user|candidate|\byou\b|\bme\b|human|applicant/i; unknown → 'candidate'. Overwrites session.transcript entirely.

#### POST /api/interview/sessions/:id/evaluate

Runs the Aviral rubric-grounded evaluation over the session's transcript and returns the canonical CandidateReport.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: none (body ignored)

Response:
```
200 OK (application/json)
{
  evaluation: EvalCandidateReport   // canonical CandidateReport from evaluateInterview()
}
// EvalCandidateReport (aviral-eval): { overallScore, recommendation, perDimension skill scores, perQuestion breakdown, redFlags, ... } — see aviral-eval/types.ts / @interviehire/shared CandidateReport
```

Status codes: 200 OK; 500 on evaluation error (session not found, missing transcript, evaluator failure); 429 rate limited.

Notes: No Fastify schema. Response wraps the service return in { evaluation }. Exact fields defined by the dashboard contract and aviral-eval/types.ts.

#### GET /api/interview/sessions/:id/candidate-report

Returns the candidate-facing (redacted/summarized) version of the evaluation report for the session.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: none

Response:
```
200 OK (application/json)
{
  report: EvalCandidateFacingReport   // candidate-facing report from getCandidateFacingReport()
}
// shape defined by aviral-eval / evaluation.service.ts (candidate-safe summary subset)
```

Status codes: 200 OK; 500 on error; 429 rate limited.

Notes: No Fastify schema. Exact fields per EvalCandidateFacingReport type in evaluation.service.ts / aviral-eval/types.ts.

#### POST /api/interview/sessions/:id/report

Generates a PDF evaluation report for the session and returns the server filesystem path to the generated file.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: none (body ignored)

Response:
```
200 OK (application/json)
{
  filePath: string   // server-side path to the generated PDF (from generatePdfReport())
}
```

Status codes: 200 OK; 500 on generation error; 429 rate limited.

Notes: No Fastify schema. Returns a server path, not the binary; serve via GET /api/interview/uploads/:file if stored under uploads/.

#### POST /api/interview/sessions/:id/email-report

Emails the interview PDF report (existing reportUrl or freshly generated) as an attachment via SMTP/nodemailer to the company report email (fallback body.to).

- **Auth:** Public. Relies on SMTP_* env. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: application/json
```
{
  to?: string   // optional recipient; used only when session.company.reportEmail is falsy
}
```

Response:
```
200 OK (application/json)
{
  sent: true
}
```

Status codes: 200 OK; 500 'Session not found' (thrown) for unknown id; 500 on PDF generation or nodemailer/SMTP send failure; 429 rate limited.

Notes: No Fastify schema. Recipient = session.company.reportEmail || body.to. Uses nodemailer with SMTP_HOST/SMTP_PORT(587)/SMTP_USER/SMTP_PASS, from REPORT_FROM. Attaches '<candidate.fullName>-report.pdf'.

#### POST /api/interview/sessions/:id/transcript

Stores or upserts a browser speech-to-text transcript entry (one logical transcriptId) into session.transcript JSON, normalizing each segment to a candidate speech_to_text turn.

- **Auth:** Public. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: application/json
```
{
  transcriptId?: string,    // optional; trimmed; default 'browser-speech-recognition' (key for upsert)
  transcript?: Array<{      // segments; non-array → []
    text?: string,          // trimmed; empty segments dropped
    timestamp?: string      // ISO; default now()
  }>,
  fullText?: string,        // optional; default = segments' text joined by '\n'
  finalized?: boolean,      // stored as (finalized === true)
  createdAt?: string        // ISO; default now()
}
```

Response:
```
200 OK (application/json)
{
  stored: true,
  entry: {
    type: 'speech_to_text_transcript',
    source: 'speech_to_text',
    text: string,                 // fullText
    segments: Array<{ speaker:'candidate', text:string, timestamp:string, source:'speech_to_text' }>,
    sessionId: string,
    candidateId: string,
    transcriptId: string,
    finalized: boolean,
    createdAt: string (ISO),      // preserved on update
    updatedAt: string (ISO)
  }
}
```

Status codes: 404 'Session not found'; 400 'Transcript must contain at least one text segment' (no non-empty segments); 200 OK; 429 rate limited.

Notes: No Fastify schema. Upsert keyed by (type='speech_to_text_transcript' && transcriptId): existing entry merged (createdAt preserved), else appended. Does not replace other transcript entries.

#### POST /api/interview/sessions/:id/recording

Accepts a multipart audio/video recording upload, saves it under uploads/, attaches a recording metadata entry to session.transcript, and kicks off async transcription + question-fit processing.

- **Auth:** Public. Requires @fastify/multipart. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id
- **Query params:** none

Request: `multipart/form-data`
```
file: <binary>   // single file part (req.file()); part.filename optional, default 'recording.webm'. Missing → 400.
```

Response:
```
200 OK (application/json)
// session found:
{
  url: string,                    // '/uploads/<timestamp>-<filename>'
  entry: { type:'recording', filename:string, url:string, createdAt: Date }
}
// session NOT found (still 200):
{
  url: string,
  entry: { type:'recording', filename:string, url:string, createdAt: Date },
  note: 'session not found; recording stored but not linked'
}
```

Status codes: 400 'No file uploaded'; 200 OK (both session-found and not-found cases); 429 rate limited.

Notes: No Fastify schema. Saves to <cwd>/uploads/<Date.now()>-<filename>. Appends recording entry to transcript; fires processRecordingForSession(id, filename) async (errors logged). Returns 200 even when session is absent.

#### POST /api/interview/sessions/:id/answer-transcription

Accepts a multipart audio answer upload, saves it, transcribes it synchronously, and returns the transcribed text (does not attach to the session).

- **Auth:** Public. Requires @fastify/multipart. Global rate limit.
- **Path params:** `id`:string — InterviewSession.id (present in path but not used in handler body)
- **Query params:** none

Request: `multipart/form-data`
```
file: <binary>   // single file part (req.file()); part.filename optional, default 'answer.webm'. Missing → 400.
```

Response:
```
200 OK (application/json)
{
  text: string,        // transcription from transcribeUploadedFile()
  filename: string     // '<timestamp>-<filename>'
}
```

Status codes: 400 'No file uploaded'; 502 '<error message>' or 'Answer transcription failed' on transcription error; 200 OK; 429 rate limited.

Notes: No Fastify schema. Saves to <cwd>/uploads/. Synchronous transcription; failures → reply.code(502). Does not modify session.transcript.

#### GET /api/interview/uploads/:file

Streams a previously uploaded file (recording/answer/PDF) from the server uploads/ directory.

- **Auth:** Public. Global rate limit.
- **Path params:** `file`:string — filename within <cwd>/uploads/
- **Query params:** none

Request: none

Response:
```
200 OK (binary stream)
<file contents via fs.createReadStream>

404 Not Found (application/json)
{ error: 'Not found' }
```

Status codes: 200 OK (file stream); 404 'Not found' (file missing); 429 rate limited.

Notes: No Fastify schema. Path = path.join(process.cwd(),'uploads',file). No explicit Content-Type set; no path-traversal sanitization on :file.

### `interview-engine/apps/api/src/routes/transcript.routes.ts`

#### POST /api/interviews/{sessionId}/transcript/event

Ingest one or many live transcript events into the append-only event log. Best-effort: invalid/malformed events are skipped (never 500); returns stored/skipped counts so the client can detect and retry a fully-rejected batch.

- **Auth:** public (no preHandler, no API key, no auth check).
- **Path params:** `sessionId`:string — the interview session id (cuid)
- **Query params:** none

Request: No Fastify schema; body read untyped (req.body ?? {}). Accepts THREE shapes:
```
// 1) Single event object:
{
  speaker:     'candidate' | 'interviewer'   // required; any other value -> event skipped
  text:        string                        // required; trimmed/collapsed, empty -> skipped
  timestampMs?: number                       // optional; finite & >=0 used as-is (rounded); else derived from startedAt or 0
  source?:     'convai' | 'browser_stt' | 'whisper' | 'manual'   // optional; invalid -> 'manual'
  isFinal?:    boolean                       // optional; default true
  createdAt?:  string (ISO-8601)             // optional; default now()
}

// 2) Batch wrapper:
{ events: Array<event-object-as-above> }     // required non-empty after extraction

// 3) Bare JSON array:
[ event-object-as-above, ... ]
```
If the resolved event list is empty → 400. Per-event validation in recordEvents/normalizeEventInput; events failing speaker/text validation counted as skipped, not rejected.

Response: 200 OK (application/json)
```
{
  ok: true,
  stored: number,    // count of events actually persisted
  skipped: number    // rawEvents.length - stored
}
```

Status codes: 200 OK (may have stored:0 if all skipped); 400 Bad Request {"error":"No transcript events provided"} (empty event list); 404 Not Found {"error":"Interview session not found"} (unknown session id); 500 Internal Server Error {"error":"Failed to store transcript event"} (unexpected error).

Notes: Global rate limit (200/min). Calls recordEvents(sessionId, rawEvents) which upserts the InterviewTranscript metadata row (status 'recording'), normalizes each event, bulk-inserts via createMany, increments eventCount. Only the literal message 'Interview session not found' maps to 404.

#### POST /api/interviews/{sessionId}/transcript/audio

Upload an audio recording (one speaker's audio, whole interview or a chunk) and transcribe it server-side (Whisper/Deepgram ASR) into timestamped transcript events. This is how the Convai avatar's voice becomes interviewer transcript lines.

- **Auth:** public. Server-side transcription requires DEEPGRAM_API_KEY or OPENAI_API_KEY; without it returns 503.
- **Path params:** `sessionId`:string — the interview session id
- **Query params:** none

Request: `multipart/form-data` (via @fastify/multipart req.file()). No Fastify schema.
```
file     (binary)  required  — audio file part (saved to <cwd>/uploads/<ts>-<speaker>-<filename>); mimetype default 'audio/webm', filename default 'audio.webm'
speaker  (text)    optional  — 'candidate' | 'interviewer'; ONLY 'candidate' selects candidate, any other/absent → 'interviewer'
startMs  (text)    optional  — number; offset in ms applied to transcribed segment timestamps; non-numeric/absent → 0
```

Response: 200 OK (application/json), two success variants:
```
// speech transcribed:
{ ok: true, segments: number, stored: number, skipped: number }
// ASR returned no segments:
{ ok: true, stored: 0, note: 'No speech detected in the audio.' }
```
(stored/skipped from recordEvents; events recorded with source:'whisper', isFinal:true, timestampMs = segment.startMs)

Status codes: 200 OK; 400 Bad Request {"error":"No audio file uploaded"} (no file part); 404 Not Found {"error":"Session not found"} (unknown sessionId); 502 Bad Gateway {"error":<message|'Audio transcription failed'>, "stored":0} (transcription threw); 503 Service Unavailable {"error":"Server-side transcription is not configured. Set DEEPGRAM_API_KEY (or OPENAI_API_KEY) to transcribe interviewer audio.", "stored":0} (asrAvailable()===false).

Notes: Global rate limit + @fastify/multipart default limits. Writes file synchronously to <cwd>/uploads (created if missing) before transcribing. transcribeAudioSegments(dest, startMs, mimeType) returns segments {text, startMs}; each becomes a transcript event for the resolved speaker.

#### GET /api/interviews/{sessionId}/transcript

Read the current transcript: ordered raw events plus the InterviewTranscript metadata row. With ?text=1 (or text=true) it also returns the rendered .txt body, finalizing on demand if no file exists yet.

- **Auth:** public.
- **Path params:** `sessionId`:string — the interview session id
- **Query params:** `text`:string (optional) — when '1' or 'true', include the rendered .txt body under `text`; otherwise omitted.

Request: none

Response: 200 OK (application/json)
```
{
  sessionId: string,
  events: Array<{
    sessionId:   string,
    speaker:     'candidate' | 'interviewer',
    text:        string,
    timestampMs: number,
    source:      'convai' | 'browser_stt' | 'whisper' | 'manual',
    isFinal:     boolean,
    createdAt:   string   // ISO-8601
  }>,                       // ordered by timestampMs asc, then createdAt asc
  meta: {                  // InterviewTranscript row, or null if none yet
    id:                 string,
    sessionId:          string,
    candidateId:        string | null,
    interviewId:        string | null,
    transcriptFilePath: string | null,
    startedAt:          string | null,   // ISO-8601
    endedAt:            string | null,   // ISO-8601
    status:             string,          // 'recording' | 'finalized' | 'empty' | 'failed'
    eventCount:         number,
    createdAt:          string,          // ISO-8601
    updatedAt:          string           // ISO-8601
  } | null,
  text?: string            // present only when ?text=1/true AND a body could be produced
}
```

Status codes: 200 OK; 404 Not Found {"error":"Session not found"} (unknown sessionId).

Notes: Global rate limit. When text requested, reads meta.transcriptFilePath if on disk, else conventional transcriptFilePath(sessionId), else finalizeTranscript(sessionId) then reads. `text` omitted if none yield a file.

#### POST /api/interviews/{sessionId}/transcript/finalize

Finalize the transcript: gather events (event log, falling back to legacy session.transcript JSON only when no events exist), shape into clean ordered lines, write the .txt file, project turns into session.transcript, and update the InterviewTranscript metadata row.

- **Auth:** public.
- **Path params:** `sessionId`:string — the interview session id
- **Query params:** none

Request: none

Response: 200 OK (application/json) — FinalizeResult spread alongside ok:true
```
{
  ok: true,
  status:     'finalized' | 'empty',   // 'finalized' if lines produced, else 'empty'
  filePath:   string | null,           // absolute path to the written .txt
  lineCount:  number,                  // number of rendered transcript lines
  eventCount: number                   // total events considered (event log + legacy)
}
```

Status codes: 200 OK (status 'finalized' or 'empty'); 404 Not Found {"error":"Session not found"} (unknown sessionId at the route guard); 500 Internal Server Error {"error":"Transcript finalization failed", status:'failed', filePath:null, lineCount:0, eventCount:0} (finalizeTranscript returned status 'failed').

Notes: Global rate limit. finalizeTranscript writes a placeholder .txt even for an empty transcript. When lines exist it also overwrites session.transcript with projected turns {speaker:'ai'|'candidate', text, questionIndex, timestamp, source:'stt'} for the evaluator.

#### POST /api/interviews/{sessionId}/report

Finalize the transcript, then generate a CandidateReport by sending the WHOLE transcript to the LLM (suits Convai's dynamic questions). Falls back to the deterministic evaluator when no LLM key or on error so a report always returns.

- **Auth:** public. LLM path requires DEEPSEEK_API_KEY (and != 'replace-me'); otherwise falls through to the deterministic evaluator.
- **Path params:** `sessionId`:string — the interview session id
- **Query params:** none

Request: none

Response: 200 OK (application/json). `evaluation` is the normalized CandidateReport; `engine` indicates which path produced it.
```
{
  engine: 'transcript_llm' | 'deterministic',
  evaluation: {
    interviewId:   string,   // = sessionId
    candidateId:   string,
    roleTitle:     string,
    interviewType: 'mixed',
    overallScore:  number,   // 0-100
    recommendation: 'strong_proceed' | 'proceed' | 'hold' | 'reject' | 'needs_human_review',
    recommendationConfidence: 'high' | 'medium' | 'low',
    candidateConfidence: {
      score: number,         // 0-100
      level: 'high' | 'medium' | 'low',
      reliability: 'medium',
      summary: string
    },
    summary:    string,
    strengths:  string[],
    weaknesses: string[],
    redFlags: Array<{ label: string, severity: 'low'|'medium'|'high'|'critical', reason: string }>,
    skillScores: Array<{ skill: string, score: number, evidenceAnswerIds: string[] }>,
    questionBreakdown: Array<{
      answerId: string,
      questionId: string,
      questionText: string,
      questionOrigin: 'predetermined',
      evaluationMode: 'model_answer_based',
      overallScore: number,    // 0-100
      modelAnswerComparison: { score: number, alignment: 'partial'|'missing', matchedPoints: string[], missedPoints: string[], notes: string },
      dimensionScores: {},
      strengths: string[],
      weaknesses: string[],
      redFlags: [],
      followUpRecommendations: [],
      evaluationConfidence: 'medium',
      summary: string,
      transcriptOnly: true
    }>,
    suggestedNextSteps: string[],
    transcriptOnly: true,
    futureSignalPlaceholders: { audioAnalysisEnabled: false, videoAnalysisEnabled: false },
    proctoringSummary: { eventCount: number, criticalOrHighCount: number },
    reportEngine: 'transcript_llm'
  }
}
```
When engine is 'deterministic', `evaluation` is whatever evaluateInterview(sessionId) returns (the canonical EvalCandidateReport from the Aviral evaluator), conforming to the same CandidateReport contract but not constructed in this module.

Status codes: 200 OK (engine 'transcript_llm' or 'deterministic'); 404 Not Found {"error":"Session not found"} (unknown sessionId at the route guard); 500 Internal Server Error {"error":<message|'Report generation failed'>} (both LLM report and deterministic fallback threw).

Notes: Global rate limit. Always calls finalizeTranscript(sessionId) first. Tries generateTranscriptReport (DeepSeek); on any error logs a warning and tries evaluateInterview; only if BOTH fail does it 500. The LLM report path persists the report onto session.evaluation and sets session.status='EVALUATED'.

#### GET /api/interviews/{sessionId}/transcript/file

Download the finalized transcript as a .txt attachment, finalizing on demand if the file does not yet exist.

- **Auth:** public.
- **Path params:** `sessionId`:string — the interview session id
- **Query params:** none

Request: none

Response: 200 OK — streamed plain-text file (NOT JSON).
```
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="<sessionId>.txt"
<.txt body: header (Interview Transcript / Session ID / Candidate ID / Started At / Ended At) followed by lines '[HH:MM:SS] Candidate|Interviewer: text', or '(No transcript was captured for this interview.)'>
```

Status codes: 200 OK (file streamed); 404 Not Found {"error":"Transcript not available"} (file missing and finalize produced no readable file). No explicit session-existence guard — a missing session yields finalize status 'failed' → 404.

Notes: Global rate limit. If transcriptFilePath(sessionId) does not exist it calls finalizeTranscript(sessionId) and serves the produced file; if that path is null/absent returns 404. Streams via fs.createReadStream.

### `interview-engine/apps/api/src/server.ts`

#### GET /health

Health/liveness check. The only route attached directly to the Fastify server instance; all other routes live inside registered route modules and the websocket gateway.

- **Auth:** none (public)
- **Path params:** none
- **Query params:** none

Request: none

Response:
```json
{
  "ok": true,
  "service": "interviehire-api"
}
```

Status codes: 200 OK.

Notes: No global prefix at the server level — `/health` is served at root. Per-module prefixes applied at registration: companyRoutes → /api/company, interviewRoutes → /api/interview, transcriptRoutes → /api/interviews, assistantRoutes → /api/assistant; registerWebsocket(app) adds WS routes. Server-level config: CORS { origin: true, credentials: true }; rate limit { max: 200, timeWindow: '1 minute' }; @fastify/multipart and @fastify/websocket registered. Listens on host 0.0.0.0, port from process.env.PORT or 4000. dotenv loads ../../../.env relative to the compiled server dir. There is NO root "/" route.

---

## Dashboard — Next route handlers

### `dashboard/app/api`

#### POST /api/parse-file

Parse an uploaded resume/document file (.pdf/.docx/.txt) server-side and return its extracted plain text. Runs on the Node.js runtime (force-dynamic). Max file size 5 MB.

- **Auth:** none (no auth check in handler)
- **Path params:** none
- **Query params:** none

Request: `multipart/form-data`
```
FormData fields:
  file: File (required) — extension must end in .pdf, .docx, or .txt (case-insensitive). file.size <= 5 MB (5*1024*1024 bytes).
```
No JSON body. Read via request.formData(); only the `file` field is consulted.

Response:
```
// 200 OK (success)
{ "text": string }   // extracted text, trimmed

// 400 no file
{ "error": "No file provided" }

// 413 too large
{ "error": "File too large (max 5 MB)" }

// 400 unsupported type
{ "error": "Unsupported file type. Use .pdf, .docx, or .txt" }

// 500 parse failure
{ "error": "Failed to parse file", "detail": string|undefined }
// detail is error.message in non-production; undefined when NODE_ENV === 'production'
```

Status codes: 200 OK; 400 no file provided; 400 unsupported file type; 413 file > 5 MB; 500 parse error (catch-all).

Notes: .pdf parsed via pdf-parse (PDFParse class, with @napi-rs/canvas DOM polyfills + pdfjs legacy worker; falls back to default pdf-parse fn). .docx parsed via mammoth.extractRawText. .txt read as utf-8. Only POST is exported. runtime='nodejs', dynamic='force-dynamic'.

#### POST /api/fetch-doc

Fetch a remote/shared document by URL (Google Docs/Sheets/Drive links normalized to export/download URLs), download it, and return extracted plain text. Max 8 MB.

- **Auth:** none (no auth check in handler)
- **Path params:** none
- **Query params:** none

Request: `application/json`
```
{
  "url": string (required)  // document URL; must be a non-empty string
}
```
Google Docs (/document/d/<id>) → exported as txt; Google Sheets (/spreadsheets/d/<id>) → exported as csv; Google Drive (/file/d/<id> or ?id=) → uc?export=download; any other URL fetched as-is.

Response:
```
// 200 OK (success)
{ "text": string }   // extracted text, whitespace-collapsed and trimmed

// 400 missing/invalid url type
{ "error": "No url provided" }

// 400 unparseable url
{ "error": "Invalid URL" }

// 502 upstream fetch not ok
{ "error": "Could not fetch document (HTTP <status>)." }

// 413 too large
{ "error": "Document too large (max 8 MB)." }

// 422 empty extraction
{ "error": "No readable text found in the document." }

// 500 catch-all (includes private-doc detection)
{ "error": string }   // error.message or "Failed to fetch document"
```

Status codes: 200 OK; 400 no url provided / url not a string; 400 invalid URL (URL constructor throws); 502 remote fetch returned non-2xx; 413 downloaded body > 8 MB; 422 no readable text after extraction; 500 any thrown error (e.g. private Google doc → message 'Document is not publicly accessible — set sharing to "Anyone with the link".', or 'PDF parser unavailable').

Notes: Content-type-driven extraction: application/pdf → pdf-parse (with @napi-rs/canvas polyfills); wordprocessingml/msword → mammoth.extractRawText; otherwise utf-8 string. For text/html it strips <style> and tags, and detects Google sign-in/permission pages (accounts.google.com|request access|need permission|sign in to continue) → throws → 500. Outbound fetch uses redirect:follow and a custom User-Agent. Only POST exported. runtime='nodejs', dynamic='force-dynamic'.

#### POST /api/deepseek

Server-side proxy to DeepSeek chat completions (https://api.deepseek.com/v1/chat/completions) that injects the server's DEEPSEEK_API_KEY, enforces per-IP rate limiting and prompt-size caps, restricts the model to an allowlist, and returns DeepSeek's raw response passed through.

- **Auth:** none (no user auth); requires server env DEEPSEEK_API_KEY, else 500. Per-IP rate limit 120 req / 60s (x-forwarded-for first hop, else x-real-ip, else 'unknown').
- **Path params:** none
- **Query params:** none

Request: `application/json`
```
{
  "messages": Array<{ role: string, content: string }> (required)  // must be an array; max 30 items; total content chars <= 50000
  "jsonMode": boolean (optional)        // if truthy, sets response_format = { type: 'json_object' } upstream
  "model": string (optional)            // allowlist: 'deepseek-v4-pro' | 'deepseek-v4-flash'; any other/missing → 'deepseek-v4-flash'
  "temperature": number (optional)      // used only if number in [0,2]; otherwise defaults to 0.7
}
```
Forwarded upstream payload: { model: <allowlisted model>, messages, temperature, max_tokens: 4096, [response_format if jsonMode] }.

Response:
```
// 200 (or upstream status) success — DeepSeek response passed through verbatim, e.g.:
{
  "id": string,
  "object": "chat.completion",
  "created": number,
  "model": string,
  "choices": [ { "index": number, "message": { "role": string, "content": string }, "finish_reason": string } ],
  "usage": { "prompt_tokens": number, "completion_tokens": number, "total_tokens": number }
}
// NOTE: body and HTTP status are exactly whatever DeepSeek returns (NextResponse.json(data, { status: upstream.status })).

// 500 missing key
{ "error": "DEEPSEEK_API_KEY environment variable is not set on the server." }

// 429 rate limited
{ "error": "Rate limit exceeded. Try again shortly." }

// 400 messages not array
{ "error": "messages must be an array" }

// 400 too many messages
{ "error": "Too many messages (max 30)" }

// 413 prompt too large
{ "error": "Prompt too large" }

// 502 upstream unreachable / json parse error
{ "error": "Failed to reach DeepSeek API", "detail": string }
```

Status codes: 200 (and any upstream status from DeepSeek passed through on success); 500 DEEPSEEK_API_KEY not set; 429 per-IP rate limit (>120/60s) exceeded; 400 messages missing/not an array; 400 messages.length > 30; 413 total content chars > 50000; 502 fetch to DeepSeek threw / response not JSON.

Notes: In-memory sliding-window rate limiter keyed by client IP (resets on cold start; per warm instance only). Model allowlist hard-blocks arbitrary model strings against the paid key. runtime='nodejs' (no force-dynamic export). Only POST exported.

---

## WebSocket Endpoints

### Backend — FastAPI: WS /ws

Realtime dashboard WebSocket. Router mounted with **NO prefix** (`app.include_router(websocket_router)`), so the full path is **`/ws`** (NOT under `/api`). On connect the client is placed in a hardcoded `room_id="global"` and immediately receives a welcome message. A background task (`mock_stream.generate_mock_events`, started in the router's `on_event("startup")`) broadcasts a random `candidate_update` to the global room every 5-10 seconds.

- **Auth:** none (no token, cookie, or auth check; no query/path params parsed on handshake)
- **Path params:** none
- **Query params:** none

Client → server: text frames, each a JSON object.
```
{
  "type": string (required),   // "ping" | "echo" | "broadcast"
  "content": string (optional) // used by "echo" and "broadcast"; defaults to "" if absent
}
```
Behavior by type:
```
// ping  -> server replies pong (content ignored)
{ "type": "ping" }
// echo  -> server replies echo with "Echo: <content>"
{ "type": "echo", "content": "hello" }
// broadcast -> server broadcasts to all clients in "global" room
{ "type": "broadcast", "content": "hello" }
// any other type -> ErrorMessage code 4001
{ "type": "<anything-else>" }
```
Non-JSON / malformed payload → ErrorMessage code 4000.

Server → client: text frames, JSON serialized from Pydantic models.
```
// OutgoingMessage (welcome / pong / echo / broadcast / candidate_update)
{
  "type": string,            // "welcome" | "pong" | "echo" | "broadcast" | "candidate_update"
  "content": string,
  "timestamp": string,       // ISO-8601 UTC, auto-generated
  "sender": string | null
}

// on connect (to the connecting client only)
{ "type": "welcome", "content": "Connected to IntervieHire server", "timestamp": "...", "sender": null }
// reply to ping
{ "type": "pong", "content": "", "timestamp": "...", "sender": null }
// reply to echo
{ "type": "echo", "content": "Echo: hello", "timestamp": "...", "sender": null }
// reply to broadcast (to ALL clients in room "global")
{ "type": "broadcast", "content": "hello", "timestamp": "...", "sender": "Client" }
// background mock stream, every 5-10s
{ "type": "candidate_update", "content": "<Candidate> moved to <Stage>", "timestamp": "...", "sender": "System" }

// ErrorMessage
{
  "type": "error",
  "code": int,        // 4001 unknown message type; 4000 invalid JSON payload
  "content": string,  // e.g. "Unknown message type: <type>" or "Invalid JSON payload"
  "timestamp": string
}
```

Status codes: connection accepted on connect (manager.connect). App-level error frames carry code 4001 (unknown message type) and 4000 (invalid JSON). On WebSocketDisconnect the client is removed from the global room.

Notes: room_id hardcoded to "global" — no per-session/per-room routing, no session id, no authentication. No plain HTTP routes in this file.

### Interview Engine — Fastify: WS /ws

Single WebSocket gateway for live interviews, shared by both candidate-room clients and the UE5 avatar. Mounted via `registerWebsocket(app)` → `app.get('/ws', { websocket: true }, ...)` at the **ROOT** — NO prefix (NOT under `/api`). Full URL: `ws(s)://<api-host>:4000/ws`. Client configures via `NEXT_PUBLIC_WS_URL` (e.g. `wss://.../ws`). After connecting a client MUST send a `register` message declaring its role and sessionId. The server keeps two in-memory Maps (sessionId → socket): `candidates` and `ueClients`, routing messages between a candidate and its paired UE5 avatar. Candidate transcripts are fed to `handleCandidateTranscript`; the reply is pushed to the UE5 avatar as `avatar_speak` and mirrored to the candidate as `ai_response`. Proctoring events are persisted to the proctoringLog table. On socket close the socket is removed from both Maps.

- **Auth:** none (no auth/token check; identity self-declared via register message)
- **Path params:** none
- **Query params:** none (sessionId/role travel inside the register message body, not the URL)

All frames are JSON text: `socket.send(JSON.stringify(payload))`. Each message discriminated by `type`. Unrecognized `type` is silently ignored. Any error thrown while handling a message yields an `error` reply.

**Client → server messages:**
```
// 1. register (BOTH candidate and ue5 clients; required first message)
{
  "type": "register",            // literal, required
  "role": "candidate" | "ue5",   // required — routing key
  "sessionId": string            // required — map key pairing candidate <-> avatar
}

// 2. candidate_transcript (sent by candidate)
{
  "type": "candidate_transcript",         // literal, required
  "sessionId": string,                    // required
  "text": string,                         // required — candidate's answer
  "timestamp": number,                    // required (epoch ms)
  "speaker?": "candidate",                // optional literal
  "source?": "typed" | "speech_to_text",  // optional
  "latencyMs?": number,                   // optional — forwarded as metrics.latencyMs
  "wpm?": number                          // optional — forwarded as metrics.wpm
}

// 3. avatar_status (sent by ue5 avatar; forwarded verbatim to candidate)
{
  "type": "avatar_status", // literal, required
  "sessionId": string,     // required
  "isSpeaking": boolean    // required
}

// 4. proctoring_event (sent by candidate)
{
  "type": "proctoring_event",                          // literal, required
  "sessionId": string,                                  // required
  "eventType": string,                                  // required
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", // required
  "metadata": Record<string, unknown>,                  // required (stored as JSON)
  "timestamp": number                                   // required (epoch ms) -> occurredAt
}
```

**Server → client messages:** sent only when socket.readyState === 1 (OPEN). If the target peer is not registered, that side receives nothing.
```
// 1. registered (reply to register; to the registering socket)
{ "type": "registered", "role": "candidate" | "ue5", "sessionId": string }

// 2. avatar_speak (to the ue5 socket after candidate_transcript)
{
  "type": "avatar_speak",
  "sessionId": string,
  "text": string,
  "interviewPhase": "greeting" | "questioning" | "follow_up" | "closing",
  "emotionState": "neutral" | "encouraging" | "curious" | "serious"
}

// 3. ai_response (to the candidate socket after candidate_transcript) — same payload minus original type
{
  "type": "ai_response",
  "sessionId": string,
  "text": string,
  "interviewPhase": "greeting" | "questioning" | "follow_up" | "closing",
  "emotionState": "neutral" | "encouraging" | "curious" | "serious"
}

// 4. avatar_status (forwarded VERBATIM to the candidate socket)
{ "type": "avatar_status", "sessionId": string, "isSpeaking": boolean }

// 5. proctoring_ack (reply to proctoring_event; to the candidate socket)
{ "type": "proctoring_ack", "eventType": string }

// 6. error (to the originating socket when handling any message throws)
{ "type": "error", "message": string }   // error.message, or "WebSocket error" fallback
```

Status codes: WS upgrade via @fastify/websocket (HTTP 101 on success). No per-message status codes; failures surfaced as a `{type:'error', message}` JSON frame. Connection cleanup on 'close': socket removed from both `candidates` and `ueClients` Maps.

Notes: In-memory Maps keyed by sessionId (not persisted; server restart drops all pairings). Only one socket per (role, sessionId): re-registering overwrites the previous socket. Rate limiting (max 200/min) applies at the HTTP layer. CORS origin:true, credentials:true. ws.ts defines only WsRole and RegisterMessage; the candidate_transcript / avatar_speak / avatar_status / proctoring_event payload types live in @interviehire/shared.
