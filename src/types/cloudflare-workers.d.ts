/**
 * Ambient types for the `cloudflare:workers` module used by `src/pages/api/auth/*`.
 *
 * `pnpm generate-types` (`wrangler types --include-runtime=false`) only knows
 * about bindings declared in `wrangler.jsonc`, not about the secrets that live
 * in `.dev.vars` locally and in `wrangler secret put` in production, so it does
 * not emit this module. Keep this interface in sync with both sources.
 */
declare module "cloudflare:workers" {
  export interface Env {
    GITHUB_APP_CLIENT_ID: string;
    GITHUB_APP_CLIENT_SECRET: string;
  }
  export const env: Env;
}
