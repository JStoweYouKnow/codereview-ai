import { Router } from "express";
import { queueReview } from "../services/reviewQueue";

export const githubRouter = Router();

githubRouter.post("/", async (req, res) => {
  try {
    const event = req.headers["x-github-event"] as string;
    const payload = req.body;

    if (event === "pull_request") {
      const { action, pull_request, repository, installation } = payload;
      if ((action === "opened" || action === "synchronize") && installation) {
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
        res.status(202).json({ queued: true });
        return;
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("GitHub webhook error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});
