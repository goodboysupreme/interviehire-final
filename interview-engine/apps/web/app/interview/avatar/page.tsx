'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Standalone avatar route: https://<site>/interview/avatar
//
// The UE5 MetaHuman + Convai avatar runs on the HOST PC via Pixel Streaming.
// This page does NOT render the avatar itself — it embeds the PC's public stream
// endpoint (a tunnel to the PC's signalling player). WebRTC video flows directly
// from the PC to the viewer's browser (via TURN), so it works on any device.
//
// Stream URL resolution (first match wins):
//   1. ?stream=<url>            (per-load override, handy for the rotating tunnel)
//   2. NEXT_PUBLIC_AVATAR_URL   (build/deploy-time default)
//   3. http://localhost:80      (local UE signalling player)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_AVATAR_URL = process.env.NEXT_PUBLIC_AVATAR_URL || 'http://localhost:80';

function withPixelStreamingParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('AutoConnect')) url.searchParams.set('AutoConnect', 'true');
    if (!url.searchParams.has('AutoPlayVideo')) url.searchParams.set('AutoPlayVideo', 'true');
    if (!url.searchParams.has('StartVideoMuted')) url.searchParams.set('StartVideoMuted', 'false');
    if (!url.searchParams.has('HoveringMouse')) url.searchParams.set('HoveringMouse', 'true');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function AvatarRoute() {
  const params = useSearchParams();
  const [ready, setReady] = useState(false);

  const src = useMemo(() => {
    const override = params.get('stream') || params.get('avatar') || '';
    const base = override.trim() || DEFAULT_AVATAR_URL;
    return withPixelStreamingParams(base);
  }, [params]);

  // Pixel Streaming needs a user gesture before it can play audio. Show a
  // one-tap overlay; the click also satisfies autoplay policies on the iframe.
  useEffect(() => {
    if (ready && typeof window !== 'undefined') {
      // nudge focus into the iframe so keyboard/gamepad input reaches UE
      const f = document.getElementById('avatar-frame') as HTMLIFrameElement | null;
      f?.focus();
    }
  }, [ready]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05070d', overflow: 'hidden' }}>
      <iframe
        id="avatar-frame"
        src={src}
        title="IntervieHire AI Avatar"
        allow="microphone; camera; autoplay; fullscreen; gamepad; xr-spatial-tracking; clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
      />

      {!ready && (
        <button
          type="button"
          onClick={() => setReady(true)}
          style={{
            position: 'absolute', inset: 0, zIndex: 10, display: 'grid', placeItems: 'center',
            background: 'radial-gradient(60% 60% at 50% 40%, rgba(13,148,136,0.18), rgba(5,7,13,0.92))',
            color: '#e6edff', border: 'none', cursor: 'pointer', font: '600 16px system-ui',
          }}
        >
          <span style={{ display: 'grid', gap: 10, placeItems: 'center', textAlign: 'center', padding: 24 }}>
            <span style={{ fontSize: 44 }}>🎙️</span>
            <span style={{ fontSize: 20, fontWeight: 800 }}>Tap to start the AI interviewer</span>
            <span style={{ fontSize: 13, color: '#9fb2d4', maxWidth: 360 }}>
              The avatar streams live from the interview server. Allow microphone access when prompted.
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ color: '#e6edff', padding: 24, font: '14px system-ui' }}>Loading interviewer...</div>}>
      <AvatarRoute />
    </Suspense>
  );
}
