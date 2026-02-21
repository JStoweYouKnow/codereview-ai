# Testing Instructions for Judges

This document describes how to test CodeReview AI without setting up webhooks or GitHub App credentials. Use the **demo flow** for a quick evaluation.

**Gradient AI usage:** All AI analysis uses **DigitalOcean Gradient™ AI Serverless Inference** and the **Gradient Python SDK** (`gradient`). See `apps/inference-service/src/claude_handler.py` — `analyze_pr`, `extract_patterns`, and `handle_review_request` all call `client.chat.completions.create()`.

## Prerequisites

- Node.js 18+, pnpm
- Python 3.10+
- PostgreSQL (or use Docker Compose which includes it)

## 1. Start Services Locally

```bash
cd codereview-ai
pnpm install

# Run migrations
cd packages/db && npx prisma migrate deploy && cd ../..

# Start inference service (Gradient AI - requires GRADIENT_MODEL_ACCESS_KEY)
cd apps/inference-service && pip install -r requirements.txt && python src/server.py &
cd ../..

# Start webhook service and dashboard
pnpm dev:webhook &
VITE_API_URL=http://localhost:3000 pnpm dev:dashboard
```

Or use Docker Compose (set `DATABASE_URL`, `GRADIENT_MODEL_ACCESS_KEY`, `GRADIENT_MODEL`):

```bash
docker compose up --build
# Dashboard: http://localhost
# Webhook API: http://localhost:3000
```

## 2. Test the Demo Flow (No Webhooks Needed)

1. **Open the Dashboard**  
   - Local: http://localhost:5173 (Vite) or http://localhost (Docker)  
   - Production: your deployed dashboard URL  
   - Ensure `VITE_API_URL` points to the webhook service (e.g. `http://localhost:3000` or your deployed API URL)

2. **Generate demo data**  
   - If there are no reviews, you'll see an empty state with a **"Generate demo data"** button  
   - Click it to create a sample review with 3 AI findings (SQL injection, N+1, magic number)  
   - No webhooks or GitHub/GitLab setup required

3. **Explore the dashboard**  
   - Stats: Reviews Today, Total PRs, Avg Response  
   - Recent reviews list with PR link, status, findings count, relative time  
   - Expand a review → **View findings** to see severity, file, description, suggestion  
   - Use **Accept** / **Reject** on findings (data is persisted for pattern learning)

4. **API demo endpoint**  
   - `POST /api/demo/seed` — creates demo installation, repo, review, and 3 findings  
   - Example: `curl -X POST http://localhost:3000/api/demo/seed`  
   - Response: `{ "message": "Demo data created", "reviewId": "...", "findingsCount": 3 }`

## 3. Optional: Full Webhook Flow

For end-to-end testing with real PRs:

1. **GitHub App**  
   - Create a GitHub App with webhook URL `https://your-domain/webhooks/github`  
   - Permissions: Pull requests (read & write), Contents (read)  
   - Set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`  
   - Install the app on a repo and open/create a PR

2. **GitLab**  
   - Add webhook `https://your-domain/webhooks/gitlab` for Merge request events  
   - Create a Personal/Project Access Token with `api` scope → `GITLAB_TOKEN`

3. Trigger a webhook by opening a PR (GitHub) or MR (GitLab) and pushing commits; the review will appear in the dashboard once the inference service completes.

## Pattern Learning

The AI learns team preferences when you **Accept** findings. After every **3 accepted findings** per repository (e.g. 3, 6, 9…), the system calls `/extract-patterns` to identify style, architecture, naming, and testing patterns. These patterns are then included in future PR reviews for that repo.

To trigger pattern extraction: generate demo data → Accept 3 findings → patterns appear in the "Team Patterns" section after the next refresh.

## Accessibility

- **Keyboard navigation:** Focus order follows visual flow (header → main → reviews → findings). All interactive elements (buttons, links) are focusable; `:focus-visible` shows a blue outline.
- **Touch targets:** Buttons meet 44×44px minimum on touch devices (`pointer: coarse`).
- **Reduced motion:** `prefers-reduced-motion: reduce` disables animations.

## Summary for Judges

| What to test | How |
|--------------|-----|
| Dashboard UI | Open dashboard → "Generate demo data" if empty → View findings, Accept/Reject |
| Gradient AI integration | Inference service uses `GRADIENT_MODEL_ACCESS_KEY` and Gradient SDK; all AI calls go to Gradient Serverless Inference |
| Demo without webhooks | `POST /api/demo/seed` or use the "Generate demo data" button in the dashboard |
| Open source / Program for the People | MIT license, self-hostable, free — built for OSS projects and small teams |
