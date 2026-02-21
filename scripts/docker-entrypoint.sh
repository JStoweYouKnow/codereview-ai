#!/bin/sh
set -e
# Run Prisma migrations before starting the app (DATABASE_URL is available at runtime)
cd /app/packages/db && npx prisma migrate deploy --schema=./prisma/schema.prisma
exec node /app/apps/webhook-service/dist/index.js
