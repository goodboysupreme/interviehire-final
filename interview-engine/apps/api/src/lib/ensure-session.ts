import { prisma } from './prisma.js';

// Self-healing session provisioning.
//
// The candidate room is keyed by the applicant id as the session id (the
// scheduled email link is `.../interviewcandidateroom?sessionId={applicant.id}`).
// The engine only finds an InterviewSession when the backend's
// `sync_applicant_to_ai` already created one with `id == applicant.id`. When a
// candidate reaches the room before that sync ran (or it failed), the engine
// 404s with "Session not found".
//
// To make the link always work, the engine calls the backend's public
// `POST /api/public/interview-session/:id/ensure` endpoint (server-to-server,
// so no browser CORS) which provisions the session from the applicant's job +
// rubric, then we re-read it from the shared database.
//
// CRITICAL: only call this when the session is genuinely missing. The backend's
// ensure RESETS the session (clears transcript + evaluation), so calling it
// after the interview has produced data would destroy that data.
export async function ensureSession(sessionId: string) {
  if (!sessionId || sessionId === 'demo-session') {
    return prisma.interviewSession.findUnique({ where: { id: sessionId } });
  }

  const existing = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
  if (existing) return existing;

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    // No backend configured to provision from — behave exactly as before.
    return null;
  }

  try {
    const res = await fetch(
      `${backendUrl.replace(/\/$/, '')}/api/public/interview-session/${encodeURIComponent(sessionId)}/ensure`,
      { method: 'POST' },
    );
    if (!res.ok) {
      console.warn(`ensureSession: backend provisioning returned ${res.status} for ${sessionId}`);
      return null;
    }
  } catch (err) {
    console.warn('ensureSession: backend provisioning failed', err);
    return null;
  }

  // The backend wrote the InterviewSession to the shared DB; read it back.
  return prisma.interviewSession.findUnique({ where: { id: sessionId } });
}
