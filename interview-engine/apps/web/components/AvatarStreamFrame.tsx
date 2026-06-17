'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MonitorPlay, RotateCw } from 'lucide-react';

type AvatarStreamFrameProps = {
  url?: string;
  title: string;
  className?: string;
};

function withStablePixelStreamingParams(url?: string) {
  if (!url) return '';
  try {
    const nextUrl = new URL(url);
    if (!nextUrl.searchParams.has('AutoConnect')) nextUrl.searchParams.set('AutoConnect', 'true');
    if (!nextUrl.searchParams.has('HoveringMouse')) nextUrl.searchParams.set('HoveringMouse', 'true');
    return nextUrl.toString();
  } catch {
    return url;
  }
}

function AvatarStreamFrameBase({ url, title, className = '' }: AvatarStreamFrameProps) {
  const normalizedUrl = useMemo(() => withStablePixelStreamingParams(url), [url]);
  const iframeUrlRef = useRef(normalizedUrl);
  const [retryKey, setRetryKey] = useState(0);
  const [isConnected, setIsConnected] = useState(Boolean(url));
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isConnected || !iframeUrlRef.current || isLoaded) return;
    setIsSlow(false);
    const timer = window.setTimeout(() => setIsSlow(true), 7000);
    return () => window.clearTimeout(timer);
  }, [isConnected, isLoaded]);

  const canConnect = Boolean(iframeUrlRef.current);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-slate-950 ${className}`}>
      {isConnected && iframeUrlRef.current ? (
        <iframe
          key={retryKey}
          src={iframeUrlRef.current}
          title={title}
          className="h-full w-full border-0"
          allow="microphone; camera; autoplay; fullscreen; gamepad; xr-spatial-tracking"
          loading="eager"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setIsLoaded(true);
            setIsSlow(false);
          }}
        />
      ) : null}

      {!canConnect ? (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 text-center text-white">
          <div>
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <MonitorPlay className="text-cyan-200" size={34} />
            </div>
            <h2 className="text-xl font-black">AI Interviewer Avatar</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-cyan-100">
              Set NEXT_PUBLIC_AVATAR_URL to your Pixel Streaming URL to show the Unreal avatar here.
            </p>
          </div>
        </div>
      ) : null}

      {canConnect && isSlow && !isLoaded ? (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3 rounded-xl border border-cyan-200/20 bg-slate-950/75 px-4 py-3 text-xs text-cyan-50 shadow-2xl backdrop-blur">
          <span>Pixel Streaming is reachable. Waiting for the Unreal player to paint video.</span>
          <button
            type="button"
            onClick={() => {
              setIsLoaded(false);
              setIsSlow(false);
              setIsConnected(false);
              window.setTimeout(() => {
                setRetryKey((key) => key + 1);
                setIsConnected(true);
              }, 50);
            }}
            className="pointer-events-auto inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950"
          >
            <RotateCw size={14} />
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const AvatarStreamFrame = memo(AvatarStreamFrameBase);
