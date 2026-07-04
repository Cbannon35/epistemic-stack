CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."assertion_form" AS ENUM('observational', 'causal', 'evaluative', 'predictive', 'definitional');--> statement-breakpoint
CREATE TYPE "public"."assessment_kind" AS ENUM('endorse', 'challenge', 'credence');--> statement-breakpoint
CREATE TYPE "public"."contributor_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."crux_status" AS ENUM('open', 'searching', 'searched_unfound', 'answered');--> statement-breakpoint
CREATE TYPE "public"."hypothesis_status" AS ENUM('active', 'merged', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."modality" AS ENUM('states', 'suggests', 'speculates', 'refutes');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('supports', 'contradicts', 'depends_on', 'duplicates', 'refines');--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessor_id" uuid NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"claim_id" text,
	"relation_id" uuid,
	"hypothesis_id" uuid,
	"credence" double precision,
	"method" text,
	"stake" double precision,
	"rationale" text,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"canonical_id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"embedding" vector(384),
	"assertion_form" "assertion_form",
	"modality" "modality",
	"descriptors" jsonb,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contributor_id" uuid NOT NULL,
	"method" text NOT NULL,
	"payload_hash" text NOT NULL,
	"signature" text,
	"supersedes" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "contributor_kind" NOT NULL,
	"display_name" text NOT NULL,
	"public_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cruxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" text,
	"hypothesis_id" uuid,
	"question" text NOT NULL,
	"implication" text,
	"status" "crux_status" DEFAULT 'open' NOT NULL,
	"answered_by_claim_id" text,
	"voi_estimate" double precision,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"answer_bearing" text,
	"status" "hypothesis_status" DEFAULT 'active' NOT NULL,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" text NOT NULL,
	"source_id" text NOT NULL,
	"span_start" integer,
	"span_end" integer,
	"quote" text NOT NULL,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"operationalized" text,
	"contribution_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_claim_id" text NOT NULL,
	"to_claim_id" text NOT NULL,
	"type" "relation_type" NOT NULL,
	"rationale" text,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"stable_id" text,
	"url" text,
	"title" text,
	"author" text,
	"publisher" text,
	"published_date" text,
	"guarantees" jsonb,
	"retrieval" jsonb,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_assessor_id_contributors_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_claim_id_claims_canonical_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_relation_id_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."relations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_hypothesis_id_hypotheses_id_fk" FOREIGN KEY ("hypothesis_id") REFERENCES "public"."hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruxes" ADD CONSTRAINT "cruxes_claim_id_claims_canonical_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruxes" ADD CONSTRAINT "cruxes_hypothesis_id_hypotheses_id_fk" FOREIGN KEY ("hypothesis_id") REFERENCES "public"."hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruxes" ADD CONSTRAINT "cruxes_answered_by_claim_id_claims_canonical_id_fk" FOREIGN KEY ("answered_by_claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruxes" ADD CONSTRAINT "cruxes_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lenses" ADD CONSTRAINT "lenses_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_claim_id_claims_canonical_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_from_claim_id_claims_canonical_id_fk" FOREIGN KEY ("from_claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_to_claim_id_claims_canonical_id_fk" FOREIGN KEY ("to_claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_claim_idx" ON "assessments" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "assessments_assessor_idx" ON "assessments" USING btree ("assessor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_normalized_idx" ON "claims" USING btree ("normalized_text");--> statement-breakpoint
CREATE INDEX "claims_embedding_idx" ON "claims" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "contributions_contributor_idx" ON "contributions" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "mentions_claim_idx" ON "mentions" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "mentions_source_idx" ON "mentions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "relations_from_idx" ON "relations" USING btree ("from_claim_id");--> statement-breakpoint
CREATE INDEX "relations_to_idx" ON "relations" USING btree ("to_claim_id");--> statement-breakpoint
CREATE INDEX "sources_stable_id_idx" ON "sources" USING btree ("stable_id");