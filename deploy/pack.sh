#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-facilify-deploy.tar.gz}"
tar -czf "$OUT" \
  --exclude='node_modules' --exclude='.next' --exclude='.next-*' --exclude='data' --exclude='.env' --exclude='.env.*' \
  --exclude='.unlazy' --exclude='tmp-shots' --exclude='test-results' --exclude='*.tsbuildinfo' --exclude='.DS_Store' \
  src assets package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs next-env.d.ts \
  scripts/demo test-data docs README.md deploy

echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
echo "Next: scp it and deploy/bootstrap.sh to your server (see deploy/DEPLOY.md, step 5)."
