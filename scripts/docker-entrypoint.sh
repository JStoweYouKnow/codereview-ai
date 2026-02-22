#!/bin/sh
set -e
echo "[entrypoint] Starting CodeReview AI webhook-service..."
# Sync schema to DB at startup (db push creates missing tables; migrate deploy can have sync issues)
echo "[entrypoint] Running prisma db push..."
cd /app/packages/db
if ! npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss; then
  echo "[entrypoint] FATAL: prisma db push failed. Check DATABASE_URL and DB permissions (see DEPLOY_TROUBLESHOOTING.md)."
  exit 1
fi
echo "[entrypoint] Schema synced. Starting Node app..."
exec node /app/apps/webhook-service/dist/index.js
