'use client';

import { Suspense } from 'react';
import ConvaiVoiceRoom from './ConvaiVoiceRoom';

// Additive Convai voice/avatar interview room. The existing text room at
// /interview is left untouched; this route opts in via ?sessionId=… and reuses
// the same backend loop (/start, /answers, /complete, /evaluate).
export default function ConvaiInterviewPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <ConvaiVoiceRoom />
    </Suspense>
  );
}
