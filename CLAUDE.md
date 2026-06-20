# CLAUDE.md — IntervieHire engineering guide

Guidance for Claude (and humans) working in this repo. Read this before editing.

## What this is

IntervieHire is an AI-driven hiring platform. Recruiters author rubric-graded
interview blueprints, an AI avatar runs the interview, and candidates are scored
against the recruiter's own rubric into a structured `CandidateReport`.

The product is **three services over one shared Supabase/Postgres database**:

| Component | Dir | Stack | Port | Role |
|-----------|-----|-------|------|------|
| Recruiter dashboard | `dashboard/` | Next.js (App Router) + vanilla-JS module engine in `src/dashboard/` | 3000 | Job pipelines, Blueprint Studio, Deep Analysis. Source of truth for the `CandidateReport` shape. |
| AI interview engine | `interview-engine/` | Fastify API + Next.js candidate room + Aviral eval engine | 4000 (api) / 3001 (web) | Runs the interview, scores answers with DeepSeek (falls back to deterministic evaluator with no key). npm workspaces monorepo. |
| Backend | `backend/` | FastAPI + SQLAlchemy over Supabase Postgres | 8000 | Jobs, applicants, auth (email+password, bcrypt, 7-day JWT httpOnly cookie). Bridges blueprints → engine and serves reports back. |

Data flow: dashboard authors blueprint → FastAPI persists + syncs questions/rubric
into the engine's tables → candidate room collects answers → Aviral engine grades
vs rubric → `CandidateReport` flows back → Deep Analysis renders it.

## Architecture rules (do not break these)

- **The shared DB is the contract.** Backend mirrors the engine's tables. A schema
  change in one service must be reflected in the others.
- **The dashboard defines `CandidateReport`.** Engine and backend conform to it,
  never the reverse.
- **Secrets live only in `.env` files** (gitignored). Never commit keys or DB URLs.
  Each component has a `.env.example` — copy to `.env` (`.env.local` for dashboard).
- **Zero-key path must keep working.** No `DEEPSEEK_API_KEY` → deterministic
  evaluator. A typed text interview needs no paid voice keys. `/interview` self-seeds
  a demo session via `GET /api/interview/demo-session`.

## Component conventions

### `dashboard/`
- Next.js App Router shell (`app/`) mounts a **vanilla-JS module engine** in
  `src/dashboard/` (no React inside the dashboard surface — DOM string templates +
  manual event wiring). Match this style: `buildXPanel()` returns an HTML string,
  a paired `bindXPanel()` attaches listeners after `innerHTML` is set. **If you add
  a build function, you must call its bind function** — see the Add Applicants
  feature for the canonical pattern (and the bug where the bind was forgotten).
- `api.js` maps backend snake_case ⇄ dashboard camelCase (`mapApplicantOutToCandidate`).
  Use `request()` for JSON; use raw `fetch` for `FormData`/multipart (the helper
  forces `Content-Type` and breaks uploads).
- Data source toggles between localStorage and live backend: `IHApi.setDataSource('api')`.
- Always escape user content with `escapeHTML()` when building template strings.
- Backend base URL: `NEXT_PUBLIC_API_URL`. Engine web URL: `NEXT_PUBLIC_ENGINE_WEB_URL`.

### `backend/` (FastAPI)
- Models in `app/models/`, routes in `app/routers/`, helpers in `app/utils/`.
- Applicants have per-stage status columns: `screening_status`, `functional_status`
  (nullable `InterviewStatus` enum). `ApplicantSource` enum: `bulk_upload`,
  `direct_link`, `scheduled`, `ats`, `functional`. Source drives which stage a new
  applicant lands in (`scheduled` → screening pending, `functional` → functional pending).
- Run: `python -m uvicorn main:app --port 8000 --reload` (venv activated, requirements installed).
- Seed admin + demo: `python seed.py` (super_admin is `admin@interviehire.com`).

### `interview-engine/` (npm workspaces)
- `apps/api` — Fastify + Prisma. Aviral evaluator at `apps/api/src/aviral-eval/`:
  builds a rubric-grounded prompt per answer, asks DeepSeek to grade, validates,
  aggregates a canonical `CandidateReport` (overall score, recommendation,
  per-dimension skill scores, per-question breakdown, red flags).
- `apps/web` — Next.js candidate room (`/interview`, `/interview/avatar`). Proctoring
  (gaze/face/object) + voice optional.
- `packages/shared` — `@interviehire/shared`. **Build it first**: `npm run build -w packages/shared`.
- Setup: `npm install` → build shared → `npm run db:generate -w apps/api` → `npm run dev`.
- Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` (wss .../ws), `NEXT_PUBLIC_AVATAR_URL`.

## Deployment (see DEPLOY.md for the full runbook)

- Front-ends → **Vercel** (candidate room → `interviehire.com`, dashboard → `app.interviehire.com`).
- Backend + engine + Postgres → **Render** (one Blueprint from `render.yaml`).
- Avatar (UE5 Pixel Streaming) → your PC + Cloudflare named tunnel → `avatar.interviehire.com`.
- Cross-site auth cookie needs `SameSite=None; Secure` (`COOKIE_SAMESITE`/`COOKIE_SECURE`).

## Working agreements

- Make the smallest change that satisfies the task; match surrounding style exactly.
- Touching the DB shape or `CandidateReport`? Update all three services + note it here.
- Commit/push only when asked. Branch off `master` first if asked to commit.
- Verify before claiming done: backend → import/route check; dashboard → the bind is
  actually called; engine → `npm run build -w packages/shared` still passes.

## Known in-flight work

- **Add Applicants upload panel** (uncommitted): backend accepts `?source=` on
  `POST /jobs/{id}/applicants/upload-resumes` ✓; dashboard `buildAddApplicantsPanel`
  renders ✓; **`bindAddApplicantsPanel` is defined but never called** ✗ → panel is inert.
  See `plan.md`.
