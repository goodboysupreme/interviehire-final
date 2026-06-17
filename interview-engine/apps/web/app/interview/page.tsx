'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WS_URL, API_URL } from '@/lib/api';
import { GazeCalibration } from '@/hooks/GazeCalibration';
import { useProctoring } from '@/hooks/useProctoring';
import { useSpeechMetrics } from '@/hooks/useSpeechMetrics';
import { MonitorUp, ShieldCheck, Video } from 'lucide-react';
import type { CalibrationResult } from '@/hooks/useGazeCalibration';
import { roomStyles } from './roomStyles';

const AVATAR_URL = process.env.NEXT_PUBLIC_AVATAR_URL || 'http://localhost:80';

function withPixelStreamingParams(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('AutoConnect')) url.searchParams.set('AutoConnect', 'true');
    if (!url.searchParams.has('HoveringMouse')) url.searchParams.set('HoveringMouse', 'true');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const QUESTIONS: { text: string; tag: string; hint: string }[] = [
  {
    text: 'Tell me about a time you handled a difficult situation at work — what was the context, and how did you navigate it?',
    tag: 'Behavioural',
    hint: 'Take a breath. Aim for a 60–90 second answer.',
  },
  {
    text: 'Walk me through a project you are most proud of. What was your specific contribution and the measurable outcome?',
    tag: 'Experience',
    hint: 'Use numbers where you can. Keep it focused on your role.',
  },
  {
    text: 'Describe a disagreement you had with a teammate. How did you reach a resolution?',
    tag: 'Teamwork',
    hint: 'Show how you listen, not just how you argue.',
  },
  {
    text: 'Where do you see the biggest opportunity for impact in this role within your first 90 days?',
    tag: 'Strategy',
    hint: 'Be specific and tie it back to the company.',
  },
];

export default function Interview() {
  const [sessionId, setSessionId] = useState('demo-session');
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([
    { speaker: 'ai', text: 'Welcome. I will ask a few structured questions. Please answer naturally with examples.' },
  ]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const { markAiFinished } = useSpeechMetrics();
  const wsRef = useRef<WebSocket | null>(null);
  const sessionStartedRef = useRef(false);

  const avatarSrc = useMemo(() => withPixelStreamingParams(AVATAR_URL), []);

  // The dashboard's "Launch test interview" opens this room with ?sessionId=…
  // (the FastAPI test-session created from the job blueprint). Use it when
  // present; otherwise fall back to the keyless demo session below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const queryId = params.get('sessionId') || params.get('session');
    if (queryId) setSessionId(queryId);
  }, []);

  // --- WebSocket + demo session bootstrap (unchanged proctoring contract) ---
  useEffect(() => {
    let alive = true;
    async function bootstrapDemoSession() {
      if (sessionId !== 'demo-session') return;
      try {
        const res = await fetch(`${API_URL}/api/interview/demo-session`);
        if (!res.ok) return;
        const json = await res.json();
        if (alive && json?.sessionId) setSessionId(json.sessionId);
      } catch (error) {
        console.error('demo-session bootstrap failed', error);
      }
    }
    bootstrapDemoSession();
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'register', role: 'candidate', sessionId }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'ai_response') {
        setMessages((m) => [...m, { speaker: 'ai', text: msg.text }]);
        markAiFinished();
      }
    };
    setSocket(ws);
    return () => {
      alive = false;
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // --- Proctoring engine (all features) ---
  const { videoRef, events, state, requestRequiredPermissions, startProctoringSession, endProctoringSession } = useProctoring(sessionId, socket, calibration);

  // --- Lock scroll to a fullscreen room while mounted ---
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // --- Proctoring debug overlay: toggle with Ctrl+Shift+D (or backtick `) ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') || e.key === '`') {
        e.preventDefault();
        setShowDebug((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Elapsed timer (starts once calibration is done) ---
  useEffect(() => {
    if (!calibration) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [calibration]);

  // --- Recording lifecycle ---
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordingStatus, setRecordingStatus] = useState('Idle');

  function startRecording() {
    try {
      const original = videoRef.current?.srcObject as MediaStream | null;
      if (!original) {
        setRecordingStatus('Grant camera access first');
        return;
      }
      const mr = new MediaRecorder(original, { mimeType: 'video/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (ev: any) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const form = new FormData();
        form.append('file', blob, `recording-${Date.now()}.webm`);
        setRecordingStatus('Uploading recording…');
        try {
          await fetch(`${API_URL}/api/interview/sessions/${sessionId}/recording`, { method: 'POST', body: form });
          setRecordingStatus('Recording uploaded');
        } catch {
          setRecordingStatus('Recording upload failed');
        }
      };
      recorderRef.current = mr;
      mr.start();
      setRecordingStatus('Recording video + audio');
    } catch (err) {
      console.error('startRecording error', err);
    }
  }

  // --- Auto-start the recorded session once calibrated + connected ---
  useEffect(() => {
    if (!calibration || sessionStartedRef.current) return;
    if (socket?.readyState !== WebSocket.OPEN) return;
    sessionStartedRef.current = true;
    (async () => {
      try {
        setRecordingStatus('Starting session…');
        // Engage the engine's proctoring engine (gaze/face/object/tab/etc) and
        // its integrity scoring — detection is gated until this is called.
        startProctoringSession();
        await fetch(`${API_URL}/api/interview/sessions/${sessionId}/start`, { method: 'POST' });
        startRecording();
      } catch (err) {
        console.error('startSession failed', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibration, socket]);

  async function endCall() {
    try {
      recorderRef.current?.stop();
      // Stop proctoring + finalise the integrity score, then persist + evaluate.
      endProctoringSession();
      await fetch(`${API_URL}/api/interview/sessions/${sessionId}/complete`, { method: 'POST' });
      await fetch(`${API_URL}/api/interview/sessions/${sessionId}/evaluate`, { method: 'POST' });
      setRecordingStatus('Session completed — you can close this tab.');
    } catch (err) {
      console.error('endCall failed', err);
    }
  }

  function toggleMic() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const next = !micOn;
    stream?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }

  function toggleCam() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const next = !camOn;
    stream?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }

  // --- Permission gate state ---
  const cameraReady = state.cameraActive && !state.permissionDenied;
  const screenShareReady = !state.screenShareSupported || state.screenShareReadyBeforeInterview;
  const permissionsReadyForCalibration = cameraReady && screenShareReady;

  // --- Live integrity computation ---
  const activeViolation = useMemo(() => {
    const high = events.find((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL');
    return high || events[0] || null;
  }, [events]);

  const integrity = activeViolation
    ? { label: prettyEvent(activeViolation.eventType), tone: 'alert' as const }
    : state.gazeAwayDetected
    ? { label: `Looking ${state.gazeDirection ?? 'away'}`, tone: 'warn' as const }
    : { label: 'Monitored', tone: 'ok' as const };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const clock = `${mm}:${ss}`;
  const question = QUESTIONS[questionIndex];

  return (
    <>
      <style>{roomStyles}</style>

      {/* Pre-interview permission gate */}
      {!calibration && !permissionsReadyForCalibration && (
        <div className="gate">
          <div className="gate-card">
            <p className="gate-eyebrow">Pre-interview access</p>
            <h1 className="gate-title">Grant access before gaze calibration</h1>
            <p className="gate-sub">
              Camera and screen sharing are checked now. Gaze calibration starts only after these are ready.
            </p>
            <div className="gate-checks">
              {[
                {
                  label: 'Camera',
                  ok: cameraReady,
                  detail: state.permissionDenied
                    ? 'Permission denied'
                    : state.cameraActive
                    ? 'Ready'
                    : 'Waiting for browser permission',
                  Icon: Video,
                },
                {
                  label: 'Screen share',
                  ok: screenShareReady,
                  detail: !state.screenShareSupported
                    ? 'Unavailable in this browser'
                    : state.screenShareReadyBeforeInterview
                    ? 'Ready'
                    : 'Required before calibration',
                  Icon: MonitorUp,
                },
              ].map(({ label, ok, detail, Icon }) => (
                <div key={label} className="gate-check">
                  <div className="gate-check-l">
                    <Icon size={18} className={ok ? 'ok-ico' : 'wait-ico'} />
                    <div>
                      <p className="gate-check-label">{label}</p>
                      <p className="gate-check-detail">{detail}</p>
                    </div>
                  </div>
                  <span className={`gate-dot ${ok ? 'is-ok' : 'is-wait'}`} />
                </div>
              ))}
            </div>
            <button onClick={() => requestRequiredPermissions()} className="gate-btn">
              <ShieldCheck size={18} /> Grant required access
            </button>
            {state.permissionDenied && (
              <p className="gate-error">
                Camera access was denied. Allow camera access in your browser settings, then refresh this page.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Gaze calibration */}
      {!calibration && permissionsReadyForCalibration && (
        <GazeCalibration
          videoRef={videoRef}
          onComplete={setCalibration}
          onSkip={() =>
            setCalibration({
              thresholdX: 0.18,
              thresholdY: 0.22,
              neutralX: 0,
              neutralY: 0,
              pointData: [],
              qualityScore: 0,
            })
          }
        />
      )}

      {/* ===== Interview room ===== */}
      <div className="room">
        <header className="topbar">
          <div className="brand">
            <div className="logo">✦</div>
            <div className="brand-name">
              Intervie<span>Hire</span>
            </div>
            <div className="room-label">AI Interview Room</div>
          </div>
          <div className="job-pill">
            <i className="live-dot" />
            <strong>Associate Consultant Screening</strong>
            <span>Round 1</span>
          </div>
          <div className="connection">
            <span className={`integrity ${integrity.tone}`}>
              <ShieldCheck size={14} />
              {integrity.label}
            </span>
            <span className="bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="connection-text">
              {socket?.readyState === WebSocket.OPEN ? 'Excellent connection' : 'Connecting…'}
            </span>
            <span className="timer">{clock}</span>
          </div>
        </header>

        <main className="content">
          <section className="avatar-panel">
            <iframe
              className="pixel-frame"
              src={avatarSrc}
              title="Unreal Engine Pixel Streaming Avatar"
              allow="microphone; camera; autoplay; fullscreen; gamepad; xr-spatial-tracking"
              referrerPolicy="no-referrer"
            />
            <div className="avatar-overlay" />
            <div className="identity">
              <div className="identity-icon">✦</div>
              <div>
                <strong>Lina</strong>
                <span>AI Interviewer</span>
              </div>
            </div>
            <div className="status-pill">
              <i className="red-dot" /> Live · Associate
            </div>
          </section>

          <aside className="right-stack">
            <section className="candidate-panel">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="candidate-video"
                style={{ opacity: calibration && camOn ? 1 : 0 }}
              />
              {!camOn && <div className="cam-off">Camera off</div>}
              <div className="you-pill">
                <i /> You
              </div>
              <div className="candidate-footer">
                <div className="mini-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="mic">{micOn ? '🎙' : '🔇'}</div>
              </div>
            </section>

            <section className="question-card">
              <div className="question-top">
                <div>
                  <h2>{question.text}</h2>
                  <div className="question-meta">
                    Question {String(questionIndex + 1).padStart(2, '0')}/
                    {String(QUESTIONS.length).padStart(2, '0')}
                  </div>
                </div>
                <div className="tag">{question.tag}</div>
              </div>
              <p>{question.hint}</p>
              <div className="question-actions">
                <button
                  className="circle-btn"
                  type="button"
                  disabled={questionIndex === 0}
                  onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                >
                  ‹
                </button>
                <button
                  className="next-btn"
                  type="button"
                  onClick={() => setQuestionIndex((i) => Math.min(QUESTIONS.length - 1, i + 1))}
                >
                  NEXT ›
                </button>
              </div>
            </section>
          </aside>
        </main>

        <footer className="controlbar">
          <div className="control-time">
            <i className="red-dot" />
            <span>{clock}</span>
            <span className="elapsed-label">Elapsed · {recordingStatus}</span>
            <button type="button" className="debug-toggle" onClick={() => setShowDebug((v) => !v)} title="Toggle proctoring debug (Ctrl+Shift+D or ` )">
              🐞 Debug
            </button>
          </div>
          <div className="control-actions">
            <button type="button" title="Microphone" onClick={toggleMic} className={micOn ? '' : 'muted'}>
              {micOn ? '🎙' : '🔇'}
            </button>
            <button type="button" title="Camera" onClick={toggleCam} className={camOn ? '' : 'muted'}>
              {camOn ? '▣' : '◻'}
            </button>
            <button className="end" type="button" title="End call" onClick={endCall}>
              ☎
            </button>
          </div>
        </footer>

        {showDebug && (
          <div className="debug-panel">
            <div className="debug-head">
              <strong>Proctoring debug</strong>
              <button type="button" onClick={() => setShowDebug(false)} title="Close (Ctrl+Shift+D)">
                ✕
              </button>
            </div>

            <div className="debug-section-title">Pipeline</div>
            <div className="debug-grid">
              <DebugRow label="Session" value={sessionId} />
              <DebugRow label="WebSocket" value={wsLabel(socket)} ok={socket?.readyState === WebSocket.OPEN} />
              <DebugRow label="Calibrated" value={calibration ? `yes (q=${calibration.qualityScore})` : 'no'} ok={!!calibration} />
              <DebugRow label="Recording" value={recordingStatus} />
            </div>

            <div className="debug-section-title">Live proctoring state</div>
            <div className="debug-grid">
              {Object.entries(state).map(([k, v]) => (
                <DebugRow key={k} label={k} value={formatVal(v)} ok={toOk(k, v)} />
              ))}
            </div>

            <div className="debug-section-title">Integrity events ({events.length})</div>
            <div className="debug-events">
              {events.length ? (
                events
                  .slice(-30)
                  .reverse()
                  .map((e, i) => (
                    <div key={i} className={`debug-event sev-${(e.severity || 'LOW').toLowerCase()}`}>
                      <span className="debug-event-type">{e.eventType}</span>
                      <span className="debug-event-sev">{e.severity}</span>
                      {e.metadata ? (
                        <pre className="debug-event-meta">{JSON.stringify(e.metadata)}</pre>
                      ) : null}
                    </div>
                  ))
              ) : (
                <p className="debug-empty">No events flagged yet — proctoring is watching.</p>
              )}
            </div>

            <div className="debug-foot">Last AI msg: {messages[messages.length - 1]?.text?.slice(0, 80) ?? '—'}</div>
          </div>
        )}
      </div>
    </>
  );
}

function DebugRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="debug-row">
      <span className="debug-row-k">
        {ok === undefined ? null : <i className={`debug-dot ${ok ? 'is-ok' : 'is-bad'}`} />}
        {label}
      </span>
      <span className="debug-row-v">{value}</span>
    </div>
  );
}

function wsLabel(ws: WebSocket | null) {
  if (!ws) return 'none';
  return ['connecting', 'open', 'closing', 'closed'][ws.readyState] ?? String(ws.readyState);
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Green dot = healthy/desired; red dot = something flagged or inactive.
function toOk(key: string, v: unknown): boolean | undefined {
  if (typeof v !== 'boolean') return undefined;
  const badWhenTrue = /denied|away|detected|off|exited|stopped|hidden|switch/i.test(key);
  return badWhenTrue ? !v : v;
}

function prettyEvent(eventType: string) {
  return eventType
    .replace(/_DETECTED$/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
