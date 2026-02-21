import { PrismaClient } from "@codereview-ai/db";
import axios from "axios";
import { getInstallationOctokit } from "../utils/githubAuth";
import { auditLog } from "../utils/auditLog";
import { getGitService } from "./gitService";

const prisma = new PrismaClient();

export type Platform = "github" | "gitlab";

export interface ReviewJob {
  platform?: Platform;
  installationId: string;
  repoId: string;
  repoName: string;
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prUrl: string;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

export async function queueReview(job: ReviewJob) {
  const installation = await getOrCreateInstallation(job);
  const repository = await getOrCreateRepo(job, installation.id);

  // Create or update review record
  const existing = await prisma.review.findFirst({
    where: { repositoryId: repository.id, prNumber: job.prNumber },
  });

  let review;
  if (existing) {
    review = await prisma.review.update({
      where: { id: existing.id },
      data: {
        prTitle: job.prTitle,
        status: "pending",
        filesChanged: job.filesChanged,
        linesAdded: job.linesAdded,
        linesDeleted: job.linesDeleted,
      },
    });
  } else {
    review = await prisma.review.create({
      data: {
        installationId: installation.id,
        repositoryId: repository.id,
        prNumber: job.prNumber,
        prTitle: job.prTitle,
        prAuthor: job.prAuthor,
        prUrl: job.prUrl,
        status: "pending",
        filesChanged: job.filesChanged,
        linesAdded: job.linesAdded,
        linesDeleted: job.linesDeleted,
      },
    });
  }

  auditLog("review_created", {
    reviewId: review.id,
    repositoryId: repository.id,
    prNumber: job.prNumber,
  }).catch(() => {});

  // Process review asynchronously
  processReview(review.id).catch(console.error);
}

async function getOrCreateInstallation(job: ReviewJob) {
  const platform = job.platform ?? "github";
  let installation = await prisma.installation.findUnique({
    where: { installationId: job.installationId },
  });
  if (!installation) {
    installation = await prisma.installation.create({
      data: {
        platform,
        installationId: job.installationId,
        accountName: job.repoFullName.split("/")[0] ?? "unknown",
        accountType: "organization",
        accessToken: platform === "gitlab" ? (process.env.GITLAB_TOKEN || "") : "",
      },
    });
  }
  return installation;
}

async function getOrCreateRepo(job: ReviewJob, installationId: string) {
  let repository = await prisma.repository.findUnique({
    where: {
      installationId_repoId: { installationId, repoId: job.repoId },
    },
  });
  if (!repository) {
    repository = await prisma.repository.create({
      data: {
        installationId,
        repoId: job.repoId,
        repoName: job.repoName,
        repoFullName: job.repoFullName,
      },
    });
  }
  return repository;
}

async function processReview(reviewId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      repository: true,
      installation: true,
    },
  });

  if (!review) return;

  try {
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "analyzing" },
    });

    // Get PR diff (platform-specific)
    const diff = review.installation.platform === "gitlab"
      ? await fetchGitLabDiff(review)
      : await fetchPRDiff(review);

    // Get team patterns
    const patterns = await prisma.teamPattern.findMany({
      where: { repositoryId: review.repositoryId },
    });

    // Send to Claude for analysis
    const inferenceUrl =
      process.env.INFERENCE_SERVICE_URL || "http://localhost:8000";
    const response = await axios.post(
      `${inferenceUrl}/analyze`,
      {
        diff,
        prTitle: review.prTitle,
        patterns,
        repoName: review.repository.repoFullName,
      },
      { timeout: 60000 }
    );

    const rawFindings = response.data.findings ?? [];

    // Save findings (create one by one to get IDs for comment updates)
    const createdFindings = [];
    for (const f of rawFindings) {
      const finding = await prisma.finding.create({
        data: {
          reviewId,
          severity: f.severity ?? "suggestion",
          category: f.category ?? "quality",
          title: f.title ?? "Issue",
          description: f.description ?? "",
          suggestion: f.suggestion ?? "",
          filePath: f.filePath ?? "",
          lineStart: f.lineStart ?? 0,
          lineEnd: f.lineEnd ?? 0,
          codeSnippet: f.codeSnippet ?? "",
          confidence: f.confidence ?? 0.8,
        },
      });
      createdFindings.push({ ...finding, ...f });
    }

    // Post comments to PR (platform-specific)
    if (review.installation.platform === "gitlab") {
      await postCommentsToGitLab(review, createdFindings);
    } else {
      const headSha = await getPRHeadSha(review);
      await postCommentsToPR(review, createdFindings, headSha);
    }

    auditLog("finding_posted", {
      reviewId,
      findingsCount: createdFindings.length,
    }).catch(() => {});

    await prisma.review.update({
      where: { id: reviewId },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Review failed:", error);
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "failed" },
    });
  }
}

async function fetchGitLabDiff(review: {
  repository: { repoFullName: string };
  prNumber: number;
}): Promise<string> {
  const gitlab = getGitService("gitlab");
  const diff = await gitlab.fetchDiff(
    review.repository.repoFullName,
    review.prNumber.toString(),
    "",
    ""
  );
  if (!diff) return "";
  // Format for analyzer (add file headers if raw diffs lack them)
  return diff.includes("File:") ? diff : `\n${diff}`;
}

async function fetchPRDiff(review: {
  installation: { installationId: string };
  repository: { repoFullName: string };
  prNumber: number;
}): Promise<string> {
  const octokit = await getInstallationOctokit(review.installation.installationId);

  const [owner, repo] = review.repository.repoFullName.split("/");
  if (!owner || !repo) return "";

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: review.prNumber,
  });

  return files
    .filter((f) => f.patch)
    .map(
      (f) => `
File: ${f.filename}
Status: ${f.status}
${f.patch}
`
    )
    .join("\n\n---\n\n");
}

async function getPRHeadSha(review: {
  installation: { installationId: string };
  repository: { repoFullName: string };
  prNumber: number;
}): Promise<string> {
  const octokit = await getInstallationOctokit(review.installation.installationId);
  const [owner, repo] = review.repository.repoFullName.split("/");
  if (!owner || !repo) return "";
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: review.prNumber,
  });
  return pr.head.sha;
}

async function postCommentsToPR(
  review: {
    installation: { installationId: string };
    repository: { repoFullName: string };
    prNumber: number;
  },
  findings: Array<{
    id: string;
    severity: string;
    title: string;
    description: string;
    suggestion: string;
    confidence?: number;
    category?: string;
    filePath?: string;
    lineEnd?: number;
  }>,
  commitId: string
) {
  const octokit = await getInstallationOctokit(review.installation.installationId);
  const [owner, repo] = review.repository.repoFullName.split("/");
  if (!owner || !repo) return;

  // Post summary comment
  const summaryBody = formatSummaryComment(findings);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: review.prNumber,
    body: summaryBody,
  });

  // Post inline comments for critical/warning findings (requires commit_id)
  if (commitId) {
    for (const finding of findings.filter((f) => f.severity !== "suggestion")) {
      try {
        const path = finding.filePath;
        const line = finding.lineEnd ?? 0;
        if (!path || line < 1) continue;
        // Validate file path: no path traversal, no absolute paths, no control chars
        if (
          path.startsWith("/") ||
          path.includes("..") ||
          /[\x00-\x1f]/.test(path)
        ) {
          continue;
        }

        const { data: comment } = await octokit.pulls.createReviewComment({
          owner,
          repo,
          pull_number: review.prNumber,
          commit_id: commitId,
          body: formatInlineComment(finding),
          path,
          line,
          side: "RIGHT",
        });

        await prisma.finding.update({
          where: { id: finding.id },
          data: {
            commentId: comment.id.toString(),
            commentedAt: new Date(),
          },
        });
      } catch (error) {
        console.error("Failed to post inline comment:", error);
      }
    }
  }
}

async function postCommentsToGitLab(
  review: {
    repository: { repoFullName: string };
    prNumber: number;
  },
  findings: Array<{
    id: string;
    severity: string;
    title: string;
    description: string;
    suggestion: string;
    confidence?: number;
    category?: string;
    filePath?: string;
    lineEnd?: number;
  }>
) {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    console.warn("GITLAB_TOKEN not set, skipping MR comment");
    return;
  }
  const encoded = encodeURIComponent(review.repository.repoFullName);
  const url = `https://gitlab.com/api/v4/projects/${encoded}/merge_requests/${review.prNumber}/notes`;
  const summaryBody = formatSummaryComment(findings);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": token,
    },
    body: JSON.stringify({ body: summaryBody }),
  });
  if (!res.ok) {
    console.error("GitLab note failed:", res.status, await res.text());
    return;
  }
  // GitLab doesn't support inline comments as easily; summary is sufficient
  for (const f of findings.filter((x) => x.severity !== "suggestion")) {
    await prisma.finding.update({
      where: { id: f.id },
      data: { commentedAt: new Date() },
    });
  }
}

function formatSummaryComment(findings: any[]): string {
  const critical = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");
  const suggestions = findings.filter((f) => f.severity === "suggestion");

  return `
## 🤖 CodeReview.ai Analysis Complete

**Summary:**
- 🚨 ${critical.length} Critical Issues
- ⚠️ ${warnings.length} Warnings
- 💡 ${suggestions.length} Suggestions

${critical.length > 0 ? `
### Critical Issues
${critical.map((f, i) => `${i + 1}. **${f.title}** (\`${f.filePath ?? "?"}\`)
   ${f.description}
`).join("\n")}
` : ""}

${warnings.length > 0 ? `
### Warnings
${warnings.map((f, i) => `${i + 1}. **${f.title}** (\`${f.filePath ?? "?"}\`)
`).join("\n")}
` : ""}

---
*Powered by [CodeReview AI](https://github.com/codereview-ai/codereview-ai) running on DigitalOcean Gradient™ AI*
`.trim();
}

function formatInlineComment(finding: any): string {
  return `
### ${finding.severity === "critical" ? "🚨" : "⚠️"} ${finding.title}

**Issue:** ${finding.description}

**Suggestion:**
${finding.suggestion}

**Confidence:** ${Math.round((finding.confidence ?? 0.8) * 100)}%

---
<sub>🤖 CodeReview.ai · Category: ${finding.category ?? "quality"}</sub>
`.trim();
}
