"use server";

import {
  type AgentKeyListItem,
  listAgentKeys,
  type MintedAgentKey,
  mintAgentKey,
  revokeAgentKey,
} from "@/lib/agent-keys";
import { ensureContributor } from "@/lib/contributors";
import { getAuthUser } from "@/lib/supabase/server";

export async function mintAgentKeyAction(input: {
  name: string;
}): Promise<MintedAgentKey | { error: string }> {
  const user = await getAuthUser();
  if (!user) {
    return { error: "sign in to connect an agent" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  return await mintAgentKey({ name: input.name, createdBy: user.id });
}

export async function listAgentKeysAction(): Promise<AgentKeyListItem[]> {
  const user = await getAuthUser();
  if (!user) {
    return [];
  }
  return await listAgentKeys(user.id);
}

export async function revokeAgentKeyAction(input: {
  id: string;
}): Promise<{ ok: boolean }> {
  const user = await getAuthUser();
  if (!user) {
    return { ok: false };
  }
  return { ok: await revokeAgentKey({ id: input.id, createdBy: user.id }) };
}
