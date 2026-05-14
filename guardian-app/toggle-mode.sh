#!/bin/bash
# toggle-mode.sh — switch Guardian app between Tauri and Next.js mode
# Usage: bash toggle-mode.sh [tauri|nextjs]

MODE=$1
if [[ "$MODE" != "tauri" && "$MODE" != "nextjs" ]]; then
  echo "Usage: bash toggle-mode.sh [tauri|nextjs]"
  exit 1
fi

SIDECAR_BOOT="src/lib/sidecar-boot.ts"
CLOAK_BRIDGE="src/lib/cloak-bridge.ts"
QVAC_GUARDIAN="src/lib/qvac_guardian.ts"

if [[ "$MODE" == "nextjs" ]]; then
  sed -i "s|http://127.0.0.1:7647/health|/api/signing/health|g" $SIDECAR_BOOT
  sed -i "s|http://127.0.0.1:7648/health|/api/qvac/health|g"    $SIDECAR_BOOT
  sed -i "s|const BASE = \"http://127.0.0.1:7647\"|const BASE = \"/api/signing\"|g" $CLOAK_BRIDGE
  sed -i "s|const QVAC_BASE = 'http://127.0.0.1:7648'|const QVAC_BASE = '/api/qvac'|g" $QVAC_GUARDIAN
  echo "✅ Switched to Next.js mode (proxy paths)"

elif [[ "$MODE" == "tauri" ]]; then
  sed -i "s|/api/signing/health|http://127.0.0.1:7647/health|g" $SIDECAR_BOOT
  sed -i "s|/api/qvac/health|http://127.0.0.1:7648/health|g"    $SIDECAR_BOOT
  sed -i "s|const BASE = \"/api/signing\"|const BASE = \"http://127.0.0.1:7647\"|g" $CLOAK_BRIDGE
  sed -i "s|const QVAC_BASE = '/api/qvac'|const QVAC_BASE = 'http://127.0.0.1:7648'|g" $QVAC_GUARDIAN
  echo "✅ Switched to Tauri mode (direct localhost)"
fi
