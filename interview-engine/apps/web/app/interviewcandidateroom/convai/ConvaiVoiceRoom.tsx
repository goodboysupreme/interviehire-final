'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL, parseApiResponse } from '@/lib/api';
import { useTranscript } from '@/hooks/useTranscript';

// ─────────────────────────────────────────────────────────────────────────────
// Convai voice/avatar interview room (additive — does not touch /interview).
//
// Model chosen with the team: "voice/avatar over your questions". The BACKEND
// still owns the conversation — /start serves the first blueprint question,
// /answers returns the next AI turn, /evaluate scores it. Convai is the voice
// layer for the CANDIDATE: the SDK captures the candidate's speech (push-to-talk
// → transcript). The AI question is spoken with the browser SpeechSynthesis API
// so it reliably reads the exact blueprint text (the Convai Web SDK is a
// brain-first conversational character and won't reliably TTS arbitrary lines).
//
// VERIFY ON A LIVE RUN (needs NEXT_PUBLIC_CONVAI_API_KEY + a character ID + the
// SDK installed): confirm the ConvaiClient response getter names below against
// node_modules/convai-web-sdk, and decide whether to drive the Convai avatar's
// lip-sync from the question audio (TODO marked).
// ─────────────────────────────────────────────────────────────────────────────

type Speaker = 'ai' | 'candidate';
interface Message { speaker: Speaker; text: string; }

const CONVAI_API_KEY = process.env.NEXT_PUBLIC_CONVAI_API_KEY || '';
const CONVAI_CHARACTER_ID = process.env.NEXT_PUBLIC_CONVAI_CHARACTER_ID || '';

function speakQuestion(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS is best-effort; the question is always shown as text too. */
  }
}

export default function ConvaiVoiceRoom() {
  const params = useSearchParams();
  const sessionId = params.get('sessionId') || params.get('session') || '';

  const convaiRef = useRef<any>(null);
  const [convaiReady, setConvaiReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [transcriptReady, setTranscriptReady] = useState(false);

  const transcript = useTranscript(sessionId);
  const configured = Boolean(CONVAI_API_KEY && CONVAI_CHARACTER_ID);

  // Initialise the Convai client once, client-side only (SDK touches navigator,
  // AudioContext and WebSocket, so it must never run during SSR).
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    (async () => {
      try {
        // @convai/web-sdk ships no type declarations. NOTE: confirm the exact
        // package name on install — sources differ between '@convai/web-sdk'
        // (this project's prior verified choice) and 'convai-web-sdk'.
        const mod = await import('@convai/web-sdk');
        if (cancelled) return;
        const ConvaiClient = mod.ConvaiClient || (mod as any).default?.ConvaiClient;
        const client = new ConvaiClient({
          apiKey: CONVAI_API_KEY,
          characterId: CONVAI_CHARACTER_ID,
          enableAudio: true,
          sessionId: '-1',
        } as any);

        // Candidate speech-to-text arrives here as it is recognised.
        (client as any).setResponseCallback((response: any) => {
          try {
            if (response?.hasUserQuery?.()) {
              const q = response.getUserQuery?.();
              const t = typeof q === 'string' ? q : q?.getTextData?.();
              if (t) {
                setDraft(t);
                // Capture candidate speech-to-text as it is recognised (interim).
                const isFinal = q?.getIsFinal?.() ?? false;
                transcript.recordEvent({ speaker: 'candidate', text: t, source: 'convai', isFinal });
              }
            }
          } catch {
            /* getter shape varies by SDK version — confirmed on live run. */
          }
        });

        convaiRef.current = client;
        setConvaiReady(true);
      } catch (err) {
        console.error('Convai init failed', err);
        setStatus('Convai SDK failed to initialise — check the API key / character ID.');
      }
    })();

    return () => {
      cancelled = true;
      try { convaiRef.current?.interrupt?.(); } catch { /* noop */ }
      convaiRef.current = null;
    };
  }, [configured]);

  const startSession = useCallback(async () => {
    if (!sessionId) { setStatus('No sessionId in the URL.'); return; }
    setBusy(true);
    setStatus('Starting session…');
    try {
      const res = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/start`, { method: 'POST' });
      const json = await parseApiResponse<any>(res);
      transcript.markStart();
      const first = json?.initialQuestion;
      if (first) {
        setMessages([{ speaker: 'ai', text: first }]);
        speakQuestion(first);
        transcript.recordEvent({ speaker: 'interviewer', text: first, source: 'manual' });
      }
      setStarted(true);
      setStatus('Interview started. Hold “Speak” to answer.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  const startTalking = useCallback(() => {
    try { convaiRef.current?.startAudioChunk?.(); setListening(true); } catch { /* noop */ }
  }, []);

  const stopTalking = useCallback(() => {
    try { convaiRef.current?.endAudioChunk?.(); } catch { /* noop */ }
    setListening(false);
  }, []);

  const sendAnswer = useCallback(async () => {
    const answer = draft.trim();
    if (!answer || busy) return;
    setBusy(true);
    setStatus('Submitting answer…');
    setMessages((cur) => [...cur, { speaker: 'candidate', text: answer }]);
    transcript.recordEvent({ speaker: 'candidate', text: answer, source: 'convai', isFinal: true });
    setDraft('');
    try {
      const res = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: answer, metrics: {} }),
      });
      const json = await parseApiResponse<any>(res);
      const next = json?.ai?.text;
      if (next) {
        setMessages((cur) => [...cur, { speaker: 'ai', text: next }]);
        speakQuestion(next);
        transcript.recordEvent({ speaker: 'interviewer', text: next, source: 'manual' });
      }
      setStatus('Answer saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not submit the answer.');
    } finally {
      setBusy(false);
    }
  }, [draft, busy, sessionId]);

  const finish = useCallback(async () => {
    setEvaluating(true);
    setStatus('Completing & evaluating…');
    try {
      try { convaiRef.current?.interrupt?.(); } catch { /* noop */ }
      // Finalize the transcript (.txt) before completing/evaluating.
      const fin = await transcript.finalize();
      if (fin?.status === 'finalized' || fin?.status === 'empty') setTranscriptReady(true);
      await fetch(`${API_URL}/api/interview/sessions/${sessionId}/complete`, { method: 'POST' });
      const res = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/evaluate`, { method: 'POST' });
      const json = await parseApiResponse<any>(res);
      if (json?.evaluation) setEvaluation(json.evaluation);
      setStatus('Interview completed and evaluated.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not complete the interview.');
    } finally {
      setEvaluating(false);
    }
  }, [sessionId]);

  if (!configured) {
    return (
      <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">Convai is not configured.</p>
        <p className="mt-2">
          Set <code>NEXT_PUBLIC_CONVAI_API_KEY</code> and <code>NEXT_PUBLIC_CONVAI_CHARACTER_ID</code> in
          <code> apps/web/.env.local</code>, then reload. See <code>.env.example</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Voice interview <span className="text-cyan-600">· Convai</span></h1>
        <span className="text-xs text-slate-500">{convaiReady ? 'voice ready' : 'connecting…'}</span>
      </header>

      {/* Avatar slot — TODO: mount the Convai character/avatar here for lip-sync. */}
      <div className="flex items-center gap-4 rounded-2xl border bg-slate-50 p-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-cyan-100 text-2xl">🎙️</div>
        <div className="text-sm text-slate-600">
          The interviewer speaks each question aloud; hold <strong>Speak</strong> to answer by voice.
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border p-4">
        {messages.length === 0 && <p className="text-sm text-slate-400">No questions yet — start the interview.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.speaker === 'ai' ? 'text-slate-800' : 'text-cyan-700'}>
            <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {m.speaker === 'ai' ? 'Interviewer' : 'You'}
            </span>
            {m.text}
          </div>
        ))}
      </div>

      {!started ? (
        <button
          onClick={startSession}
          disabled={busy || !sessionId}
          className="rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start interview'}
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your spoken answer appears here — edit if needed, then send."
            rows={3}
            className="w-full rounded-2xl border px-4 py-3 text-sm"
          />
          <div className="flex flex-wrap gap-3">
            <button
              onPointerDown={startTalking}
              onPointerUp={stopTalking}
              onPointerLeave={() => listening && stopTalking()}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold text-white ${listening ? 'bg-red-500' : 'bg-slate-700'}`}
            >
              {listening ? 'Listening… release to stop' : 'Hold to speak'}
            </button>
            <button
              onClick={sendAnswer}
              disabled={busy || !draft.trim()}
              className="rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Send answer
            </button>
            <button
              onClick={finish}
              disabled={evaluating}
              className="ml-auto rounded-2xl border px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {evaluating ? 'Evaluating…' : 'Finish & evaluate'}
            </button>
          </div>
        </div>
      )}

      {status && <p className="text-xs text-slate-500">{status}</p>}

      {transcriptReady && (
        <a
          href={transcript.downloadUrl()}
          className="self-start rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700"
          download
        >
          ⬇ Download interview transcript (.txt)
        </a>
      )}

      {evaluation && (
        <pre className="overflow-auto rounded-2xl border bg-slate-900 p-4 text-xs text-slate-100">
          {JSON.stringify(evaluation, null, 2)}
        </pre>
      )}
    </div>
  );
}
