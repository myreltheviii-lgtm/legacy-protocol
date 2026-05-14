#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

const ROOT = '/workspaces/legacy-protocol/guardian-app';
const SRC  = path.join(ROOT, 'src');
const BAK  = path.join(ROOT, '.migrate-backup');

const target = process.argv[3];
if (process.argv[2] !== '--to' || !['nextjs', 'tauri'].includes(target)) {
  console.error('Usage: node migrate.js --to [nextjs|tauri]');
  process.exit(1);
}

function read(p)     { return fs.readFileSync(p, 'utf8'); }
function write(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8'); }
function del(p)      { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

const FILES = {
  useVaultData: path.join(SRC, 'hooks/useVaultData.ts'),
  sdk:          path.join(SRC, 'lib/sdk.ts'),
  cloakBridge:  path.join(SRC, 'lib/cloak-bridge.ts'),
  sidecarBoot:  path.join(SRC, 'lib/sidecar-boot.ts'),
  packageJson:  path.join(ROOT, 'package.json'),
  nextConfig:   path.join(ROOT, 'next.config.js'),
  pagesIndex:   path.join(ROOT, 'pages/index.tsx'),
  pagesApp:     path.join(ROOT, 'pages/_app.tsx'),
  envLocal:     path.join(ROOT, '.env.local'),
  startScript:  path.join(ROOT, 'start.sh'),
};

function backup(file, name) {
  write(path.join(BAK, name), read(file));
}

function restore(name, file) {
  const bak = path.join(BAK, name);
  if (fs.existsSync(bak)) {
    write(file, read(bak));
    console.log('✓ restored ' + name);
  } else {
    console.warn('⚠ no backup found for ' + name + ' — skipped');
  }
}

function toNextjs() {
  console.log('Migrating to Next.js...');

  // Save backups of files we will modify
  fs.mkdirSync(BAK, { recursive: true });
  backup(FILES.useVaultData, 'useVaultData.ts');
  backup(FILES.sdk,          'sdk.ts');
  backup(FILES.cloakBridge,  'cloak-bridge.ts');
  backup(FILES.sidecarBoot,  'sidecar-boot.ts');
  backup(FILES.packageJson,  'package.json');
  console.log('✓ backups saved to .migrate-backup/');

  // useVaultData.ts
  let uv = read(FILES.useVaultData);
  uv = uv.replace(
    "import.meta.env.VITE_WATCHER_URL as string ?? ''",
    "process.env.NEXT_PUBLIC_WATCHER_URL ?? ''"
  );
  write(FILES.useVaultData, uv);
  console.log('✓ useVaultData.ts');

  // sdk.ts
  let sdk = read(FILES.sdk);
  sdk = sdk.replace(
    "import.meta.env.VITE_SOLANA_RPC_ENDPOINT as string | undefined",
    "process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT as string | undefined"
  );
  sdk = sdk.replace("import { fetch as tauriFetch } from '@tauri-apps/plugin-http';\n", '');
  write(FILES.sdk, sdk);
  console.log('✓ sdk.ts');

  // cloak-bridge.ts
  let cb = read(FILES.cloakBridge);
  cb = cb.replace("import { fetch as tauriFetch } from '@tauri-apps/plugin-http';\n", '');
  cb = cb.replace("import { fetch } from '@tauri-apps/plugin-http';\n", '');
  cb = cb.replace(/tauriFetch\(/g, 'fetch(');
  write(FILES.cloakBridge, cb);
  console.log('✓ cloak-bridge.ts');

  // sidecar-boot.ts
  let sb = read(FILES.sidecarBoot);
  sb = sb.replace("import { fetch as tauriFetch } from '@tauri-apps/plugin-http';\n", '');
  sb = sb.replace("import { fetch } from '@tauri-apps/plugin-http';\n", '');
  sb = sb.replace(/tauriFetch\(/g, 'fetch(');
  write(FILES.sidecarBoot, sb);
  console.log('✓ sidecar-boot.ts');

  // pages/_app.tsx
  write(FILES.pagesApp, `// pages/_app.tsx
import type { AppProps } from 'next/app';
import '../src/styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
`);
  console.log('✓ pages/_app.tsx');

  // pages/index.tsx
  write(FILES.pagesIndex, `// pages/index.tsx
import dynamic from 'next/dynamic';

const App = dynamic(() => import('../src/App'), { ssr: false });

export default function Home() {
  return <App />;
}
`);
  console.log('✓ pages/index.tsx');

  // globals.css
  write(path.join(ROOT, 'src/styles/globals.css'), `* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1512; }
@keyframes spin { to { transform: rotate(360deg); } }
`);
  console.log('✓ src/styles/globals.css');

  // next.config.js
  write(FILES.nextConfig, `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
};
module.exports = nextConfig;
`);
  console.log('✓ next.config.js');

  // .env.local
  if (!fs.existsSync(FILES.envLocal)) {
    write(FILES.envLocal, `NEXT_PUBLIC_WATCHER_URL=http://127.0.0.1:3001
NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
`);
    console.log('✓ .env.local');
  }

  // start.sh
  write(FILES.startScript, `#!/bin/bash
echo "Starting signing-service..."
node /workspaces/legacy-protocol/signing-service/index.js &
SIGNING_PID=$!

echo "Starting qvac-sidecar..."
node /workspaces/legacy-protocol/qvac-sidecar/index.js &
QVAC_PID=$!

echo "Starting watcher..."
cd /workspaces/legacy-protocol/watcher && npm start &
WATCHER_PID=$!

echo "Waiting for sidecars..."
sleep 3

echo "Starting Guardian Next.js..."
cd /workspaces/legacy-protocol/guardian-app && npm run dev

trap "kill $SIGNING_PID $QVAC_PID $WATCHER_PID 2>/dev/null" EXIT
`);
  fs.chmodSync(FILES.startScript, '755');
  console.log('✓ start.sh');

  // package.json
  const pkg = JSON.parse(read(FILES.packageJson));
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['next'] = '^14.0.0';
  pkg.scripts['dev']        = 'next dev -p 3000';
  pkg.scripts['build:next'] = 'next build';
  pkg.scripts['start:next'] = 'next start';
  pkg.scripts['start:all']  = 'bash start.sh';
  write(FILES.packageJson, JSON.stringify(pkg, null, 2));
  console.log('✓ package.json');

  console.log('\n✅ Migration to Next.js complete.');
  console.log('Run: npm install && bash start.sh');
  console.log('Then open: http://localhost:3000');
}

function toTauri() {
  console.log('Migrating back to Tauri...');

  // Restore all modified source files from backup
  restore('useVaultData.ts', FILES.useVaultData);
  restore('sdk.ts',          FILES.sdk);
  restore('cloak-bridge.ts', FILES.cloakBridge);
  restore('sidecar-boot.ts', FILES.sidecarBoot);
  restore('package.json',    FILES.packageJson);

  // Remove Next.js files
  del(path.join(ROOT, 'pages'));
  del(FILES.nextConfig);
  del(FILES.startScript);
  del(path.join(ROOT, 'src/styles'));
  del(path.join(ROOT, '.next'));
  del(BAK);
  console.log('✓ Next.js files removed');

  console.log('\n✅ Migration back to Tauri complete.');
  console.log('Run: npm install && npm run build');
}

if (target === 'nextjs') toNextjs();
else toTauri();
