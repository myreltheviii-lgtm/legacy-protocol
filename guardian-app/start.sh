#!/bin/bash
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
