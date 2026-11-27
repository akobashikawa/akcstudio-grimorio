/**
 * Server-only helpers for the `/api/auth/*` endpoints.
 *
 * The GitHub App client secret never leaves the Worker: the browser only ever
 * receives short-lived access tokens issued to the logged-in user. The session
 * itself lives in Astro's KV-backed session (`SESSION` binding), so the
 * browser holds just an httpOnly cookie with a session id.
 */
import type { AstroSession } from "astro";

const GITHUB_HOST = "https://github.com";
const TOKEN_URL = `${GITHUB_HOST}/login/oauth/access_token`;
const API_BASE = "https://api.github.com";

/** Key under which the admin session data is stored in `Astro.session`. */
export const ADMIN_SESSION_KEY = "admin";

/** Refresh the access token when it is about to expire within a minute. */
const REFRESH_MARGIN_MS = 60_000;

export type AdminAuthEnv = {
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
};

export type AdminSessionData = {
  login: string;
  canWrite: boolean;
  accessToken: string;
  /** Epoch ms; refreshed by `refreshAccessToken()`. */
  accessExpiresAt: number;
  refreshToken: string;
  /** Epoch ms; the GitHub refresh token lives up to six months. */
  refreshExpiresAt: number;
  /** Anti-CSRF nonce, set by /api/auth/login and cleared on /callback. */
  oauthState?: string;
};

export type AdminSessionPayload = {
  token: string;
  login: string;
  expiresAt: number;
  canWrite: boolean;
};

export type GitHubTokens = {
  accessToken: string;
  accessExpiresAt: number;
  /** GitHub rotates the refresh token on use; absent means keep the old one. */
  refreshToken?: string;
  refreshExpiresAt?: number;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

export function authorizeUrl(env: AdminAuthEnv, origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/callback`,
    state,
  });
  return `${GITHUB_HOST}/login/oauth/authorize?${params.toString()}`;
}

/**
 * Whitelist of return paths: only the admin SPA. Everything else — and an
 * absolute URL, which would be an open redirect — falls back to `/admin/`.
 */
export function isAdminNextPath(next: string | null): string {
  if (!next || !next.startsWith("/admin/")) return "/admin/";
  return next;
}

async function tokenRequest(
  env: AdminAuthEnv,
  body: Record<string, string>,
): Promise<GitHubTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub token request failed (${response.status}).`);
  }
  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error(
      data.error_description || data.error || "GitHub did not return an access token.",
    );
  }
  return {
    accessToken: data.access_token,
    accessExpiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
    refreshToken: data.refresh_token,
    refreshExpiresAt: data.refresh_token
      ? Date.now() + (data.refresh_token_expires_in ?? 0) * 1000
      : undefined,
  };
}

/** Exchange the OAuth `code` from /api/auth/callback for user tokens. */
export function exchangeCode(
  env: AdminAuthEnv,
  code: string,
  redirectUri: string,
): Promise<GitHubTokens> {
  return tokenRequest(env, { code, redirect_uri: redirectUri });
}

/**
 * Rotate the tokens with the refresh token. Returns `null` when GitHub rejects
 * the grant (expired or revoked): the caller must destroy the session.
 */
export async function refreshAccessToken(
  env: AdminAuthEnv,
  refreshToken: string,
): Promise<GitHubTokens | null> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`GitHub token refresh failed (${response.status}).`);
  }
  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error("GitHub did not return an access token on refresh.");
  }
  return {
    accessToken: data.access_token,
    accessExpiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
    refreshToken: data.refresh_token,
    refreshExpiresAt: data.refresh_token
      ? Date.now() + (data.refresh_token_expires_in ?? 0) * 1000
      : undefined,
  };
}

/**
 * Best-effort revocation of the user access token ("Delete an app token").
 * A failure must not block logout: the local session is already destroyed.
 */
export async function revokeGrant(
  env: AdminAuthEnv,
  accessToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE}/applications/${env.GITHUB_APP_CLIENT_ID}/token`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${btoa(
            `${env.GITHUB_APP_CLIENT_ID}:${env.GITHUB_APP_CLIENT_SECRET}`,
          )}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

/**
 * Read the admin session and refresh the access token when needed. Returns
 * `null` when there is no session or the grant was rejected; throws on
 * network or server failures so the endpoint can answer 5xx.
 */
export async function readAdminSession(
  env: AdminAuthEnv,
  session: AstroSession,
): Promise<AdminSessionPayload | null> {
  const data = await session.get<AdminSessionData>(ADMIN_SESSION_KEY);
  if (
    !data ||
    typeof data.accessToken !== "string" ||
    typeof data.refreshToken !== "string" ||
    typeof data.accessExpiresAt !== "number"
  ) {
    return null;
  }

  let current = data;
  if (data.accessExpiresAt - REFRESH_MARGIN_MS < Date.now()) {
    const tokens = await refreshAccessToken(env, data.refreshToken);
    if (!tokens) {
      session.destroy();
      return null;
    }
    current = {
      ...data,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshToken: tokens.refreshToken ?? data.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt ?? data.refreshExpiresAt,
    };
    session.set(ADMIN_SESSION_KEY, current);
  }

  return {
    token: current.accessToken,
    login: current.login,
    expiresAt: current.accessExpiresAt,
    canWrite: current.canWrite,
  };
}
