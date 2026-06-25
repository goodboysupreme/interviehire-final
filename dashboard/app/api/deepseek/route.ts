import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Abuse guards for an endpoint that spends a paid API key on every call.
// 120/min: bulk resume analysis fires one call/resume at concurrency 4, alongside
// JD/question/criteria generation. DeepSeek's own account limit is the real
// ceiling. ponytail: bump here if a batch still trips it.
const RATE_LIMIT = 120;           // requests allowed per window, per IP
const RATE_WINDOW_MS = 60_000;    // sliding window length
const MAX_MESSAGES = 30;          // cap conversation length forwarded upstream
const MAX_TOTAL_CHARS = 50_000;   // cap total prompt size forwarded upstream

// Per-task model allowlist — callers pick a model per task; we never forward an
// arbitrary model string at the paid key. v4-pro = stronger judgement,
// v4-flash = fast/light (both support JSON mode + temperature).
const ALLOWED_MODELS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);

// In-memory limiter. Adequate as a basic guard, but it only protects a single
// warm serverless instance and resets on cold start — for real protection back
// this with a shared store (Vercel KV / Upstash Redis).
const hits = new Map<string, number[]>(); // ip -> number[] (request timestamps within the window)

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t: number) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function clientIp(req: Request) {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim();
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY environment variable is not set on the server.' },
      { status: 500 }
    );
  }

  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }

  try {
    const { messages, jsonMode, model, temperature } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
    }
    if (messages.length > MAX_MESSAGES) {
      return NextResponse.json({ error: `Too many messages (max ${MAX_MESSAGES})` }, { status: 400 });
    }
    const totalChars = messages.reduce((n: number, m: any) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return NextResponse.json({ error: 'Prompt too large' }, { status: 413 });
    }

    const useModel = ALLOWED_MODELS.has(model) ? model : 'deepseek-v4-flash';
    // Per-request temperature (clamped); default 0.7 so creative callers (JD,
    // questions, suggestions) keep their variety. Resume scoring passes a low value.
    const temp = (typeof temperature === 'number' && temperature >= 0 && temperature <= 2) ? temperature : 0.7;
    const payload: Record<string, any> = { model: useModel, messages, temperature: temp, max_tokens: 4096 };
    if (jsonMode) payload.response_format = { type: 'json_object' };

    const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to reach DeepSeek API', detail: err.message }, { status: 502 });
  }
}
