import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,

  transpilePackages: [
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-phantom",
    "@solana/wallet-adapter-solflare",
    "@legacy-protocol/sdk",
    "@legacy-protocol/cloak-integration",
    "@cloak.dev/sdk",
    "@cloak.dev/sdk-devnet",
  ],

  // Allow Next.js Image to serve optimised QR codes from the external
  // qrserver.com API used by ShamirDistributor and GuardianShareDistribution.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname:  "api.qrserver.com",
      },
    ],
  },

  // Turbopack (Next.js dev server) — separate from webpack config below.
  // resolveAlias ensures `buffer` resolves to the browser-compatible npm
  // package in Turbopack's bundler, which does NOT read the webpack() block.
  turbopack: {
    root: path.resolve(__dirname, ".."),
    resolveAlias: {
      // Map Node.js `buffer` to the browser-compatible polyfill so that any
      // SDK code referencing `Buffer` works during `next dev --turbo`.
      buffer: "buffer",
    },
  },

  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // Provide browser-compatible stubs / polyfills for Node.js built-ins.
      // `buffer` is mapped to the npm `buffer` package which ships
      // writeBigUInt64LE and the full Node.js Buffer API for the browser.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs:     false,
        net:    false,
        tls:    false,
        crypto: false,
        buffer: require.resolve("buffer/"),
      };

      // Inject Buffer as a global so legacy CommonJS modules that reference
      // `Buffer` without importing it (e.g. compiled SDK dist files) work
      // inside the browser bundle without explicit imports.
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
        }),
      );
    }

    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      "node_modules",
    ];

    return config;
  },
};

export default nextConfig;
