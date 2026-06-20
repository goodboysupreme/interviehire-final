# Deploying IntervieHire to production (interviehire.com)

Goal: the whole product is public, and the UE5 avatar runs on **your PC** but is
reachable at `https://interview.interviehire.com/interview/avatar` from any device.

## Architecture (what goes where)

| Piece | Host | Public URL |
|---|---|---|
| Candidate room (`interview-engine/apps/web`) | **Vercel** | `interview.interviehire.com` (has `/interview` + `/interview/avatar`) |
| Recruiter dashboard (`dashboard`) | **Vercel** | `app.interviehire.com` |
| Interview engine — Fastify (`interview-engine`) | **Render** | `interviehire-engine.onrender.com` |
| Backend — FastAPI (`backend`) | **Render** | `interviehire-backend.onrender.com` |
| Postgres (shared) | **Railway** | both services set `DATABASE_URL` to it (`sync: false`) |
| UE5 avatar (Pixel Streaming) | **Your PC** + Cloudflare named tunnel | `avatar.interviehire.com` |

The avatar video is **WebRTC straight from your PC to the viewer** (via TURN).
Vercel/Render never proxy it — `/interview/avatar` just embeds the tunnel URL.

---

## 1. DNS — move interviehire.com to Cloudflare (one-time)

A stable `avatar.interviehire.com` tunnel needs the zone on Cloudflare.
1. Cloudflare → Add site → `interviehire.com` → Free plan. It imports your records.
2. **Re-add your existing records** if any are missing (Vercel, Zoho email MX/TXT, etc.) so nothing breaks.
3. At **GoDaddy**, change the nameservers to the two Cloudflare gave you. Propagation ~1–24h.

> Keep your Zoho **MX/SPF/DKIM** records intact during the move or email stops.

---

## 2. Backend + Engine + Postgres → Render (one Blueprint)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads [`render.yaml`](render.yaml) and creates `interviehire-backend` + `interviehire-engine`. Postgres is **not** provisioned here — it lives on **Railway** now.
3. When prompted for `sync: false` secrets, paste:
   - **both services** → `DATABASE_URL` = the **Railway** Postgres connection string (the public/external URL). Use the **same** value for backend and engine — they share one DB.
   - **interviehire-backend** → `FRONTEND_URL` = `https://app.interviehire.com`
   - **interviehire-engine** → `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY` (the OpenRouter key works for both `OPENROUTER_API_KEY` and `DEEPSEEK_API_KEY`).
4. First deploy runs Prisma migrations automatically (engine `startCommand`).
5. **Seed the admin + demo data** once: Render → `interviehire-backend` → Shell → `python seed.py`.
   (The engine's demo interview also self-seeds on first `GET /api/interview/demo-session`.)
6. Note the two service URLs.

> Render free tier sleeps after inactivity (first request is slow) and has an
> **ephemeral disk** — that's fine here: transcripts live in Postgres
> (`TranscriptEvent`) and the `.txt` is rebuilt on demand by `finalize`/download.

---

## 3. Front-ends → Vercel (two projects)

Both are Next apps in this monorepo (npm workspaces + the `@interviehire/shared` package).

### 3a. Candidate room → interview.interviehire.com
- Vercel → New Project → this repo. **This is a SEPARATE Vercel project from the dashboard** — the room owns `/interview`, the dashboard does not.
- **Root Directory:** `interview-engine/apps/web` → enable **"Include source files outside of the Root Directory"** (so `packages/shared` is available).
- It picks up [`apps/web/vercel.json`](interview-engine/apps/web/vercel.json) (install/build run from the workspace root).
- **Environment Variables** (Production) — see [`.env.production.example`](interview-engine/apps/web/.env.production.example):
  - `NEXT_PUBLIC_API_URL` = `https://interviehire-engine.onrender.com`
  - `NEXT_PUBLIC_WS_URL` = `wss://interviehire-engine.onrender.com/ws`
  - `NEXT_PUBLIC_AVATAR_URL` = `https://avatar.interviehire.com`
- **Domain:** add `interview.interviehire.com`. Verify `curl -I https://interview.interviehire.com/interview` returns **200** before pointing the dashboard at it.

### 3b. Dashboard → app.interviehire.com
- Vercel → New Project → this repo → **Root Directory:** `dashboard`.
- **Environment Variables** — see [`dashboard/.env.production.example`](dashboard/.env.production.example):
  - `NEXT_PUBLIC_API_URL` = `https://interviehire-backend.onrender.com/api`
  - `NEXT_PUBLIC_ENGINE_WEB_URL` = `https://interview.interviehire.com`
- **Domain:** add `app.interviehire.com`.

After both are live, double-check the backend's `FRONTEND_URL` on Render equals the
dashboard origin (`https://app.interviehire.com`) — that drives CORS + the
cross-site auth cookie (already configured `SameSite=None; Secure` via
`COOKIE_SAMESITE`/`COOKIE_SECURE` in `render.yaml`).

---

## 4. Avatar → stable Cloudflare named tunnel (on your PC)

Once DNS is on Cloudflare (step 1), on the PC (cloudflared already installed):

```
cloudflared tunnel login
cloudflared tunnel create interviehire-avatar
cloudflared tunnel route dns interviehire-avatar avatar.interviehire.com
# fill the UUID + credentials path into deploy/cloudflared-config.yml, then:
cloudflared --config deploy/cloudflared-config.yml service install   # always-on
```

Config template: [`deploy/cloudflared-config.yml`](deploy/cloudflared-config.yml).
Keep your existing **metered.ca TURN** baked into `run-signalling.bat` (needed for
cross-network WebRTC). Start order on the PC: UE app → signalling (`:80`) → tunnel.

---

## 5. Smoke test

1. `https://avatar.interviehire.com` → avatar streams.
2. `https://interview.interviehire.com/interview/avatar` → same avatar, embedded.
3. `https://app.interviehire.com` → log in (`admin@interviehire.com`) → "Run test interview".
4. Take the interview from **another device** → speak (browser STT) + click
   "🎧 Capture interviewer" → End → transcript `.txt` + report generate.

## Quick reference — what each env var does

| Service | Var | Value |
|---|---|---|
| engine | `DEEPGRAM_API_KEY` | avatar STT |
| engine | `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` | LLM report (same OpenRouter key) |
| engine + backend | `DATABASE_URL` | **Railway** Postgres — same URL for both (shared DB) |
| backend | `FRONTEND_URL` | `https://app.interviehire.com` |
| backend | `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true` | cross-site auth cookie |
| web | `NEXT_PUBLIC_API_URL` / `_WS_URL` | engine on Render |
| web | `NEXT_PUBLIC_AVATAR_URL` | `https://avatar.interviehire.com` |
| dashboard | `NEXT_PUBLIC_API_URL` | backend on Render |
| dashboard | `NEXT_PUBLIC_ENGINE_WEB_URL` | `https://interview.interviehire.com` |
