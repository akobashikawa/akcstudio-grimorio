import settings from "../site.config.json" with { type: "json" };

export type AdminRepoConfig = {
  owner: string;
  repo: string;
  branch: "master";
};

export const ADMIN_STORAGE_KEYS = {
  token: "grimorio.github.token",
  user: "grimorio.github.user",
  expires: "grimorio.github.expires",
  writeVerified: "grimorio.github.writeVerified",
} as const;

// The site config keeps the repository as a public GitHub URL; the admin only
// needs owner/repo, and content commits always target the default branch.
export function getAdminRepoConfig(): AdminRepoConfig {
  const url = new URL(settings.author.github);
  const [owner, repo] = url.pathname.replace(/^\/|\/$/g, "").split("/");
  if (!owner || !repo) {
    throw new Error(
      "site.config.json author.github must point to a GitHub repository",
    );
  }
  return { owner, repo, branch: "master" };
}
