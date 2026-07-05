CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"delegator_id" uuid NOT NULL,
	"brief" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"phase" text DEFAULT 'plan' NOT NULL,
	"plan" text,
	"state" jsonb,
	"steps" jsonb,
	"summary" text,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_session_id_investigations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegator_id_contributors_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegations_session_idx" ON "delegations" USING btree ("session_id");