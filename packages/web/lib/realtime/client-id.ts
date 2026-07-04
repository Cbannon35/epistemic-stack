// One id per browser tab. Cursors, cursor chat, and presence key on THIS —
// not the auth user id — so the same account in two windows sees two live
// cursors (one human demoing multiplayer across two browsers works, and each
// real connection reads as its own participant, like Figma).

let clientId: string | null = null;

export function getClientId(): string {
  if (!clientId) {
    clientId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`;
  }
  return clientId;
}
