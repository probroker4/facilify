import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist', 'nodemailer', 'xlsx'],
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
  poweredByHeader: false,
};

export default nextConfig;
