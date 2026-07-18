/**
 * The Epistemic Commons — schema (the concrete protocol Sourbut's essay leaves abstract).
 *
 * Design invariants:
 *  - APPEND-ONLY. Rows are never mutated or deleted. A correction is a NEW row whose
 *    contribution `supersedes` a prior one. (Enforced at the DB level in a later migration
 *    by revoking UPDATE/DELETE — the append-only guarantee is itself a "receipt".)
 *  - CONTENT-ADDRESSED. Claims/sources are keyed by a hash of their normalized content, so
 *    the same claim from ten sources resolves to ONE node — this is what makes coverage
 *    countable and compounding real.
 *  - RECEIPTS. Every node/edge is created by a `contribution` (who/when/what-method/hash/sig).
 *  - LATE-BINDING TRUST. We never store "the answer". Credence lives in `assessments`
 *    (attributed to a contributor + method) and is resolved at query time through a `lens`.
 *
 * Layer map:  ingestion → sources, claims, mentions   |   structure → relations, hypotheses,
 * cruxes   |   assessment → assessments, lenses (resolved late, at read time).
 */
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

// Embedding dimension for local gte-small (Transformers.js). Changing model ⇒ re-embed migration.
export const EMBEDDING_DIM = 384

// ── enums ────────────────────────────────────────────────────────────────────
export const contributorKind = pgEnum('contributor_kind', ['human', 'agent'])
export const assertionForm = pgEnum('assertion_form', [
  'observational',
  'causal',
  'evaluative',
  'predictive',
  'definitional',
])
export const modality = pgEnum('modality', ['states', 'suggests', 'speculates', 'refutes'])
export const relationType = pgEnum('relation_type', [
  'supports',
  'contradicts',
  'depends_on',
  'duplicates',
  'refines',
])
export const assessmentKind = pgEnum('assessment_kind', ['endorse', 'challenge', 'credence'])
export const challengeType = pgEnum('challenge_type', [
  'counter_evidence',
  'rival_interpretation',
  'methodological_objection',
])
export const cruxStatus = pgEnum('crux_status', [
  'open',
  'searching',
  'searched_unfound',
  'answered',
])
export const hypothesisStatus = pgEnum('hypothesis_status', ['active', 'merged', 'dropped'])

// ── identity ─────────────────────────────────────────────────────────────────
export const contributors = pgTable('contributors', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: contributorKind('kind').notNull(),
  displayName: text('display_name').notNull(),
  publicKey: text('public_key'), // for signature verification (staked-reputation / crypto guarantee)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── the append-only receipt ledger ───────────────────────────────────────────
// One row per write action. Every node/edge below points back to the contribution
// that created it. `supersedes` chains corrections without mutating history.
export const contributions = pgTable(
  'contributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id),
    method: text('method').notNull(), // e.g. "claim-pressure-test@1.2" — the skill + version used
    payloadHash: text('payload_hash').notNull(), // content hash of what was asserted
    signature: text('signature'), // optional signature over payloadHash by the contributor key
    supersedes: uuid('supersedes'), // prior contribution this replaces (self-ref, nullable)
    sessionId: text('session_id'), // the eve session (= investigation) that produced this write
    // The eve turn within that session (ctx.session.turn.id) — joined through
    // investigation_turns this attributes agent writes to the human who asked.
    // Nullable: rows written before this column existed cannot be backfilled.
    turnId: text('turn_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contributions_contributor_idx').on(t.contributorId),
    index('contributions_session_idx').on(t.sessionId),
  ],
)

// ── investigations ───────────────────────────────────────────────────────────
// One row per investigation, keyed by the eve session id. Powers the persistent
// sidebar history + resume; the saved session snapshot lets a past chat reopen.
// Scoping the graph to an investigation = contributions whose session_id matches;
// the shared commons still dedups/compounds across investigations underneath.
export const investigations = pgTable(
  'investigations',
  {
    id: text('id').primaryKey(), // the eve session id; fork rows use fork_<uuid> instead
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id),
    title: text('title').notNull(), // the question
    sessionState: jsonb('session_state'), // eve resume cursor (initialSession)
    events: jsonb('events'), // eve event stream (initialEvents) for transcript replay
    // Fork rows decouple the row id from the eve session: the row exists (with a
    // copied transcript prelude) before any eve session does. Set on first send.
    // NULL on legacy rows, where id IS the eve session id.
    eveSessionId: text('eve_session_id'),
    // Lineage: set when this investigation was forked from another. The fork
    // adopts the ancestor chain's graph scope UP TO each hop's fork moment, so
    // it STARTS FROM the parent's claims — compounding, made navigable — while
    // parent and fork evolve in parallel afterwards.
    forkedFrom: text('forked_from').references((): AnyPgColumn => investigations.id),
    // Provenance of the branch point: the parent-side turn that was forked, the
    // moment it completed (the ancestor scope bound), and how many transcript
    // events were copied in (the live-stream cursor offset).
    forkedAtTurn: text('forked_at_turn'),
    forkCutoff: timestamp('fork_cutoff', { withTimezone: true }),
    forkPreludeCount: integer('fork_prelude_count'),
    // Read-time seeding choice: consult prior commons work (default) or start
    // blank. Writes always land in the commons either way (late-binding trust).
    seedFromCommons: boolean('seed_from_commons').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('investigations_contributor_idx').on(t.contributorId)],
)

// Who sent each user turn in a shared investigation. eve sessions have a single
// auth principal, so per-message authorship lives here: one row per (session, turn),
// written by the sender's client after the turn is accepted. Composite PK makes
// concurrent inserts safe via onConflictDoNothing.
export const investigationTurns = pgTable(
  'investigation_turns',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => investigations.id),
    turnId: text('turn_id').notNull(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.turnId] }),
    index('inv_turns_session_idx').on(t.sessionId),
  ],
)

// Threaded comments on chat messages within an investigation (app-side
// discussion, NOT commons receipts — promoting a comment to a commons
// challenge/assessment is a future pathway). Roots carry a text anchor
// (quote + context) into the rendered message; replies carry parent_id.
// One-shot model context: context_queued rides the NEXT turn, then flips to
// context_consumed_turn (the muted "was in context" state).
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id')
      .notNull()
      .references(() => investigations.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => contributors.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id),
    messageId: text('message_id'),
    quote: text('quote'),
    quotePrefix: text('quote_prefix'),
    quoteSuffix: text('quote_suffix'),
    body: text('body').notNull(),
    visibility: text('visibility').notNull().default('public'), // 'public' | 'private'
    contextQueued: boolean('context_queued').notNull().default(false),
    contextConsumedTurn: text('context_consumed_turn'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_session_idx').on(t.sessionId)],
)

// ── investigation roots ──────────────────────────────────────────────────────
export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  operationalized: text('operationalized'), // the pinned-down version (workflow step 0)
  contributionId: uuid('contribution_id')
    .notNull()
    .references(() => contributions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── INGESTION ────────────────────────────────────────────────────────────────
export const sources = pgTable(
  'sources',
  {
    id: text('id').primaryKey(), // content hash of the stored source text (content-addressed)
    // The passage the id hashes. Nullable: rows recorded before this column
    // existed have no text, and quote verification degrades gracefully there.
    text: text('text'),
    stableId: text('stable_id'), // doi:… / isbn:… / url — a durable external identifier
    url: text('url'),
    title: text('title'),
    author: text('author'),
    publisher: text('publisher'),
    publishedDate: text('published_date'), // kept as text; sources vary (year-only, etc.)
    guarantees: jsonb('guarantees'), // { peer_reviewed: bool, preprint: bool, … } — toward assessment
    retrieval: jsonb('retrieval'), // { operator, round, retriever, query } — the retrieval receipt
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
  },
  (t) => [index('sources_stable_id_idx').on(t.stableId)],
)

export const claims = pgTable(
  'claims',
  {
    // canonical_id = hash of the representative normalized text (a stable, content-addressed id).
    // DEDUP is decided at write time by EMBEDDING similarity: a new candidate is embedded and
    // compared to existing claims; if cosine to the nearest clears the threshold it resolves to
    // that canonical_id (attach a mention), otherwise it becomes a new claim. This is how
    // "ten sources, one claim" survives paraphrase.
    canonicalId: text('canonical_id').primaryKey(),
    text: text('text').notNull(), // the canonical surface form
    normalizedText: text('normalized_text').notNull(), // what the id hash is taken over
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }), // gte-small (384d) for dedup
    assertionForm: assertionForm('assertion_form'),
    modality: modality('modality'), // hedging: states vs suggests vs speculates (rhetorical weight)
    descriptors: jsonb('descriptors'), // { discipline, position, evidence_type, era, geography }
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
  },
  (t) => [
    uniqueIndex('claims_normalized_idx').on(t.normalizedText),
    // HNSW cosine index over embeddings powers the nearest-claim lookup during dedup.
    index('claims_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

// Claim↔Source at a verbatim span: the receipt that the source ACTUALLY says the claim.
export const mentions = pgTable(
  'mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.canonicalId),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    quote: text('quote').notNull(), // verbatim substring supporting the extraction
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
  },
  (t) => [index('mentions_claim_idx').on(t.claimId), index('mentions_source_idx').on(t.sourceId)],
)

// ── STRUCTURE ────────────────────────────────────────────────────────────────
// Typed inter-claim edge. Itself a contribution, so relations are challengeable too.
export const relations = pgTable(
  'relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromClaimId: text('from_claim_id')
      .notNull()
      .references(() => claims.canonicalId),
    toClaimId: text('to_claim_id')
      .notNull()
      .references(() => claims.canonicalId),
    type: relationType('type').notNull(),
    rationale: text('rationale'),
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
  },
  (t) => [index('relations_from_idx').on(t.fromClaimId), index('relations_to_idx').on(t.toClaimId)],
)

// Competing explanations (discourse structure). credence is NOT stored here — see assessments.
export const hypotheses = pgTable('hypotheses', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id').references(() => questions.id), // optional
  sessionId: text('session_id'), // the eve session (= investigation) this belongs to
  statement: text('statement').notNull(),
  answerBearing: text('answer_bearing'), // e.g. "yes" | "no" — which way it answers the question
  status: hypothesisStatus('status').notNull().default('active'),
  contributionId: uuid('contribution_id')
    .notNull()
    .references(() => contributions.id),
})

// Claim ↔ hypothesis: does this claim support or undermine the explanation, and how much
// does it discriminate it from the rivals (diagnosticity)? Lets claims cluster under the
// competing answers in the graph.
export const hypothesisLinks = pgTable(
  'hypothesis_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hypothesisId: uuid('hypothesis_id')
      .notNull()
      .references(() => hypotheses.id),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.canonicalId),
    polarity: text('polarity').notNull(), // 'supports' | 'undermines'
    diagnosticity: doublePrecision('diagnosticity'), // 0..1: how much it discriminates
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
  },
  (t) => [index('hyplinks_hyp_idx').on(t.hypothesisId), index('hyplinks_claim_idx').on(t.claimId)],
)

// "What would change our mind?" — an unanswered crux on a load-bearing claim is itself a finding.
export const cruxes = pgTable('cruxes', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: text('claim_id').references(() => claims.canonicalId),
  hypothesisId: uuid('hypothesis_id').references(() => hypotheses.id),
  question: text('question').notNull(),
  implication: text('implication'), // what a yes/no would do to the picture
  status: cruxStatus('status').notNull().default('open'),
  answeredByClaimId: text('answered_by_claim_id').references(() => claims.canonicalId),
  voiEstimate: doublePrecision('voi_estimate'), // value-of-information: could it change the answer?
  contributionId: uuid('contribution_id')
    .notNull()
    .references(() => contributions.id),
})

// ── ASSESSMENT (late-binding) ────────────────────────────────────────────────
// An attributed judgment. Consumers pick WHOSE assessments to weight (via a lens);
// the commons stores the inputs, never "the" credence.
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessorId: uuid('assessor_id')
      .notNull()
      .references(() => contributors.id),
    kind: assessmentKind('kind').notNull(),
    // exactly one target is set (claim / relation / hypothesis / source)
    claimId: text('claim_id').references(() => claims.canonicalId),
    relationId: uuid('relation_id').references(() => relations.id),
    hypothesisId: uuid('hypothesis_id').references(() => hypotheses.id),
    sourceId: text('source_id').references(() => sources.id),
    credence: doublePrecision('credence'), // 0..1, only for kind = 'credence'
    // Challenges (kind = 'challenge'): the typed dispute, never deleted. A node's
    // contested/answered state is DERIVED from open challenges + responses.
    challengeType: challengeType('challenge_type'), // only for kind = 'challenge'
    evidenceUrl: text('evidence_url'), // optional source backing a dispute/response
    // A response to a challenge is itself an append-only assessment on the same
    // target; responds_to threads it under the challenge it answers.
    respondsTo: uuid('responds_to').references((): AnyPgColumn => assessments.id),
    method: text('method'), // how this assessment was reached (a skill@version)
    stake: doublePrecision('stake'), // optional reputation/economic stake behind it
    rationale: text('rationale'),
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
  },
  (t) => [
    index('assessments_claim_idx').on(t.claimId),
    index('assessments_assessor_idx').on(t.assessorId),
    index('assessments_responds_idx').on(t.respondsTo),
  ],
)

// A lens = a saved perspective for resolving trust at read time: whose assessments to weight,
// what priors, what independence assumptions. This is what turns the same graph into different
// posteriors (and reproduces the COVID debate's 23-orders-of-magnitude spread).
export const lenses = pgTable('lenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  // { rules: LensRule[] } — an ordered list of {match, weight} evaluated at read
  // time by the client-side query layer (packages/web/lib/lenses). Other keys
  // (priors, independence, …) stay open for richer resolvers.
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  // Who saved this perspective (built-in lenses live in code, not here).
  ownerId: uuid('owner_id').references(() => contributors.id),
  contributionId: uuid('contribution_id')
    .notNull()
    .references(() => contributions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── delegated investigations ─────────────────────────────────────────────────
// A room member assigns eve a bounded background sub-investigation. This is the
// app-side operational record (like investigations/comments, mutable status) —
// the commons receipts are the contributions the run writes, attributed to the
// eve agent contributor with session_id = the room. The row ties those receipts
// back to WHO delegated the work and what they asked for.
export const delegations = pgTable(
  'delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id')
      .notNull()
      .references(() => investigations.id),
    delegatorId: uuid('delegator_id')
      .notNull()
      .references(() => contributors.id),
    brief: text('brief').notNull(), // what eve was asked to investigate
    status: text('status').notNull().default('running'), // 'running' | 'completed' | 'cancelled' | 'error'
    phase: text('phase').notNull().default('plan'), // next phase to run: 'research' | 'synthesize' | 'done'
    plan: text('plan'), // eve's stated plan of attack
    state: jsonb('state'), // phase-machine scratch (examine list, web findings)
    steps: jsonb('steps'), // append-only narration log [{kind, narration, at}]
    summary: text('summary'), // completion write-up
    output: jsonb('output'), // ids of everything written {sources, claims, relations, cruxes, hypotheses, links}
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('delegations_session_idx').on(t.sessionId)],
)

// ── topic slices ─────────────────────────────────────────────────────────────
// A named, LIVING slice of the commons published for external consumption
// (public gallery pages, JSON export, per-topic MCP servers). Only the recipe
// is stored — seed query + pinned claims. Membership is computed at READ time
// (seed FTS hits + graph traversal), so a topic grows as the commons grows and
// nothing here snapshots or freezes graph content (append-only friendly).
export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(), // url handle, unique
    name: text('name').notNull(),
    description: text('description'),
    seedQuery: text('seed_query').notNull(), // full-text seed over the commons
    pinnedClaimIds: jsonb('pinned_claim_ids').notNull().default(sql`'[]'::jsonb`),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => contributors.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('topics_slug_idx').on(t.slug)],
)

// ── merge requests ───────────────────────────────────────────────────────────
// A fork proposing itself back into an ancestor's visible scope. Merging is
// SCOPE ADOPTION, not content copying: the fork's contributions already live
// in the commons; acceptance widens the target lineage's read scope. The row
// is app-side operational state (like delegations); the commons receipt is
// the `merge@1` contribution written at accept time.
export const mergeRequests = pgTable(
  'merge_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No FKs on source/target: an ACCEPTED merge must survive the source
    // fork's later deletion (its commons writes survive; merged_hops below
    // keeps them resolvable). deleteFork() tidies open rows explicitly.
    sourceId: text('source_id').notNull(),
    targetId: text('target_id').notNull(),
    proposerId: uuid('proposer_id')
      .notNull()
      .references(() => contributors.id),
    note: text('note'),
    status: text('status').notNull().default('open'), // 'open' | 'accepted' | 'declined' | 'withdrawn'
    reviewerId: uuid('reviewer_id').references(() => contributors.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    // Materialized at accept: [{sessionIds: string[], cutoff: number|null}] —
    // the source hops absent from the target's chain, cutoffs min-composed
    // with the accept moment. Frozen so what the reviewer approved is what
    // the target gets, forever (mirrors fork_cutoff, not recomputed reads).
    mergedHops: jsonb('merged_hops'),
    contributionId: uuid('contribution_id').references(() => contributions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merge_requests_target_idx').on(t.targetId),
    index('merge_requests_source_idx').on(t.sourceId),
  ],
)

// ── releases ─────────────────────────────────────────────────────────────────
// A named, citable checkpoint: investigation + materialized scope hops + an
// as-of moment. Nothing is copied — immutability falls out of time-capping an
// append-only ledger (same hops + same cutoff always resolve to the same
// graph). Public page /releases/<id>; survives room deletion via the
// materialized recipe (title_snapshot + hops).
export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    investigationId: text('investigation_id').notNull(), // no FK — see merge_requests
    titleSnapshot: text('title_snapshot').notNull(), // rooms rename; citations must not drift
    version: integer('version').notNull(), // per-investigation, max+1 at cut
    name: text('name'),
    notes: text('notes'),
    cutoff: timestamp('cutoff', { withTimezone: true }).notNull(),
    hops: jsonb('hops').notNull(), // ScopeHop[] at cut time (accepted merges included)
    createdBy: uuid('created_by')
      .notNull()
      .references(() => contributors.id),
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('releases_inv_version_idx').on(t.investigationId, t.version),
    index('releases_inv_idx').on(t.investigationId),
  ],
)

// ── agent keys ───────────────────────────────────────────────────────────────
// Bearer capability for the write-capable agent MCP endpoint. The token is
// never stored — only its sha256. Minted by a signed-in human for an agent
// contributor; revocation is a timestamp (the key row itself is the record,
// append-only in spirit).
export const agentKeys = pgTable(
  'agent_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => contributors.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_keys_token_idx').on(t.tokenHash)],
)
