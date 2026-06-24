# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Repo root:** this file lives at the repository root
> (`.../Desktop/interviehire-final/`), alongside `.git`, `backend/`, `dashboard/`,
> `interview-engine/`, and `api.md`. (A previously redundant nested
> `interviehire-final/interviehire-final/` wrapper was flattened away so the working
> directory equals the project root.)

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

## `api.md` is a living API contract — keep it current (MANDATORY)

The repo root contains **`api.md`**, the single source of truth for every HTTP and
WebSocket endpoint across `backend/` (FastAPI, mounted under `/api/*`),
`interview-engine/apps/api` (Fastify), and `dashboard/app/api` (Next route handlers).
It is **non-optional documentation** and must never drift from the code.

**Required structure of `api.md` (in this exact order):**
1. **Changelog** at the very top — a sequential, append-only log, newest entry first.
   Every entry records the date, the route(s) touched, and what changed
   (added / modified / refactored / removed). Never rewrite history; only append.
2. **Endpoint reference** immediately below the changelog — for every route, the
   **exact request and response schemas**: HTTP method + full path, auth requirement,
   path/query params, request body schema (field names, types, required/optional,
   enums, defaults), success response schema, and error/status codes. Schemas must
   match the code verbatim (FastAPI Pydantic models / Fastify JSON schemas / route
   handler bodies).

**Enforcement (do not skip):**
- **Any time an API route is added, modified, refactored, or removed, `api.md` MUST
  be updated in the same unit of work.** An API change is not "done" until `api.md`
  reflects it — treat it as part of the definition of done, not a follow-up.
- **Spin up a dedicated sub-agent** whose sole responsibility is to bring `api.md`
  back in sync: append the changelog entry and update the affected request/response
  schemas. Run it in parallel with (or immediately after) the code change.
- When unsure about a schema, read the actual Pydantic/Fastify/handler definition —
  never guess field names or types.

## Component conventions

### `dashboard/`
- Next.js App Router shell (`app/`) mounts a **vanilla-JS module engine** in
  `src/dashboard/` (no React inside the dashboard surface — DOM string templates +
  manual event wiring). Match this style: `buildXPanel()` returns an HTML string,
  a paired `bindXPanel()` attaches listeners after `innerHTML` is set. **If you add
  a build function, you must call its bind function** — a `build*` whose `bind*` is
  never invoked produces an inert (unclickable) panel. `job-detail-panes.js` is the
  canonical reference: every `buildAddApplicantsPanel` is followed by a
  `bindAddApplicantsPanel(...)` call.
- `api.js` maps backend snake_case ⇄ dashboard camelCase (`mapApplicantOutToCandidate`).
  Use `request()` for JSON; use raw `fetch` for `FormData`/multipart (the helper
  forces `Content-Type` and breaks uploads).
- Data source toggles between localStorage and live backend: `IHApi.setDataSource('api')`.
- Always escape user content with `escapeHTML()` when building template strings.
- Backend base URL: `NEXT_PUBLIC_API_URL`. Engine web URL: `NEXT_PUBLIC_ENGINE_WEB_URL`.
- Server-side document parsing runs in Next route handlers under `app/api/`
  (`parse-file` uses mammoth/pdf-parse/xlsx; `fetch-doc`) — distinct from the
  backend's `app/utils/resume_parser.py`.
- Commands: `npm run dev` / `build` / `start` (Next 16, React 19). No `lint` script.

### `backend/` (FastAPI)
- Models in `app/models/`, routes in `app/routers/`, helpers in `app/utils/`,
  config in `app/config.py` (`settings`). Routers are mounted in `main.py` and **all
  live under the `/api` prefix** (`/api/auth`, `/api/jobs`, `/api/team`,
  `/api/organisation`, `/api/usage`, `/api/settings`, `/api/deepseek`, `/api/public`,
  `/api/leaderboard`) plus the WebSocket routes from `app/websocket_routes.py`.
- **Schema migrations are hand-rolled, not Alembic.** `main.py:init_db()` runs at
  startup (via lifespan, non-fatal) and applies idempotent
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements after `Base.metadata.create_all`.
  **When you add a column to a model, add a matching `ADD COLUMN IF NOT EXISTS` line
  in `init_db()`** — otherwise existing deployed databases never get the column.
- Applicants have per-stage status columns: `screening_status`, `functional_status`
  (nullable `InterviewStatus` enum). `ApplicantSource` enum: `career_page`,
  `bulk_upload`, `direct_link`, `scheduled`, `ats`, `functional`. Source drives which stage a new
  applicant lands in (`scheduled` → screening pending, `functional` → functional pending).
- Run: `python -m uvicorn main:app --port 8000 --reload` (venv activated, requirements installed).
- Seed admin + demo: `python seed.py` (super_admin is `admin@interviehire.com`).
  Raw SQL schema/seed also in `db/schema.sql` and `db/seed.sql`.
- No configured linter/test runner; verify with an import/route check
  (`python -c "import main"`).

### `interview-engine/` (npm workspaces)
- `apps/api` — Fastify + Prisma. Aviral evaluator at `apps/api/src/aviral-eval/`:
  builds a rubric-grounded prompt per answer, asks DeepSeek to grade, validates,
  aggregates a canonical `CandidateReport` (overall score, recommendation,
  per-dimension skill scores, per-question breakdown, red flags).
- `apps/web` — Next.js candidate room (`/interview`, `/interview/avatar`). Proctoring
  (gaze/face/object) + voice optional.
- `packages/shared` — `@interviehire/shared`. **Build it first**: `npm run build -w packages/shared`.
- Setup: `npm install` → build shared → `npm run db:generate -w apps/api` → `npm run dev`.
- Root workspace scripts (run from `interview-engine/`): `npm run dev` (api + web via
  concurrently), `npm run build` (shared → api → web, in order), `npm run lint`
  (web + api), `npm run db:generate`, `npm run db:migrate`, `npm run seed`.
- Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` (wss .../ws), `NEXT_PUBLIC_AVATAR_URL`.

## Deployment (see DEPLOY.md for the full runbook)

- Front-ends → **Vercel** (candidate room → `interviehire.com`, dashboard → `app.interviehire.com`).
- Backend + engine + Postgres → **Render** (one Blueprint from `render.yaml`).
- Avatar (UE5 Pixel Streaming) → your PC + Cloudflare named tunnel
  (`deploy/cloudflared-config.yml`) → `avatar.interviehire.com`.
- Cross-site auth cookie needs `SameSite=None; Secure` (`COOKIE_SAMESITE`/`COOKIE_SECURE`).
- Config files: root `render.yaml` (Render Blueprint), `backend/railway.json` (Railway
  alt for the backend), `interview-engine/vercel.json`. The backend applies its schema
  migrations automatically on boot (see `init_db()` above), so no separate migrate step.

## Working agreements

- Make the smallest change that satisfies the task; match surrounding style exactly.
- Touching the DB shape or `CandidateReport`? Update all three services + note it here.
- Commit/push only when asked. Branch off `master` first if asked to commit.
- Verify before claiming done: backend → import/route check; dashboard → the bind is
  actually called; engine → `npm run build -w packages/shared` still passes.
- **Complex tasks → decompose + parallelize.** For multi-file or multi-subsystem
  work, break the architecture into independent units and dispatch **parallel
  sub-agents** (one per file/subsystem) to work concurrently; reserve solo, sequential
  execution for trivial or inherently ordered changes. The `api.md` sync agent is the
  canonical example of a dedicated single-purpose sub-agent.
- **Context hygiene — compact at ~150k tokens.** Keep the working context under
  ~150k tokens: when it grows past that, run `/compact` before continuing. Built-in
  auto-compaction (nudged earlier via `CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000` in
  `.claude/settings.json`) is the backstop, not a substitute. Push heavy file reading
  into sub-agents so it never bloats the main thread.

## Planning docs

- `plan.md`, `DEPLOY.md`, `README.md`, and `dashboard/PRODUCT.md` /
  `dashboard/STITCH-PLAN.md` hold product/deploy context. Treat `plan.md` as
  scratch — confirm against the code (and `git log`) before trusting it, since
  shipped work is not always pruned from it.
