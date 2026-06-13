# IntervieHire — Final

An AI-driven hiring platform: recruiters author rubric-grade interview blueprints, an AI avatar runs the interview, and candidates are scored against the recruiter's own rubric into a structured evaluation report.

This repo stitches three pieces into one working MVP:

| Component | Dir | Role |
|-----------|-----|------|
| **Recruiter dashboard** | [`dashboard/`](dashboard/) | The product surface — job pipelines, the **Interview Blueprint Studio** (authors questions + graded rubrics), and **Deep Analysis** (post-interview candidate intelligence). Leads the contract. |
| **AI interview engine** | [`interview-engine/`](interview-engine/) | Fastify API (`:4000`) + candidate interview room (Next.js) + the **Aviral evaluation engine** (`apps/api/src/aviral-eval/`). Runs the interview and scores it with DeepSeek. |
| **Backend** | [`backend/`](backend/) | FastAPI (`:8000`) over Supabase Postgres — jobs, applicants, auth, and the bridge that feeds blueprints to the engine and serves reports back. |

## How it fits together

```
Recruiter (dashboard :3000)
   │  authors blueprint + rubric in the Blueprint Studio
   ▼
FastAPI backend (:8000)  ──persists──►  Supabase Postgres
   │  on schedule: syncs the job's questions + rubric into the engine's tables
   ▼
Candidate interview room (interview-engine web)
   │  text/voice answers  →  Fastify engine (:4000)
   ▼
Aviral evaluation engine + DeepSeek
   │  grades each answer against the recruiter's rubric → CandidateReport
   ▼
Supabase  ──►  FastAPI serves the report  ──►  Deep Analysis renders it
```

The dashboard, engine, and backend integrate through a **shared Supabase database** — the FastAPI backend mirrors the engine's tables, so a blueprint authored in the dashboard reaches the interview, and the resulting `CandidateReport` flows straight back to Deep Analysis.

### Evaluation

Scoring uses the **Aviral evaluation engine** (`interview-engine/apps/api/src/aviral-eval/`): for each answer it builds a rubric-grounded prompt, asks DeepSeek to grade it, validates the result, and aggregates a canonical `CandidateReport` (overall score, recommendation, per-dimension skill scores, per-question breakdown, red flags). Without a `DEEPSEEK_API_KEY` it falls back to a deterministic evaluator, so an interview still runs and scores with **zero API keys**.

## Quick start

Each component has its own `.env.example` — copy it to `.env` (or `.env.local` for the dashboard) and fill in the values. The three services share one Supabase database.

**1. Backend (FastAPI, `:8000`)**
```bash
cd backend
python -m venv venv && venv/Scripts/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # fill DATABASE_URL, SECRET_KEY
python -m uvicorn main:app --port 8000 --reload
```

**2. Interview engine (Fastify `:4000` + candidate web `:3001`)**
```bash
cd interview-engine
npm install
cp .env.example .env                                  # fill DATABASE_URL (+ DEEPSEEK_API_KEY for LLM scoring)
npm run build -w packages/shared
npm run db:generate -w apps/api
npm run dev                                           # api :4000 + web
```
A keyless **test interview** is available immediately at `/interview` (it seeds a demo session via `GET /api/interview/demo-session`).

**3. Dashboard (Next.js, `:3000`)**
```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
```
The dashboard runs on localStorage by default. Flip it to the live backend with `IHApi.setDataSource('api')` in the browser console (it then hydrates jobs, persists authored blueprints, and renders live reports in Deep Analysis).

## Notes

- **Secrets** live only in `.env` files, which are gitignored. Never commit real keys or database URLs.
- The recruiter dashboard is the source of truth for the `CandidateReport` shape; the engine and backend conform to it.
- The candidate room supports proctoring (gaze/face/object) and voice, but a typed text interview needs no paid voice keys.
