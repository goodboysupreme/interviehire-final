/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: 'dist',
  serverExternalPackages: ['@napi-rs/canvas'],
};

export default nextConfig;
