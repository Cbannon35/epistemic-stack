ALTER TABLE "investigations" ADD COLUMN "eve_session_id" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "forked_at_turn" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "fork_cutoff" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "fork_prelude_count" integer;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "seed_from_commons" boolean DEFAULT true NOT NULL;