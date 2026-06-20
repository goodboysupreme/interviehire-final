import type { NextConfig } from 'next';

// The candidate room is a fully client-rendered SPA (no API routes, no
// middleware, no server features) — it talks to the engine API from the
// browser. Static export means Vercel ships plain files on its CDN with NO
// serverless function, which sidesteps the monorepo function-tracing bug
// (`noop.js` → cannot find next/dist/.../server.runtime.prod.js).
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  transpilePackages: ['@interviehire/shared', '@convai/web-sdk']
};

export default nextConfig;
