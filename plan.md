# plan.md — IntervieHire fullstack development plan

Living roadmap for autonomous, multi-agent development of IntervieHire. Read
alongside `CLAUDE.md` (architecture + conventions). Status legend: ☐ todo ·
◐ in progress · ☑ done.

## 0. Operating model — how the agents work

Development is split across three domain lanes that map to the three services.
Each lane is owned by a specialized subagent so work runs in parallel without
collisions. Agents that **edit files in parallel run in isolated git worktrees**
to avoid conflicts; read-only/scout work runs inline.

| Lane | Owns | Default agent | MCP / tools it leans on |
|------|------|---------------|-------------------------|
| **Backend** | `backend/` — FastAPI, models, routers, DB | general-purpose | Bash (uvicorn, pytest), Supabase MCP (schema/queries) |
| **Frontend** | `dashboard/` + `interview-engine/apps/web` | general-purpose | Bash (next build), Vercel MCP (preview deploys, logs) |
| **AI / engine** | `interview-engine/apps/api`, `aviral-eval/` | general-purpose | Bash (prisma, tsc), DeepSeek/OpenRouter via env |
| **Explore/scout** | cross-cutting reads, "where is X" | Explore | read-only |
| **Review** | adversarial verification of each change | general-purpose | Bash (build/test), read-only diff review |

Rules for the fleet:
1. **Scout before fan-out.** An Explore pass establishes the work-list; then lanes
   fan out in parallel.
2. **One lane = one worktree** when editing concurrently. Merge back after the
   review agent signs off.
3. **Every change is verified** before it's called done (build passes / route
   imports / bind is wired). Findings are adversarially checked, not trusted.
4. **The shared DB contract is sacred** — a schema change fans out to all three
   services in the same cycle.
5. **No secrets in code.** MCP deploys read env from the platform, not the repo.

## 1. Immediate — finish in-flight work

- ☑ **Add Applicants upload panel** — fully wired (audit cycle 1).
  - ☑ Backend `?source=` param; ☑ `apiUploadResumes()`; ☑ panels rendered.
  - ☑ `bindAddApplicantsPanel()` now called for both stages in `renderJobDetailPanes`.
  - ☑ `isApiMode` imported into job-detail-panes; Import handler calls `apiUploadResumes`.
  - ☑ `API_BASE` imported into api.js (was an undefined ReferenceError on every upload).

## 1b. Audit cycle 1 — confirmed contract breaks (all FIXED)

5 confirmed by adversarial verification (51 backend + 27 engine routes, 17 dash + 23 web calls mapped):
- ☑ **CRITICAL** `settings.py` password change was unauthenticated + hardcoded to
  `devasri@zeko.ai` (anon account takeover) → now `get_current_user`-scoped, bcrypt verify/hash.
- ☑ **HIGH** `apiUploadResumes` used undefined `API_BASE` → imported.
- ☑ **HIGH** `bindAddApplicantsPanel` never called + `isApiMode` not imported → both fixed.
- ☑ **HIGH** `settings.py` wrote sha256 while login verifies bcrypt (password change locked
  users out) → unified on `app.utils.auth` bcrypt helpers.
- ☑ **MEDIUM** `POST /api/jobs/extract-jd` had no auth (sibling `upload-jd` did) → auth added.

## 2. Hardening pass (parallelizable across lanes)

- ☐ **Security:** rotate the OpenAI key currently leaking from `~/.zshenv` (user env,
  not repo). Audit repo for any committed secrets. Confirm `.env*` gitignored everywhere.
- ☐ **Backend:** input validation on all upload/applicant routes; consistent error
  envelopes (`{detail}`); auth coverage on every job-scoped route (`_verify_job_access`).
- ☐ **Frontend:** `escapeHTML` audit on every template that interpolates user data;
  loading/error states on async panes; data-source toggle resilience.
- ☐ **Engine:** confirm zero-key deterministic evaluator path; `CandidateReport`
  schema validation; transcript rebuild on demand.

## 3. Feature roadmap (prioritize with the user)

- ☐ Blueprint Studio: question/rubric authoring polish + validation.
- ☐ Deep Analysis: richer post-interview intelligence rendering.
- ☐ Pipeline stages: drag-drop between stages writes status to backend.
- ☐ Reports: shareable candidate report links.
- ☐ Avatar interview: stabilize Pixel Streaming embed + proctoring signals.

## 4. Deploy / verify loop

- ☐ Dashboard + candidate room preview deploys via **Vercel MCP**; check runtime logs.
- ☐ Backend + engine on Render via `render.yaml` Blueprint; run `seed.py` once.
- ☐ Smoke test from DEPLOY.md §5 after each significant change.

## Decision log

- 2026-06-20: Ran multi-agent contract audit (inventory → cross-reference → adversarial
  verify). 8 raw findings, 5 confirmed, all fixed in one coherent pass. Verified by
  py_compile + venv import (backend) and `node --check` (dashboard).
- 2026-06-20: Committed fixes directly to `master` (user's active working branch; full
  pipeline authorized). Prod deploy deferred until a deeper runtime smoke-test pass.
