/**
 * Express app factory for testing and server bootstrap.
 * Import from index.ts for listening.
 */
import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { queueReview } from "./services/reviewQueue";
import { apiRouter } from "./routes/api";
import { gitlabRouter } from "./routes/gitlab";

const app = express();

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET || "local-dev-placeholder",
});

webhooks.on("pull_request.opened", async ({ payload }) => {
  const { pull_request, repository, installation } = payload;
  if (!installation) return;
  await queueReview({
    installationId: installation.id.toString(),
    repoId: repository.id.toString(),
    repoName: repository.name,
    repoFullName: repository.full_name,
    prNumber: pull_request.number,
    prTitle: pull_request.title,
    prAuthor: pull_request.user?.login ?? "unknown",
    prUrl: pull_request.html_url ?? "",
    filesChanged: pull_request.changed_files ?? 0,
    linesAdded: pull_request.additions ?? 0,
    linesDeleted: pull_request.deletions ?? 0,
  });
});

webhooks.on("pull_request.synchronize", async ({ payload }) => {
  const { pull_request, repository, installation } = payload;
  if (!installation) return;
  await queueReview({
    installationId: installation.id.toString(),
    repoId: repository.id.toString(),
    repoName: repository.name,
    repoFullName: repository.full_name,
    prNumber: pull_request.number,
    prTitle: pull_request.title,
    prAuthor: pull_request.user?.login ?? "unknown",
    prUrl: pull_request.html_url ?? "",
    filesChanged: pull_request.changed_files ?? 0,
    linesAdded: pull_request.additions ?? 0,
    linesDeleted: pull_request.deletions ?? 0,
  });
});

app.post(
  "/webhooks/github",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const payload =
        typeof req.body === "string"
          ? req.body
          : (req.body as Buffer).toString("utf-8");
      await webhooks.verifyAndReceive({
        id: req.headers["x-github-delivery"] as string,
        name: req.headers["x-github-event"] as string,
        signature: req.headers["x-hub-signature-256"] as string,
        payload,
      });
      res.status(200).send("OK");
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send("Error");
    }
  }
);

app.use(express.json());

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", apiRouter);
app.post("/webhooks/gitlab", gitlabRouter);

export { app };
