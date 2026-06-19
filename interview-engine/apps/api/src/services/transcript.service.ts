import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import {
  buildTranscriptLines,
  cleanText,
  isValidSource,
  isValidSpeaker,
  renderTranscriptText,
  type TranscriptEvent,
  type TranscriptSource,
  type TranscriptSpeaker,
} from './transcript.format.js';

// ─────────────────────────────────────────────────────────────────────────────
// Database-backed transcript service. Owns the append-only TranscriptEvent log,
// the InterviewTranscript metadata row, and the .txt finalization. Pure shaping
// rules live in transcript.format.ts; this file is the I/O layer.
// ─────────────────────────────────────────────────────────────────────────────

export function transcriptsDir(): string {
  return process.env.TRANSCRIPTS_DIR
    ? path.resolve(process.env.TRANSCRIPTS_DIR)
    : path.resolve(process.cwd(), 'transcripts');
}

export function transcriptFilePath(sessionId: string): string {
  // sessionId is a cuid (safe charset); still strip anything path-like defensively.
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(transcriptsDir(), `${safe}.txt`);
}

type RawEventInput = {
  speaker: unknown;
  text: unknown;
  timestampMs?: unknown;
  source?: unknown;
  isFinal?: unknown;
  createdAt?: unknown;
};

export type NormalizedEventInput = {
  speaker: TranscriptSpeaker;
  text: string;
  timestampMs: number;
  source: TranscriptSource;
  isFinal: boolean;
  createdAt: string;
};

/**
 * Validate + normalize an inbound event. Returns null when the event is
 * unusable (bad speaker, empty text) so the caller can skip it without throwing
 * — partial/garbage events from flaky STT must never break ingestion.
 */
export function normalizeEventInput(
  raw: RawEventInput,
  startedAtMs: number | null,
): NormalizedEventInput | null {
  if (!isValidSpeaker(raw.speaker)) return null;
  const text = cleanText(raw.text);
  if (!text) return null;

  const source: TranscriptSource = isValidSource(raw.source) ? raw.source : 'manual';
  const isFinal = raw.isFinal === undefined ? true : Boolean(raw.isFinal);

  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString();

  let timestampMs: number;
  if (typeof raw.timestampMs === 'number' && Number.isFinite(raw.timestampMs) && raw.timestampMs >= 0) {
    timestampMs = Math.round(raw.timestampMs);
  } else if (startedAtMs != null) {
    timestampMs = Math.max(0, new Date(createdAt).getTime() - startedAtMs);
  } else {
    timestampMs = 0;
  }

  return { speaker: raw.speaker, text, timestampMs, source, isFinal, createdAt };
}

async function getStartedAtMs(sessionId: string): Promise<number | null> {
  const meta = await prisma.interviewTranscript.findUnique({ where: { sessionId } });
  if (meta?.startedAt) return meta.startedAt.getTime();
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { startedAt: true, createdAt: true },
  });
  const started = session?.startedAt ?? session?.createdAt ?? null;
  return started ? started.getTime() : null;
}

/** Lazily create / refresh the metadata row when transcript activity begins. */
export async function ensureTranscriptMeta(sessionId: string) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { candidateId: true, jobRoleId: true, startedAt: true, createdAt: true },
  });
  if (!session) return null;
  return prisma.interviewTranscript.upsert({
    where: { sessionId },
    update: {},
    create: {
      sessionId,
      candidateId: session.candidateId,
      interviewId: session.jobRoleId,
      startedAt: session.startedAt ?? session.createdAt,
      status: 'recording',
    },
  });
}

/**
 * Record one or more transcript events. Best-effort: invalid events are skipped,
 * not rejected. Returns the count actually stored.
 */
export async function recordEvents(
  sessionId: string,
  rawEvents: RawEventInput[],
): Promise<{ stored: number; skipped: number }> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) throw new Error('Interview session not found');

  await ensureTranscriptMeta(sessionId);
  const startedAtMs = await getStartedAtMs(sessionId);

  const normalized = rawEvents
    .map((raw) => normalizeEventInput(raw, startedAtMs))
    .filter((e): e is NormalizedEventInput => e !== null);

  if (!normalized.length) return { stored: 0, skipped: rawEvents.length };

  await prisma.transcriptEvent.createMany({
    data: normalized.map((e) => ({
      sessionId,
      speaker: e.speaker,
      text: e.text,
      timestampMs: e.timestampMs,
      source: e.source,
      isFinal: e.isFinal,
      createdAt: new Date(e.createdAt),
    })),
  });

  await prisma.interviewTranscript.update({
    where: { sessionId },
    data: { eventCount: { increment: normalized.length } },
  }).catch(() => undefined);

  return { stored: normalized.length, skipped: rawEvents.length - normalized.length };
}

/**
 * Convenience used by server-side auto-capture (the conversation engine). Never
 * throws into the request path — logs and swallows so the interview flow is
 * unaffected if transcript capture has a problem.
 */
export async function recordEventSafe(
  sessionId: string,
  speaker: TranscriptSpeaker,
  text: string,
  source: TranscriptSource = 'manual',
): Promise<void> {
  try {
    if (!cleanText(text)) return;
    await recordEvents(sessionId, [{ speaker, text, source, isFinal: true }]);
  } catch (err) {
    console.error('[transcript] recordEventSafe failed', err);
  }
}

export async function loadEvents(sessionId: string): Promise<TranscriptEvent[]> {
  const rows = await prisma.transcriptEvent.findMany({
    where: { sessionId },
    orderBy: [{ timestampMs: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r: any) => ({
    sessionId: r.sessionId,
    speaker: r.speaker as TranscriptSpeaker,
    text: r.text,
    timestampMs: r.timestampMs,
    source: r.source as TranscriptSource,
    isFinal: r.isFinal,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Fallback source of truth: the legacy session.transcript JSON turns (written by
 * the conversation engine / pasted transcript). Lets finalize still produce a
 * file for sessions that predate the event log, or when only the JSON exists.
 */
export async function eventsFromLegacyTranscript(sessionId: string): Promise<TranscriptEvent[]> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { transcript: true, startedAt: true, createdAt: true },
  });
  if (!session) return [];
  const raw = Array.isArray(session.transcript) ? (session.transcript as any[]) : [];
  const startedAtMs = (session.startedAt ?? session.createdAt)?.getTime() ?? null;

  const out: TranscriptEvent[] = [];
  for (const turn of raw) {
    const text = cleanText(turn?.text);
    if (!text) continue;
    // legacy uses speaker:'ai'|'candidate'
    const speaker: TranscriptSpeaker =
      turn?.speaker === 'ai' || turn?.speaker === 'interviewer' ? 'interviewer' : 'candidate';
    const ts =
      typeof turn?.timestamp === 'string' && startedAtMs != null
        ? Math.max(0, new Date(turn.timestamp).getTime() - startedAtMs)
        : out.length * 1000; // monotonic fallback preserves order
    out.push({
      sessionId,
      speaker,
      text,
      timestampMs: ts,
      source: 'manual',
      isFinal: true,
      createdAt: typeof turn?.timestamp === 'string' ? turn.timestamp : new Date().toISOString(),
    });
  }
  return out;
}

export type FinalizeResult = {
  status: 'finalized' | 'empty' | 'failed';
  filePath: string | null;
  lineCount: number;
  eventCount: number;
};

/**
 * Finalize the transcript: gather events (event log ∪ legacy JSON), shape them
 * into clean lines, write the .txt file, and update the metadata row. Robust to
 * an empty transcript (writes an "empty" status + placeholder file) and never
 * throws — returns a status the caller can surface.
 */
export async function finalizeTranscript(sessionId: string): Promise<FinalizeResult> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { candidateId: true, jobRoleId: true, startedAt: true, completedAt: true, createdAt: true },
  });
  if (!session) {
    return { status: 'failed', filePath: null, lineCount: 0, eventCount: 0 };
  }

  await ensureTranscriptMeta(sessionId);
  const endedAt = session.completedAt ?? new Date();

  try {
    const logged = await loadEvents(sessionId);
    // The live event log is the source of truth. Only fall back to the legacy
    // session.transcript JSON (pasted transcript / backend-seeded questions) when
    // NO events were captured — otherwise the seed questions would pollute a real
    // STT transcript with lines the avatar never actually said.
    const legacy = logged.length ? [] : await eventsFromLegacyTranscript(sessionId);
    const allEvents = [...logged, ...legacy];
    const lines = buildTranscriptLines(allEvents);

    const dir = transcriptsDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = transcriptFilePath(sessionId);

    const body = renderTranscriptText(lines, {
      sessionId,
      candidateId: session.candidateId,
      startedAt: (session.startedAt ?? session.createdAt)?.toISOString() ?? null,
      endedAt: endedAt.toISOString(),
    });
    fs.writeFileSync(filePath, body, 'utf8');

    const status: FinalizeResult['status'] = lines.length ? 'finalized' : 'empty';

    // Project the clean transcript into session.transcript in the shape the
    // evaluator expects ({speaker:'ai'|'candidate', text, questionIndex}). This
    // is what feeds the LLM report — it replaces the old manual paste step.
    // Each interviewer line opens a new question bucket; candidate lines attach
    // to the current bucket. Only write when we actually captured lines, so an
    // empty finalize never clobbers an existing transcript.
    if (lines.length) {
      let qi = -1;
      const turns = lines.map((l) => {
        if (l.speaker === 'interviewer') qi += 1;
        return {
          speaker: l.speaker === 'interviewer' ? 'ai' : 'candidate',
          text: l.text,
          questionIndex: Math.max(0, qi),
          timestamp: new Date((session.startedAt ?? session.createdAt ?? endedAt).getTime() + l.timestampMs).toISOString(),
          source: 'stt',
        };
      });
      await prisma.interviewSession
        .update({ where: { id: sessionId }, data: { transcript: turns as any } })
        .catch((e: any) => console.error('[transcript] session.transcript projection failed', e));
    }

    await prisma.interviewTranscript.update({
      where: { sessionId },
      data: {
        transcriptFilePath: filePath,
        endedAt,
        status,
        candidateId: session.candidateId,
        interviewId: session.jobRoleId,
        startedAt: session.startedAt ?? session.createdAt,
      },
    });

    return { status, filePath, lineCount: lines.length, eventCount: allEvents.length };
  } catch (err) {
    console.error('[transcript] finalize failed', err);
    await prisma.interviewTranscript
      .update({ where: { sessionId }, data: { status: 'failed', endedAt } })
      .catch(() => undefined);
    return { status: 'failed', filePath: null, lineCount: 0, eventCount: 0 };
  }
}
