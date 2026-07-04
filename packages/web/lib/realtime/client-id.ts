// One id per browser tab/connection. CURSORS (and cursor chat, tour hosting)
// key on this — a pointer exists per window, so one account in two windows is
// two cursors. AVATARS dedupe by userId instead — an avatar is a person.
//
// Persisted in sessionStorage: a refresh reuses the tab's id, so the new
// presence join replaces the old one instead of spawning a ghost participant
// until the server reaps the dead connection.

const STORAGE_KEY = "epistack-client-id";

let clientId: string | null = null;

function mint(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;
}

export function getClientId(): string {
  if (clientId) {
    return clientId;
  }
  if (typeof window !== "undefined") {
    try {
      const existing = window.sessionStorage.getItem(STORAGE_KEY);
      if (existing) {
        clientId = existing;
        return existing;
      }
      const fresh = mint();
      window.sessionStorage.setItem(STORAGE_KEY, fresh);
      clientId = fresh;
      return fresh;
    } catch {
      // Storage blocked (private-mode edge cases) — fall through.
    }
  }
  clientId = mint();
  return clientId;
}
