import settings from "../site.config.json" with { type: "json" };

export type AdminRepoConfig = {
  owner: string;
  repo: string;
  branch: "master";
};

// SPEC 04: the only client-side key. It is a UI hint (not a credential) that
// makes the admin entry points visible; the real session lives in the Worker.
export const ADMIN_STORAGE_KEYS = {
  signedIn: "grimorio.admin",
} as const;

/** Pre-SPEC 04 keys, removed from the browser on the first admin load. */
export const ADMIN_LEGACY_STORAGE_KEYS = [
  "grimorio.github.token",
  "grimorio.github.user",
  "grimorio.github.expires",
  "grimorio.github.writeVerified",
] as const;

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
