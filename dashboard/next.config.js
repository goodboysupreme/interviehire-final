/** @type {import('next').NextConfig} */

// When BACKEND_ORIGIN is set (e.g. the Render URL in Vercel), proxy the FastAPI
// backend paths through this app's own origin. This keeps the auth cookie
// first-party (the browser talks only to the dashboard domain), so cross-site
// SameSite=Lax cookies work without any backend change. Inert when unset, so
// local dev keeps calling the backend directly via NEXT_PUBLIC_API_URL.
const backendOrigin = (process.env.BACKEND_ORIGIN || '').replace(/\/$/, '');

const BACKEND_API_PREFIXES = [
  'auth', 'jobs', 'team', 'organisation', 'usage', 'settings', 'public', 'leaderboard',
  'talent-finder',
];

const nextConfig = {
  serverExternalPackages: ['@napi-rs/canvas'],
  async rewrites() {
    if (!backendOrigin) return [];
    // Note: /api/deepseek, /api/parse-file and /api/fetch-doc are this app's own
    // route handlers and are intentionally NOT proxied.
    //
    // Proxy BOTH the bare collection path and its sub-paths. The bare-path entry
    // (listed first) is essential: without it, a request like "/api/jobs" matches
    // the wildcard with an empty segment and is proxied as "/api/jobs/" (trailing
    // slash). FastAPI then 307-redirects that to an absolute backend URL, leaking
    // the cross-origin backend host to the browser and breaking CORS. Proxying the
    // bare path keeps the whole request first-party (cookie stays same-origin).
    return BACKEND_API_PREFIXES.flatMap((p) => [
      { source: `/api/${p}`, destination: `${backendOrigin}/api/${p}` },
      { source: `/api/${p}/:path*`, destination: `${backendOrigin}/api/${p}/:path*` },
    ]);
  },
};

export default nextConfig;
