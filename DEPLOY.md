# Deployment Guide — Live Demo for Judges

Deploy CodeReview AI so judges can try it without local setup. Recommended: **Vercel** (dashboard) + **Railway** or **Render** (backend).

---

## Option A: One-Click DigitalOcean App Platform

If your repo is on GitHub:

1. Fork/clone the repo
2. Create a [DigitalOcean App](https://cloud.digitalocean.com/apps/new)
3. Use the `.do/app.yaml` config — replace `$REPO` with `owner/repo`
4. Add secrets: `GRADIENT_MODEL_ACCESS_KEY`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
5. Deploy — App Platform provisions DB, webhook, inference, and dashboard

> **Troubleshooting:** See [DEPLOY_TROUBLESHOOTING.md](./DEPLOY_TROUBLESHOOTING.md) for database permission issues and startup failures.

**Dashboard URL:** `https://<your-app>.ondigitalocean.app` (or your custom domain)

---

## Option B: Vercel (Dashboard) + Railway (Backend)

### 1. Deploy Backend (Railway or Render)

**Railway:**

1. Create project at [railway.app](https://railway.app)
2. Add PostgreSQL (or use Neon/Supabase)
3. Add three services from this repo:
   - **webhook-service** — `apps/webhook-service`, set `DATABASE_URL`, `INFERENCE_SERVICE_URL`
   - **inference-service** — `apps/inference-service`, set `GRADIENT_MODEL_ACCESS_KEY`, `GRADIENT_MODEL`
   - **dashboard** — optional if using Vercel
4. Get the webhook service public URL (e.g. `https://webhook-xxx.railway.app`)

**Render:**

1. Create Web Service for `apps/webhook-service`
2. Create Web Service for `apps/inference-service`
3. Add PostgreSQL or use external DB
4. Set `INFERENCE_SERVICE_URL` on webhook to inference service URL

### 2. Deploy Dashboard (Vercel)

1. Push repo to GitHub
2. [Import to Vercel](https://vercel.com/new)
3. **Root Directory:** `apps/dashboard`
4. **Environment Variable:** `VITE_API_URL` = your webhook service URL (e.g. `https://webhook-xxx.railway.app`)
5. Deploy

**Important:** `VITE_API_URL` is baked in at build time. Redeploy if you change the backend URL.

### 3. CORS

Set `CORS_ORIGIN` on the webhook service to your dashboard URL (e.g. `https://codereview-ai.vercel.app`).

---

## Option C: Docker Compose on a VPS

```bash
# On a VPS (DigitalOcean Droplet, etc.)
git clone https://github.com/your-org/codereview-ai
cd codereview-ai

# Set all env vars in .env
docker compose up -d

# Nginx/Caddy reverse proxy for SSL
# Dashboard: https://your-domain/
# API: https://your-domain/ (or api.your-domain)
```

---

## Live Demo Checklist for Judges

- [ ] Dashboard URL works and loads
- [ ] "Generate demo data" creates sample findings
- [ ] Accept/Reject persists (pattern learning after 3+ accepts)
- [ ] Team Patterns section updates
- [ ] No CORS errors in browser console

## Submitting Your Demo URL

Add your live demo URL to the Devpost submission in the **"Try it out"** or **"Link"** field.
