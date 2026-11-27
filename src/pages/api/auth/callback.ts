import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  ADMIN_SESSION_KEY,
  exchangeCode,
  type AdminSessionData,
} from "../../../lib/admin-auth";
import { getAdminRepoConfig } from "../../../lib/admin-config";
import { validateToken, verifyWriteAccess } from "../../../lib/github-content";

export const prerender = false;

// Must match the trailing-slash callback URL registered on the GitHub App.
const CALLBACK_PATH = "/api/auth/callback/";

export const GET: APIRoute = async (context) => {
  if (!context.session) {
    return Response.json({ error: "session_unavailable" }, { status: 500 });
  }

  const params = context.url.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const pending = await context.session.get<AdminSessionData>(ADMIN_SESSION_KEY);

  if (!code || !state || !pending || pending.oauthState !== state) {
    return Response.json({ error: "invalid_state" }, { status: 403 });
  }

  try {
    const tokens = await exchangeCode(
      env,
      code,
      `${context.url.origin}${CALLBACK_PATH}`,
    );
    const config = getAdminRepoConfig();
    const validation = await validateToken(config, tokens.accessToken);
    const write = await verifyWriteAccess(config, tokens.accessToken);

    const sessionData: AdminSessionData = {
      login: validation.user,
      canWrite: validation.canWrite && write.canWrite,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
    context.session.set(ADMIN_SESSION_KEY, sessionData);

    return Response.redirect(
      `${context.url.origin}${pending.oauthNext ?? "/admin/"}`,
      302,
    );
  } catch (reason) {
    return Response.json(
      {
        error: "callback_failed",
        message: reason instanceof Error ? reason.message : String(reason),
      },
      { status: 500 },
    );
  }
};
