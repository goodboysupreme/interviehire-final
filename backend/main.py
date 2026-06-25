from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.websocket_routes import router as websocket_router
from app.database import Base, engine
from app.routers import jobs, team, organisation, usage, settings as settings_router, deepseek, auth, public, leaderboard
from app.talent_finder.routes import router as talent_finder_router

# Import all models so SQLAlchemy registers them before create_all
import app.models  # noqa


def init_db():
    """Create tables + idempotent column migrations.

    Runs at startup (via lifespan), NOT at module import, and is non-fatal: a
    transient DB hiccup is logged and the app still boots and serves (the
    healthcheck at GET / is DB-free), instead of crash-looping the container.
    """
    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Auto-migrate: Add parameters columns to jobs if they don't exist
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS resume_parameters TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_parameters TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS functional_parameters TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS recruiter_screening VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS recruiter_screening_score FLOAT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS match_score FLOAT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_analysis_report TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_text TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_analysed BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_shortlisted BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_waitlisted BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS scheduling_token VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS calendar_event_id VARCHAR;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS organisation_id UUID;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation_id UUID;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token VARCHAR;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_id VARCHAR;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_secret VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS overall_interview_score FLOAT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS proctoring_severity_flag VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS calendar_sequence INTEGER DEFAULT 0;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS decision TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS entry_method VARCHAR;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_settings TEXT;"))
        conn.execute(text("""ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';"""))

        # user_preferences table — stores per-account settings (theme etc.)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                theme VARCHAR NOT NULL DEFAULT 'dark',
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        """))

        conn.commit()

        # Add 'super_admin' to usertype enum in postgresql
        try:
            conn.execute(text("COMMIT;"))  # ALTER TYPE cannot run inside a transaction block in PostgreSQL
            conn.execute(text("ALTER TYPE usertype ADD VALUE 'super_admin';"))
        except Exception:
            pass
        conn.commit()

        # Rename / Migrate career_pages -> organisations
        try:
            is_postgres = settings.DATABASE_URL.startswith("postgresql")
            if is_postgres:
                check_career_pages = conn.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'career_pages');")).scalar()
                check_organisations = conn.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organisations');")).scalar()
            else:
                check_career_pages = conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='career_pages';")).scalar()
                check_organisations = conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='organisations';")).scalar()

            if check_career_pages:
                if check_organisations:
                    count_orgs = conn.execute(text("SELECT count(*) FROM organisations;")).scalar()
                    if count_orgs == 0:
                        print("Migrating data from career_pages to organisations...")
                        conn.execute(text("""
                            INSERT INTO organisations (id, org_name, domain, contact_email, website_link, location, logo_url, description, created_at, updated_at)
                            SELECT id, org_name, domain, contact_email, website_link, location, logo_url, description, created_at, updated_at
                            FROM career_pages;
                        """))
                        conn.commit()
                print("Dropping legacy career_pages table...")
                conn.execute(text("DROP TABLE career_pages;"))
                conn.commit()
        except Exception as migration_err:
            print(f"Migration error (career_pages -> organisations): {migration_err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema setup at startup, not import. Non-fatal so a slow/unreachable DB at
    # boot doesn't crash the container — the app still serves and the healthcheck
    # passes; the idempotent migrations retry on the next boot.
    try:
        init_db()
    except Exception as e:
        print(f"[startup] init_db failed; serving without migration this boot. Fix DB/migrations: {e}")
    yield


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

# CORS — allows Next.js frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in str(settings.FRONTEND_URL).split(",") if o.strip()] + [
        "https://interviehire.com",
        "https://app.interviehire.com",
        "https://interview.interviehire.com",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
        "http://localhost:3100",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(websocket_router)  # existing WS routes
app.include_router(auth.router,             prefix="/api/auth",     tags=["Auth"])
app.include_router(jobs.router,             prefix="/api/jobs",     tags=["Jobs"])
app.include_router(team.router,             prefix="/api/team",     tags=["Team"])
app.include_router(organisation.router,     prefix="/api/organisation", tags=["Organisation"])
app.include_router(usage.router,            prefix="/api/usage",    tags=["Usage"])
app.include_router(settings_router.router,  prefix="/api/settings", tags=["Settings"])
app.include_router(deepseek.router,         prefix="/api/deepseek", tags=["DeepSeek"])
app.include_router(public.router,           prefix="/api/public",   tags=["Public"])
app.include_router(leaderboard.router,      prefix="/api/leaderboard", tags=["Leaderboard"])
app.include_router(talent_finder_router,    prefix="/api/talent-finder", tags=["Talent Finder"])


@app.get("/")
def root():
    return {"status": "ok", "app": settings.APP_NAME}
