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

export interface CodeReview {
  id: string;
  jobId: string;
  provider: GitProvider;
  repo: string;
  prId: string;
  summary: string;
  suggestions: ReviewSuggestion[];
  createdAt: Date;
}

export interface ReviewSuggestion {
  file: string;
  line?: number;
  severity: "info" | "warning" | "error";
  message: string;
  snippet?: string;
}
