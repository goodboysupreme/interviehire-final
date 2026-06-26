import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { ensureSession } from '../lib/ensure-session.js';
import {
  finalizeTranscript,
  loadEvents,
  recordEvents,
  transcriptFilePath,
} from '../services/transcript.service.js';
import { asrAvailable, transcribeAudioSegments } from '../services/asr.service.js';
import { generateTranscriptReport } from '../services/transcript-report.service.js';
import { evaluateInterview } from '../services/evaluation.service.js';
import { evaluateInterviewWithAviral } from '../services/aviral-evaluation.service.js';

type TranscriptSpeaker = 'candidate' | 'interviewer';

// ─────────────────────────────────────────────────────────────────────────────
// Transcript API (mounted at /api/interviews).
//   POST /:sessionId/transcript/event      ingest one or many live events
//   GET  /:sessionId/transcript            read events + metadata (+ optional .txt body)
//   POST /:sessionId/transcript/finalize   build & save the .txt, update metadata
//   GET  /:sessionId/transcript/file       download the finalized .txt
// ─────────────────────────────────────────────────────────────────────────────

export async function transcriptRoutes(app: FastifyInstance) {
  // Ingest live transcript events. Accepts a single { ...event } or { events: [...] }.
  // Best-effort: malformed events are skipped, never 500. Returns counts so the
  // client can detect (and retry) a fully-rejected batch.
  app.post('/:sessionId/transcript/event', async (req: any, reply) => {
    const { sessionId } = req.params;
    const body = req.body ?? {};
    const rawEvents = Array.isArray(body.events)
      ? body.events
      : Array.isArray(body)
        ? body
        : [body];

    if (!rawEvents.length) {
      return reply.code(400).send({ error: 'No transcript events provided' });
    }

    try {
      const result = await recordEvents(sessionId, rawEvents);
      return { ok: true, ...result };
    } catch (err: any) {
      if (err?.message === 'Interview session not found') {
        return reply.code(404).send({ error: err.message });
      }
      req.log?.error?.(err, 'transcript event ingest failed');
      return reply.code(500).send({ error: 'Failed to store transcript event' });
    }
  });

  // Ingest an audio recording (one speaker's audio for the whole interview, or a
  // chunk) and transcribe it server-side with Whisper into timestamped events.
  // This is how the Convai avatar's voice (captured from the interview tab's
  // audio) becomes interviewer transcript lines. Multipart: file + fields
  // { speaker, startMs }. Requires OPENAI_API_KEY; returns 503 when absent so the
  // client can show a clear "interviewer transcription unavailable" notice.
  app.post('/:sessionId/transcript/audio', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No audio file uploaded' });

    const fields = part.fields ?? {};
    const speaker: TranscriptSpeaker = fields?.speaker?.value === 'candidate' ? 'candidate' : 'interviewer';
    const startMs = Number(fields?.startMs?.value ?? 0) || 0;

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${Date.now()}-${speaker}-${part.filename || 'audio.webm'}`;
    const dest = path.join(uploadsDir, filename);
    const mimeType = part.mimetype || 'audio/webm';
    fs.writeFileSync(dest, await part.toBuffer());

    if (!asrAvailable()) {
      return reply.code(503).send({
        error: 'Server-side transcription is not configured. Set DEEPGRAM_API_KEY (or OPENAI_API_KEY) to transcribe interviewer audio.',
        stored: 0,
      });
    }

    try {
      const segments = await transcribeAudioSegments(dest, startMs, mimeType);
      if (!segments || !segments.length) {
        return { ok: true, stored: 0, note: 'No speech detected in the audio.' };
      }
      const result = await recordEvents(
        sessionId,
        segments.map((s) => ({ speaker, text: s.text, timestampMs: s.startMs, source: 'whisper', isFinal: true })),
      );
      return { ok: true, segments: segments.length, ...result };
    } catch (err: any) {
      req.log?.error?.(err, 'audio transcription failed');
      return reply.code(502).send({ error: err?.message || 'Audio transcription failed', stored: 0 });
    }
  });

  // Read the current transcript: raw events + metadata. ?text=1 also returns the
  // rendered .txt body (finalizing first if needed) for quick preview.
  app.get('/:sessionId/transcript', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const [events, meta] = await Promise.all([
      loadEvents(sessionId),
      prisma.interviewTranscript.findUnique({ where: { sessionId } }),
    ]);

    let text: string | undefined;
    if (req.query?.text === '1' || req.query?.text === 'true') {
      const filePath = transcriptFilePath(sessionId);
      if (meta?.transcriptFilePath && fs.existsSync(meta.transcriptFilePath)) {
        text = fs.readFileSync(meta.transcriptFilePath, 'utf8');
      } else if (fs.existsSync(filePath)) {
        text = fs.readFileSync(filePath, 'utf8');
      } else {
        const result = await finalizeTranscript(sessionId);
        if (result.filePath && fs.existsSync(result.filePath)) {
          text = fs.readFileSync(result.filePath, 'utf8');
        }
      }
    }

    return { sessionId, events, meta, ...(text !== undefined ? { text } : {}) };
  });

  // Finalize: build the clean .txt, persist file path + metadata.
  app.post('/:sessionId/transcript/finalize', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const result = await finalizeTranscript(sessionId);
    if (result.status === 'failed') {
      return reply.code(500).send({ error: 'Transcript finalization failed', ...result });
    }
    return { ok: true, ...result };
  });

  // Finalize the transcript, then generate the report by passing the WHOLE
  // transcript to the LLM (fits the Convai-driven interview where questions are
  // dynamic). Falls back to the deterministic evaluator when no LLM key / on error
  // so the candidate always gets a report. Returns { evaluation, engine }.
  app.post('/:sessionId/report', async (req: any, reply) => {
    const { sessionId } = req.params;
    // Self-heal: provision from the applicant if the session is missing. (It
    // normally already exists by report time; ensureSession only resets when
    // genuinely absent, so no interview data is ever lost here.)
    const session = await ensureSession(sessionId);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    await finalizeTranscript(sessionId);

    // Primary holistic report (keeps Deep Analysis unchanged), then the structured
    // rubric/dimension/proctoring evaluation (gpt-4o when OPENAI_API_KEY is set,
    // else OpenRouter) merged under `.structured` for the new analysis section.
    let primary: any = null;
    let engine = 'transcript_llm';
    try {
      primary = await generateTranscriptReport(sessionId);
    } catch (llmErr) {
      req.log?.warn?.(llmErr, 'transcript LLM report failed; falling back to deterministic evaluator');
      try {
        primary = await evaluateInterview(sessionId);
        engine = 'deterministic';
      } catch (err: any) {
        primary = null;
      }
    }

    let structured: any = null;
    try {
      structured = await evaluateInterviewWithAviral(sessionId);
    } catch (structErr) {
      req.log?.warn?.(structErr, 'structured (aviral) evaluation failed');
    }

    if (!primary && !structured) {
      return reply.code(500).send({ error: 'Report generation failed' });
    }

    // Merge: holistic stays the headline report; the structured analysis is nested
    // (and also used standalone if the holistic pass failed).
    const evaluation = primary
      ? { ...primary, structured: structured ?? undefined }
      : { ...structured, structured };

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { evaluation: evaluation as any, status: 'EVALUATED', completedAt: new Date() },
    });

    return { evaluation, engine: structured ? `${engine}+aviral` : engine };
  });

  // Download the finalized .txt (finalizes on demand if missing).
  app.get('/:sessionId/transcript/file', async (req: any, reply) => {
    const { sessionId } = req.params;
    let filePath = transcriptFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      const result = await finalizeTranscript(sessionId);
      if (!result.filePath || !fs.existsSync(result.filePath)) {
        return reply.code(404).send({ error: 'Transcript not available' });
      }
      filePath = result.filePath;
    }
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${sessionId}.txt"`);
    return reply.send(fs.createReadStream(filePath));
  });
}
