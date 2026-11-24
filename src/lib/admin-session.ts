import { ADMIN_STORAGE_KEYS } from "./admin-config";
import type { AdminSession } from "./github-content";

function storage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function loadStoredSession(): AdminSession | null {
  const store = storage();
  if (!store) return null;
  const token = store.getItem(ADMIN_STORAGE_KEYS.token);
  if (!token) return null;
  return {
    token,
    user: store.getItem(ADMIN_STORAGE_KEYS.user) ?? "",
    expires: store.getItem(ADMIN_STORAGE_KEYS.expires) ?? undefined,
  };
}

export function storeSession(session: AdminSession): void {
  const store = storage();
  if (!store) throw new Error("This browser does not support localStorage.");
  if (store.getItem(ADMIN_STORAGE_KEYS.token) !== session.token) {
    store.removeItem(ADMIN_STORAGE_KEYS.writeVerified);
  }
  store.setItem(ADMIN_STORAGE_KEYS.token, session.token);
  store.setItem(ADMIN_STORAGE_KEYS.user, session.user);
  if (session.expires) {
    store.setItem(ADMIN_STORAGE_KEYS.expires, session.expires);
  } else {
    store.removeItem(ADMIN_STORAGE_KEYS.expires);
  }
}

export function hasWriteVerified(): boolean {
  return storage()?.getItem(ADMIN_STORAGE_KEYS.writeVerified) === "1";
}

export function markWriteVerified(): void {
  storage()?.setItem(ADMIN_STORAGE_KEYS.writeVerified, "1");
}

export function clearStoredSession(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(ADMIN_STORAGE_KEYS.token);
  store.removeItem(ADMIN_STORAGE_KEYS.user);
  store.removeItem(ADMIN_STORAGE_KEYS.expires);
  store.removeItem(ADMIN_STORAGE_KEYS.writeVerified);
}
