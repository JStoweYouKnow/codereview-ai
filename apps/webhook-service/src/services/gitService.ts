import type { GitProvider } from "../types";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

interface GitService {
  fetchDiff: (repo: string, prId: string, branch: string, baseBranch: string) => Promise<string>;
}

const githubService: GitService = {
  async fetchDiff(repo, prId, _branch, _baseBranch) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prId}`,
      {
        headers: {
          Accept: "application/vnd.github.v3.diff",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      }
    );
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    return res.text();
  },
};

const gitlabService: GitService = {
  async fetchDiff(repo, prId, _branch, _baseBranch) {
    const encoded = encodeURIComponent(repo);
    const res = await fetch(
      `https://gitlab.com/api/v4/projects/${encoded}/merge_requests/${prId}/changes`,
      {
        headers: {
          "PRIVATE-TOKEN": GITLAB_TOKEN || "",
        },
      }
    );
    if (!res.ok) throw new Error(`GitLab API: ${res.status}`);
    const data = await res.json();
    return data.changes?.map((c: { diff: string }) => c.diff).join("\n") || "";
  },
};

export function getGitService(provider: GitProvider): GitService {
  if (provider === "github") return githubService;
  if (provider === "gitlab") return gitlabService;
  throw new Error(`Unknown provider: ${provider}`);
}
