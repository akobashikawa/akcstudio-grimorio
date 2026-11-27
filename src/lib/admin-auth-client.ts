/**
 * Browser-side helpers for the `/api/auth/*` endpoints.
 *
 * The access token only lives in memory (the caller keeps the value returned
 * by `fetchSession()`); `localStorage` stores the non-secret `grimorio.admin`
 * flag that decides whether the admin entry points (Edit button, 404 button)
 * are shown.
 */
import { ADMIN_LEGACY_STORAGE_KEYS, ADMIN_STORAGE_KEYS } from "./admin-config";
import type { AdminSessionPayload } from "./admin-auth";

/**
 * Returns the current session, or `null` when unauthenticated. Throws on
 * network failures or 5xx responses so callers can tell "not logged in" from
 * "the server is broken".
 */
export async function fetchSession(): Promise<AdminSessionPayload | null> {
  const response = await fetch("/api/auth/session/", {
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      data?.message ?? `Session request failed (${response.status}).`,
    );
  }
  return (await response.json()) as AdminSessionPayload;
}

/** Destroy the server session (and the local flag). */
export async function signOut(): Promise<void> {
  const response = await fetch("/api/auth/logout/", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Logout failed (${response.status}).`);
  }
  forgetSignedIn();
}

/** UI hint (not a credential) that makes Edit and 404 buttons visible. */
export function rememberSignedIn(): void {
  try {
    localStorage.setItem(ADMIN_STORAGE_KEYS.signedIn, "1");
  } catch {
    // Private mode: the session still works, buttons just stay hidden.
  }
}

export function isSignedIn(): boolean {
  try {
    return localStorage.getItem(ADMIN_STORAGE_KEYS.signedIn) === "1";
  } catch {
    return false;
  }
}

export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(ADMIN_STORAGE_KEYS.signedIn);
  } catch {
    // Nothing to forget when storage is unavailable.
  }
}

/** Drop the pre-SPEC 04 keys (`grimorio.github.*`) left behind by old sessions. */
export function clearLegacySession(): void {
  try {
    for (const key of ADMIN_LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing to clean when storage is unavailable.
  }
}
