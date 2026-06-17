import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  transpilePackages: ['@interviehire/shared', '@convai/web-sdk', 'react-icons'],
  webpack: (config) => {
    config.resolve.alias['react-icons'] = path.resolve(__dirname, '../../node_modules/react-icons');
    return config;
  }
};
export default nextConfig;
