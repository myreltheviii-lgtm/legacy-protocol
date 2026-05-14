/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: '/api/signing/:path*', destination: 'http://127.0.0.1:7647/:path*' },
      { source: '/api/qvac/:path*',    destination: 'http://127.0.0.1:7648/:path*' },
      { source: '/api/watcher/:path*', destination: 'http://127.0.0.1:3001/:path*' },
    ];
  },
};
module.exports = nextConfig;
