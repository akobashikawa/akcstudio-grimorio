import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  ADMIN_SESSION_KEY,
  authorizeUrl,
  isAdminNextPath,
  type AdminSessionData,
} from "../../../lib/admin-auth";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  if (!context.session) {
    return Response.json({ error: "session_unavailable" }, { status: 500 });
  }

  const state = crypto.randomUUID();
  const previous =
    await context.session.get<AdminSessionData>(ADMIN_SESSION_KEY);
  context.session.set(ADMIN_SESSION_KEY, {
    ...previous,
    oauthState: state,
    oauthNext: isAdminNextPath(context.url.searchParams.get("next")),
  });

  return Response.redirect(authorizeUrl(env, context.url.origin, state), 302);
};
