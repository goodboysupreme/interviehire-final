# intervieHire — 3-Repo MVP Stitch Plan

How the three repos converge into one working product. Authored from a full
map of all three (June 2026).

## The three pieces

| Repo | Owner | Role today | Role in MVP |
|------|-------|-----------|-------------|
| `interviehire-3d` | Vansh (goodboysupreme) | Recruiter dashboard UI — job mgmt, **Interview Blueprint Studio**, pipeline, **Deep Analysis**. localStorage only. | **Recruiter portal** (canonical recruiter UI) |
| `interviehire_dashboard` | Krishna | FastAPI (`:8000`) + Node/Fastify AI engine (`:4000`, VAPI+OpenAI+ElevenLabs+Deepgram) + Supabase + a Next interview runner (`frontend-final-final/app/interview`, proctoring) | **Backend + candidate interview runner** |
| `IntervieHire @ interviehire-2.0` | Aviral | Canonical **evaluation engine + methodology** (`evaluation/`), plus a reference `apps/api`+`apps/web` | **Evaluation library of record** |

There is redundancy to collapse: **3 frontends** (Vansh dashboard, Krishna `frontend-final-final`, Aviral `apps/web`) and **2–3 backends** (Krishna FastAPI+Node, Aviral `apps/api`). The MVP picks one of each lane.

## Recommended target architecture

```
Recruiter (Vansh interviehire-3d)  ──HTTP──┐
                                            ├─►  Krishna FastAPI :8000  ──►  Supabase (Postgres)
Candidate (Krishna interview runner) ──────┘            │  (jobs, applicants, scheduling, calendar, webhooks, auth)
                                                         │
                                          Krishna Node :4000 (VAPI interview + EVALUATION)
                                                         │  evaluation = Aviral's evaluation/ library
                                                         ▼
                                              CandidateReport (Aviral contract)
```

- **One backend stack:** Krishna's FastAPI (gateway/data) + Node (AI/interview/eval). Drop Aviral's `apps/api` and `apps/web` (reference only).
- **Evaluation of record:** Aviral's `evaluation/` library, run inside Krishna's Node engine — replacing Node's current eval with the canonical `CandidateReport` pipeline.
- **Two thin frontends, one backend:** recruiter = Vansh's dashboard; candidate = Krishna's interview runner. Both hit FastAPI.

> **DECISION (locked, 2026-06-13):** the recruiter frontend stays `interviehire-3d` as its own app, wired to Krishna's backend via an API client layer — NOT ported into `frontend-final-final`. Least rework, Vansh's UI leads, fastest to MVP. Candidate interview runs from Krishna's runner. Revisit frontend consolidation only after the end-to-end loop works.

## Canonical contracts (freeze these)

- **Question authoring →** `job.screening_questions: string[]` + `job.functional_parameters: { topics:[{name,type,difficulty,questions:string[], questionsDetailed:[{text,questionType,difficulty,estimatedMinutes,aiEvaluationGuidance}]}] }`. The dashboard already emits exactly this (`blueprint-engine.toFunctionalParameters`).
- **`aiEvaluationGuidance` (per question, stringified JSON):** `{questionType, modelAnswer, rubric:{requiredPoints[{id,description,keywords[],weight}], secondaryPoints[], excellentAnswerSignals: string[], redFlags[{id,description,severity}]}}`.
- **Evaluation output →** Aviral's `CandidateReport` (`evaluation/types.ts`). The dashboard Deep Analysis already renders this shape.

## End-to-end data flow (target)

1. Recruiter creates a job + authors the blueprint in the Studio → dashboard `PATCH /api/jobs/{id}/parameters` with `screening_questions` + `functional_parameters` (incl. `questionsDetailed`).
2. Recruiter schedules a candidate → FastAPI `POST /applicants/{id}/schedule` → `sync_applicant_to_ai()` creates `Company/JobRole/Candidate/InterviewSession/Question` rows, **reading `questionsDetailed` so `aiEvaluationGuidance` is preserved** (not regenerated generically).
3. Candidate opens the emailed link → Krishna's interview runner → Node `/sessions/:id/start`, VAPI conducts the interview, transcript captured.
4. On completion → Node runs **Aviral's evaluation** over the transcript + each question's `aiEvaluationGuidance` → produces a `CandidateReport`, stores it on `InterviewSession.evaluation`, posts the completion webhook to FastAPI.
5. Recruiter opens **Deep Analysis** → dashboard `GET /applicants/{id}/functional-vetting` (or a `/sessions/{id}/report` endpoint) returns the `CandidateReport` → renders it. (Swap `buildSampleCandidateReport` for the fetch.)

## Per-repo work

### A. Dashboard (`interviehire-3d`) — Vansh
- Add an **API client layer** (`src/dashboard/api.js`) behind a flag: `DATA_SOURCE = 'api' | 'local'`. When `api`, replace the localStorage read/writes with FastAPI calls; keep local as the offline/demo fallback (mirrors the keyless generation fallback already shipped).
- Map: jobs CRUD, `PATCH .../parameters` (already-shaped payload), candidates list, `GET .../functional-vetting` → `CandidateReport` for Deep Analysis.
- Auth: JWT from FastAPI `/api/auth/login`; store + attach bearer.
- Build/deploy: this app is the recruiter portal; the interview link points at the candidate runner's URL.

### B. Backend (`interviehire_dashboard`) — Krishna
- `ai_sync.py`: read `functional_parameters.topics[].questionsDetailed[]` → populate `Question.aiEvaluationGuidance` from the authored rubric (don't regenerate); `.upper()` the `Easy|Medium|Hard` difficulty for the Prisma enum; add a `questionType` column to `Question`.
- Node eval: replace the current evaluator with **Aviral's `evaluation/` pipeline**; emit Aviral's `CandidateReport`; have `normalizeRubricPoints` accept **string** `excellentAnswerSignals`.
- Persist the full `CandidateReport` (incl. `questionBreakdown`) on `InterviewSession.evaluation`; expose it via the vetting/report endpoint.
- Normalize transcript → `{questionId, answerId, text, ts}` so per-question evaluation is reliable (today it's a flat array — the main gap).

### C. Evaluation (`IntervieHire@2.0`) — Aviral
- Package `evaluation/` as the importable library Krishna's Node consumes (it's already structured for this).
- Confirm the `CandidateReport` shape is frozen; align Krishna's existing types to it (field-name parity: `modelAnswerComparison.coveredRequiredPoints/missedRequiredPoints`, etc.).
- Provide rubric-extraction so a question's `modelAnswer` → `requiredPoints/bonusPoints/redFlags` if not authored (fallback only — the Studio now authors these directly).

## Phased wiring (incremental, each phase verifiable)

1. **Freeze contracts** — agree the three frozen shapes above across all three owners. (Doc + sign-off.)
2. **Backend reads authored rubrics** — Krishna: `ai_sync` ingests `questionsDetailed`; Node eval = Aviral's lib emitting `CandidateReport`. Verify with one seeded interview end-to-end (API-level).
3. **Dashboard API layer (read)** — Vansh: behind the flag, fetch jobs + candidates + `CandidateReport` from FastAPI; Deep Analysis renders live data. Studio still local. Verify Deep Analysis against a real evaluated session.
4. **Dashboard API layer (write)** — Studio `PATCH .../parameters`; scheduling triggers sync. Verify a blueprint authored in the dashboard drives a real interview.
5. **Candidate runner join** — point the emailed interview link at Krishna's runner; full loop: author → schedule → interview → evaluate → Deep Analysis.
6. **Deploy** — recruiter portal + candidate runner + backend; env/secrets (DEEPSEEK, VAPI, Supabase, calendar) per repo. (Recruiter portal deploy target: Vercel, per existing `vercel.json`.)

## Risks / coordination

- **Transcript→question pairing** is absent in the backend — phase 2 blocker; Krishna owns it.
- **Two eval implementations** (Krishna's existing + Aviral's canonical) must converge to ONE `CandidateReport` shape — decide Aviral's is authoritative; Krishna adopts.
- **Auth + multi-tenant** (Company/Organisation) must be consistent dashboard ↔ backend.
- Coordination matrix: Vansh = dashboard API layer; Krishna = sync + eval wiring + transcript normalization + endpoints; Aviral = eval library + contract freeze.

## What Vansh can do unilaterally now (no coordination)
- Build the dashboard **API client layer behind the `local|api` flag** — fully testable against a local/mocked FastAPI, ships dark, flips on when the backend is ready. This is the highest-leverage next build and needs nothing from Krishna/Aviral.
