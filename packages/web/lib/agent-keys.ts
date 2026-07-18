import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDb, schema } from "@epistack/db";
import { and, desc, eq, isNull } from "drizzle-orm";

// Bearer capability for the write-capable agent MCP endpoint. A signed-in
// human mints a key for an agent contributor; the token is shown once and
// only its sha256 is stored. This mirrors the eve channel's model — the
// token IS the capability; revocation is a timestamp.

const db = createDb();

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export type MintedAgentKey = {
  /** Shown exactly once — never stored. */
  token: string;
  contributorId: string;
  name: string;
};

export async function mintAgentKey(input: {
  name: string;
  createdBy: string;
}): Promise<MintedAgentKey | { error: string }> {
  const name = input.name.trim().slice(0, 80);
  if (!name) {
    return { error: "give the agent a name" };
  }
  const contributorId = randomUUID();
  const token = `esk_${randomBytes(24).toString("hex")}`;
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.contributors)
      .values({ id: contributorId, kind: "agent", displayName: name });
    await tx.insert(schema.agentKeys).values({
      tokenHash: hashToken(token),
      contributorId,
      createdBy: input.createdBy,
    });
  });
  return { token, contributorId, name };
}

export type AgentKeyListItem = {
  id: string;
  contributorId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function listAgentKeys(createdBy: string): Promise<AgentKeyListItem[]> {
  return db
    .select({
      id: schema.agentKeys.id,
      contributorId: schema.agentKeys.contributorId,
      name: schema.contributors.displayName,
      createdAt: schema.agentKeys.createdAt,
      lastUsedAt: schema.agentKeys.lastUsedAt,
      revokedAt: schema.agentKeys.revokedAt,
    })
    .from(schema.agentKeys)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.agentKeys.contributorId)
    )
    .where(eq(schema.agentKeys.createdBy, createdBy))
    .orderBy(desc(schema.agentKeys.createdAt))
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        contributorId: r.contributorId,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      }))
    );
}

export async function revokeAgentKey(input: {
  id: string;
  createdBy: string;
}): Promise<boolean> {
  const rows = await db
    .update(schema.agentKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.agentKeys.id, input.id),
        eq(schema.agentKeys.createdBy, input.createdBy),
        isNull(schema.agentKeys.revokedAt)
      )
    )
    .returning({ id: schema.agentKeys.id });
  return rows.length > 0;
}

export type AgentPrincipal = {
  contributorId: string;
  name: string;
  /** The human whose key this is — every agent acts ON BEHALF OF its minter,
   * and the room UI says so. */
  onBehalfOfId: string | null;
  onBehalfOfName: string | null;
};

/** Bearer token → agent identity + its minter (null when unknown/revoked).
 * Bumps last_used_at opportunistically — liveness metadata, not a receipt. */
export async function resolveAgentToken(
  token: string
): Promise<AgentPrincipal | null> {
  if (!token.startsWith("esk_")) {
    return null;
  }
  const [row] = await db
    .select({
      id: schema.agentKeys.id,
      contributorId: schema.agentKeys.contributorId,
      name: schema.contributors.displayName,
      createdBy: schema.agentKeys.createdBy,
    })
    .from(schema.agentKeys)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.agentKeys.contributorId)
    )
    .where(
      and(
        eq(schema.agentKeys.tokenHash, hashToken(token)),
        isNull(schema.agentKeys.revokedAt)
      )
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const [creator] = await db
    .select({ displayName: schema.contributors.displayName })
    .from(schema.contributors)
    .where(eq(schema.contributors.id, row.createdBy))
    .limit(1);
  db.update(schema.agentKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.agentKeys.id, row.id))
    .then(
      () => undefined,
      () => undefined
    );
  return {
    contributorId: row.contributorId,
    name: row.name,
    onBehalfOfId: row.createdBy,
    onBehalfOfName: creator?.displayName ?? null,
  };
}
