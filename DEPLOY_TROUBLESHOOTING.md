# Deployment Troubleshooting (DigitalOcean App Platform)

## Database permission denied for schema `public`

**Error:** `permission denied for schema public` when Prisma runs migrations or db push.

**Cause:** The database user created by App Platform may not have full privileges on the `public` schema (common with managed PostgreSQL).

### Fix 1: Grant privileges (recommended)

Connect to your database with an admin/superuser (e.g. from the [DigitalOcean Control Panel](https://cloud.digitalocean.com/databases) → your cluster → Connection details):

```sql
-- Replace <db_user> with the user in your DATABASE_URL (usually doadmin or similar)
GRANT ALL PRIVILEGES ON SCHEMA public TO <db_user>;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO <db_user>;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO <db_user>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO <db_user>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO <db_user>;
```

Then redeploy the webhook-service.

### Fix 2: Use a managed Postgres cluster

If the App Platform dev database consistently has permission issues:

1. Create a [Managed PostgreSQL](https://cloud.digitalocean.com/databases/new) cluster in the same region.
2. Get the connection string and set `DATABASE_URL` on the webhook-service (in App Platform → your app → webhook-service → Settings → App-Level Environment Variables).
3. Remove or override the `${codereview-db.DATABASE_URL}` binding for webhook-service.

---

## Application startup failure / health checks failing

**Error:** Health checks fail, connection refused on port 3000, app marked unhealthy.

**Cause:** The webhook-service runs `prisma db push` at startup before listening on port 3000. If the DB is slow or permissions fail, the app never starts and health checks fail immediately.

### What we've done

- **Health check delay:** `initial_delay_seconds: 60` in `.do/app.yaml` so health checks wait for `prisma db push` + app startup.
- **Entrypoint logging:** `scripts/docker-entrypoint.sh` logs each step; if `prisma db push` fails, the container exits with a clear error.

### If it still fails

1. Check **Runtime Logs** for webhook-service in the App Platform console.
2. Look for `[entrypoint] FATAL: prisma db push failed` — indicates DB connection or permission issues.
3. Verify `DATABASE_URL` is set correctly and the database is reachable from App Platform.
4. If using the built-in App Platform database, try Fix 1 or Fix 2 above.

---

## Gradient AI / inference service

- Set `GRADIENT_MODEL_ACCESS_KEY` (secret) on the inference-service.
- Ensure `GRADIENT_MODEL` matches a model you have access to (default: `anthropic-claude-3.5-sonnet`).
