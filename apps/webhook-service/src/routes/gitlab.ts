import { Request, Router } from "express";
import { queueReview } from "../services/reviewQueue";

export const gitlabRouter = Router();

function verifyGitLabWebhook(req: Request, token?: string): boolean {
  if (!token) return true; // Optional: skip verification if not configured
  const received = req.headers["x-gitlab-token"];
  const val = Array.isArray(received) ? received[0] : received;
  return val === token;
}

gitlabRouter.post("/", async (req, res) => {
  const token = process.env.GITLAB_WEBHOOK_SECRET || process.env.GITLAB_TOKEN;
  if (token && !verifyGitLabWebhook(req, token)) {
    return res.status(401).json({ error: "Invalid webhook token" });
  }

  try {
    const payload = req.body as {
      object_kind?: string;
      object_attributes?: {
        iid: number;
        title: string;
        state?: string;
        action?: string;
        url?: string;
        source_branch?: string;
        target_branch?: string;
      };
      project?: {
        id: number;
        path_with_namespace: string;
        path: string;
      };
      user?: { username: string };
    };

    const kind = payload.object_kind;
    const attrs = payload.object_attributes;
    const project = payload.project;

    if (kind !== "merge_request" || !attrs || !project) {
      return res.status(200).json({ received: true });
    }

    // Only review on open, reopen, or update
    const action = attrs.action;
    if (action && !["open", "reopen", "update"].includes(action)) {
      return res.status(200).json({ received: true });
    }

    if (attrs.state === "merged" || attrs.state === "closed") {
      return res.status(200).json({ received: true });
    }

    const repoFullName = project.path_with_namespace;
    const [owner] = repoFullName.split("/");

    await queueReview({
      platform: "gitlab",
      installationId: project.id.toString(),
      repoId: project.id.toString(),
      repoName: project.path,
      repoFullName,
      prNumber: attrs.iid,
      prTitle: attrs.title,
      prAuthor: payload.user?.username ?? "unknown",
      prUrl: attrs.url ?? `https://gitlab.com/${repoFullName}/-/merge_requests/${attrs.iid}`,
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
    });

    res.status(200).json({ received: true, queued: true });
  } catch (err) {
    console.error("GitLab webhook error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});
