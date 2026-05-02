import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solana wallet adapter packages ship CommonJS modules that Next.js needs
  // to transpile rather than treating as external ESM.
  transpilePackages: [
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-phantom",
    "@solana/wallet-adapter-solflare",
    "@legacy-protocol/sdk",
  ],
  webpack: (config) => {
    // Required for @solana/web3.js and related packages that reference Node.js
    // built-ins in a browser context.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs:     false,
      net:    false,
      tls:    false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;

