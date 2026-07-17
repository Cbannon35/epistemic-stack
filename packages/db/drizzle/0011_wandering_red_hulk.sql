CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"contributor_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"proposer_id" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewer_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"merged_hops" jsonb,
	"contribution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investigation_id" text NOT NULL,
	"title_snapshot" text NOT NULL,
	"version" integer NOT NULL,
	"name" text,
	"notes" text,
	"cutoff" timestamp with time zone NOT NULL,
	"hops" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"contribution_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_created_by_contributors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_proposer_id_contributors_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_reviewer_id_contributors_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_created_by_contributors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_token_idx" ON "agent_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "merge_requests_target_idx" ON "merge_requests" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "merge_requests_source_idx" ON "merge_requests" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_inv_version_idx" ON "releases" USING btree ("investigation_id","version");--> statement-breakpoint
CREATE INDEX "releases_inv_idx" ON "releases" USING btree ("investigation_id");