-- AlterTable
-- Per-job interview settings synced from the recruiter dashboard. IF NOT EXISTS keeps
-- this idempotent and collision-free with the backend's init_db ALTER guard, since both
-- the engine (Prisma) and the FastAPI backend (SQLAlchemy) write this shared column.
ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}';
