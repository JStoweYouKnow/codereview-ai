#!/bin/sh
set -e
# Sync schema to DB at startup (db push creates missing tables; migrate deploy can have sync issues)
cd /app/packages/db && npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss
exec node /app/apps/webhook-service/dist/index.js
