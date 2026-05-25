import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Bundle the DB client (+ its undici transport) whole into each serverless
  // function so Vercel's per-function tracing doesn't drop a libsql runtime dep.
  serverExternalPackages: ['@libsql/client', 'undici'],
};

export default nextConfig;
