# CodeReview AI

**Unlike static linters or generic AI tools, CodeReview AI learns from your feedback.** When you Accept a finding, it extracts your team's patterns—after 3+ accepts per repo, future reviews adapt. Fewer false positives, no per-seat fees.

AI-powered code review for GitHub and GitLab PRs. Receives webhooks, fetches diffs, runs reviews via **DigitalOcean Gradient™ AI Serverless Inference**, and exposes an analytics dashboard.

**For judges:** CodeReview AI uses [DigitalOcean Gradient™ AI](https://www.digitalocean.com/products/gradient/platform) **Serverless Inference** and the **Gradient Python SDK** (`gradient`) for all AI analysis — structured findings (`/analyze`), markdown reviews (`/review`), and pattern extraction (`/extract-patterns`). No other AI providers are used.

**Open source & free:** MIT licensed. Built for open-source projects and small teams — run it yourself with no vendor lock-in or paid tiers. Pattern learning helps teams maintain consistent code quality without hiring.

**Program for the People:** CodeReview AI is free to use, self-hostable, and designed to serve open-source maintainers and small teams who can’t afford commercial code review tools. No subscription, no usage caps for self-hosted deployments. The AI learns your team’s preferences over time, reducing noise and improving feedback quality.

### What Makes This Different

Unlike static linters or generic AI review tools, **CodeReview AI learns from your feedback**. When you **Accept** a finding, the system uses it to extract your team's coding patterns (style, architecture, naming). After 3+ accepted findings per repo, future reviews adapt to your conventions—fewer false positives, more relevant suggestions. You get AI review quality without the noise, and without paying per-seat SaaS fees.

### Comparison

| | CodeReview AI | Commercial tools (e.g. CodeRabbit, Sourcery) |
|---|---------------|-----------------------------------------------|
| **Cost** | Free, self-hosted | Per-seat subscription ($15–50+/dev/mo) |
| **Pattern learning** | ✅ Learns from Accept/Reject | ❌ Static rules or one-size-fits-all |
| **Self-hosted** | ✅ Your infra, your data | ❌ SaaS only |
| **GitHub + GitLab** | ✅ Both | Varies |
| **Open source** | ✅ MIT | ❌ Proprietary |

### Use Cases

- **Catching SQL injection before merge** — Security-critical findings surface as inline PR comments.
- **Onboarding contributors with consistent style** — Pattern learning teaches new devs your conventions.
- **Small team without dedicated reviewers** — Get senior-level feedback without hiring.

### Impact

CodeReview AI serves **open-source maintainers**, **small teams**, and **indie developers** who lack access to expensive commercial code review tools. Teams report **5+ hours saved per week** on review cycles by automating the first pass and focusing human attention on high-signal feedback.

- **Pattern learning:** After **3+ accepted findings** per repository, the AI extracts coding preferences and applies them to future reviews—fewer false positives, more relevant suggestions (see [TESTING.md](./TESTING.md#pattern-learning)).
- **Maintainers** can improve code quality without hiring dedicated reviewers or paying per-seat SaaS fees
- **Small teams** get consistent, pattern-aware feedback that adapts to their conventions
- **OSS projects** reduce bus factor and onboard contributors faster with automated reviews

Deploy on your own infra with no vendor lock-in.

### Roadmap

- Bitbucket support
- Custom severity rules and per-repo config
- Slack/Discord notifications for new findings
- Language-specific rule sets (Python, TypeScript, etc.)

### Live Demo

Deploy a live demo for judges — see [DEPLOY.md](./DEPLOY.md) for Vercel, Railway, Render, or DigitalOcean App Platform.

## Project Structure

```
codereview-ai/
├── apps/
│   ├── webhook-service/   # PR webhook handler (Node/Express)
│   ├── inference-service/ # Gradient AI Serverless Inference (Python/Flask)
│   └── dashboard/        # React analytics UI
├── packages/
│   ├── db/               # Prisma schema & migrations
│   └── shared/           # Shared TypeScript types
├── docker-compose.yml
└── .do/app.yaml         # DigitalOcean App Platform config
```

## Quick Start

### Prerequisites

- Node.js 18+, pnpm
- Python 3.10+
- Docker (for full stack)
- PostgreSQL (or use DigitalOcean managed DB)

### Local Development

```bash
# Install dependencies
pnpm install

# 1. Run database migrations
cd packages/db && npx prisma migrate deploy

# 2. Run inference service (Gradient AI)
cd apps/inference-service && pip install -r requirements.txt && python src/server.py

# 3. Run webhook service
pnpm dev:webhook

# 4. Run dashboard (with API URL for local webhook service)
VITE_API_URL=http://localhost:3000 pnpm dev:dashboard
```

### Docker Compose

```bash
export DATABASE_URL=postgresql://user:pass@host:5432/db
export GITHUB_APP_ID=123456
export GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
export GITHUB_WEBHOOK_SECRET=whsec_xxx
export GITLAB_TOKEN=glpat_xxx
export GRADIENT_MODEL_ACCESS_KEY=your_model_access_key
export GRADIENT_MODEL=anthropic-claude-3.5-sonnet  # or llama3.3-70b-instruct

docker compose up --build
```

- Webhook service: http://localhost:3000
- Inference service: http://localhost:8000
- Dashboard: http://localhost

### Environment Variables

| Service | Variable | Description |
|---------|----------|-------------|
| webhook-service | DATABASE_URL | PostgreSQL connection string |
| webhook-service | GITHUB_APP_ID | GitHub App ID (from App settings) |
| webhook-service | GITHUB_PRIVATE_KEY | GitHub App private key (PEM, or path via GITHUB_PRIVATE_KEY_PATH) |
| webhook-service | GITHUB_WEBHOOK_SECRET | Webhook secret for signature verification |
| webhook-service | GITLAB_TOKEN | GitLab personal/project token (for GitLab MR reviews) |
| webhook-service | GITLAB_WEBHOOK_SECRET | Optional: GitLab webhook token verification |
| webhook-service | INFERENCE_SERVICE_URL | URL of inference service |
| webhook-service | CORS_ORIGIN | Allowed origin for dashboard API (default: *) |
| inference-service | GRADIENT_MODEL_ACCESS_KEY | DigitalOcean Gradient AI model access key ([create one](https://cloud.digitalocean.com/gen-ai/model-access-keys)) |
| inference-service | GRADIENT_MODEL | Model ID (e.g. `anthropic-claude-3.5-sonnet`, `llama3.3-70b-instruct`). For Anthropic models, add your provider key in DO Control Panel. |
| inference-service | GRADIENT_REQUEST_TIMEOUT | Request timeout in seconds (default: 90). Prevents long-running Gradient calls from hanging. |
| dashboard | VITE_API_URL | Webhook service URL for API calls (build-time) |

### GitHub Setup (GitHub App)

1. Create a [GitHub App](https://github.com/settings/apps/new) with:
   - Webhook URL: `https://your-domain/webhooks/github`
   - Permissions: Pull requests (read & write), Contents (read)
   - Subscribe to: Pull requests
2. Install the app on your org/repos
3. Generate a private key and set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`

### GitLab Setup

1. Project → Settings → Webhooks
2. URL: `https://your-domain/webhooks/gitlab`
3. Trigger: Merge request events
4. (Optional) Set a secret token and add it as `GITLAB_WEBHOOK_SECRET`
5. Create a [Personal/Project Access Token](https://docs.gitlab.com/ee/user/project/settings/project_access_tokens.html) with `api` scope and set as `GITLAB_TOKEN`

### Webhook URLs

- **GitHub:** `https://your-domain/webhooks/github`
- **GitLab:** `https://your-domain/webhooks/gitlab`

### DigitalOcean Gradient™ AI (Serverless Inference + SDK)

CodeReview AI uses [DigitalOcean Gradient™ AI Serverless Inference](https://www.digitalocean.com/products/gradient/platform) and the [Gradient Python SDK](https://gradientai-sdk.digitalocean.com/) for all code analysis. The inference service calls the Gradient API (`https://inference.do-ai.run`) via `gradient`:

- **Chat completions** (`/v1/chat/completions`) for structured code review output
- Supported models: `anthropic-claude-3.5-sonnet`, `llama3.3-70b-instruct`, and [others](https://docs.digitalocean.com/products/gradient-ai-platform/details/models/)
- For Anthropic/OpenAI commercial models, add your provider key in [Model provider keys](https://cloud.digitalocean.com/gen-ai/settings)
- Open-source models (e.g. Llama) work with just the Gradient model access key

### Testing Without Webhooks (Judges / Quick Demo)

Use the **demo flow** to explore the dashboard without setting up webhooks. See [TESTING.md](./TESTING.md) for step-by-step instructions.

- Dashboard shows an empty state with **"Generate demo data"** when there are no reviews.
- Click it (or `POST /api/demo/seed`) to create a sample review with 3 AI findings.
- You can Accept/Reject findings and explore the UI immediately.

### Dashboard API

The webhook service exposes:

- `GET /api/stats` — Aggregate metrics (reviews today, total, avg response time)
- `GET /api/status` — Gradient AI health (configured, model)
- `GET /api/reviews` — Paginated review list (`?page=1&limit=20&status=completed`)
- `GET /api/reviews/:id/findings` — Findings for a review
- `GET /api/patterns` — Team patterns learned from accepted findings
- `PATCH /api/findings/:id` — Accept/Reject finding (body: `{ wasAccepted: boolean }`)
- `POST /api/demo/seed` — Create sample review + findings for testing (no webhooks)
