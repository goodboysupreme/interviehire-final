import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Abuse guards for an endpoint that spends a paid API key on every call.
const RATE_LIMIT = 20;            // requests allowed per window, per IP
const RATE_WINDOW_MS = 60_000;    // sliding window length
const MAX_MESSAGES = 30;          // cap conversation length forwarded upstream
const MAX_TOTAL_CHARS = 50_000;   // cap total prompt size forwarded upstream

// In-memory limiter. Adequate as a basic guard, but it only protects a single
// warm serverless instance and resets on cold start — for real protection back
// this with a shared store (Vercel KV / Upstash Redis).
const hits = new Map(); // ip -> number[] (request timestamps within the window)

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim();
}

export async function POST(req) {
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
    const { messages, jsonMode } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
    }
    if (messages.length > MAX_MESSAGES) {
      return NextResponse.json({ error: `Too many messages (max ${MAX_MESSAGES})` }, { status: 400 });
    }
    const totalChars = messages.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return NextResponse.json({ error: 'Prompt too large' }, { status: 413 });
    }

    const payload = {
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 3000,
    };
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
  } catch (err) {
    return NextResponse.json({ error: 'Failed to reach DeepSeek API', detail: err.message }, { status: 502 });
  }
}
