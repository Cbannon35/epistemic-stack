CREATE TABLE "investigations" (
	"id" text PRIMARY KEY NOT NULL,
	"contributor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"session_state" jsonb,
	"events" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigations_contributor_idx" ON "investigations" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "contributions_session_idx" ON "contributions" USING btree ("session_id");