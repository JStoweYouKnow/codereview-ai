export type GitProvider = "github" | "gitlab";

export interface ReviewJob {
  provider: GitProvider;
  repo: string;
  prId: string;
  branch: string;
  baseBranch: string;
  url: string;
  title: string;
}
