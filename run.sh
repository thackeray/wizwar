#!/usr/bin/env bash
# One-command local start: install deps if missing, then launch the dev server.
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)..."
  npm install
fi
exec npm run dev
