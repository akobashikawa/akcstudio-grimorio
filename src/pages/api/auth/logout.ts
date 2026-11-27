import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  ADMIN_SESSION_KEY,
  revokeGrant,
  type AdminSessionData,
} from "../../../lib/admin-auth";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.session) {
    return Response.json({ error: "session_unavailable" }, { status: 500 });
  }

  // CSRF: only same-origin calls may destroy the session.
  const origin = context.request.headers.get("origin");
  if (origin && origin !== context.url.origin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const data = await context.session.get<AdminSessionData>(ADMIN_SESSION_KEY);
  if (data?.accessToken) {
    await revokeGrant(env, data.accessToken);
  }
  context.session.destroy();

  return new Response(null, { status: 204 });
};
