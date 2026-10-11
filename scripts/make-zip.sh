#!/bin/sh
# Packs the project for submission (no node_modules, build output or local secrets).
# Usage: sh scripts/make-zip.sh  →  ../harharetki.zip
set -e
cd "$(dirname "$0")/.."
OUT="../harharetki.zip"
rm -f "$OUT"
zip -qr -9 "$OUT" . \
  -x "node_modules/*" ".next/*" ".vercel/*" ".turbo/*" "public/maplibre-gl-worker.mjs" \
     "AGENTS.md" "CLAUDE.md" "*.DS_Store" "*.tsbuildinfo" "next-env.d.ts" ".env*" "*.log"
ls -la "$OUT"
