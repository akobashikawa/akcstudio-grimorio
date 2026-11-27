import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readAdminSession } from "../../../lib/admin-auth";

export const prerender = false;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export const GET: APIRoute = async (context) => {
  if (!context.session) {
    return Response.json({ error: "session_unavailable" }, {
      status: 500,
      headers: NO_STORE,
    });
  }

  try {
    const payload = await readAdminSession(env, context.session);
    if (!payload) {
      return Response.json({ error: "unauthenticated" }, {
        status: 401,
        headers: NO_STORE,
      });
    }
    return Response.json(payload, { headers: NO_STORE });
  } catch (reason) {
    return Response.json(
      {
        error: "session_refresh_failed",
        message: reason instanceof Error ? reason.message : String(reason),
      },
      { status: 500, headers: NO_STORE },
    );
  }
};
