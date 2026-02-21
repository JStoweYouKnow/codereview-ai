import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import fs from "fs";
import path from "path";

/**
 * Get an authenticated Octokit instance for a GitHub App installation.
 * Uses the GitHub App's private key to generate installation access tokens.
 *
 * Supports:
 * - GITHUB_PRIVATE_KEY_PATH: path to .pem file
 * - GITHUB_PRIVATE_KEY: inline PEM (e.g. for Docker/App Platform)
 */
export async function getInstallationOctokit(
  installationId: string
): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error("GITHUB_APP_ID must be set");
  }

  let privateKey: string;
  const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  const inlineKey = process.env.GITHUB_PRIVATE_KEY;

  if (inlineKey) {
    privateKey = inlineKey.replace(/\\n/g, "\n");
  } else if (keyPath) {
    const resolvedPath = path.isAbsolute(keyPath)
      ? keyPath
      : path.resolve(process.cwd(), keyPath);
    privateKey = fs.readFileSync(resolvedPath, "utf-8");
  } else {
    throw new Error(
      "GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be set"
    );
  }

  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const { token } = await auth({ type: "installation" });
  return new Octokit({ auth: token });
}
