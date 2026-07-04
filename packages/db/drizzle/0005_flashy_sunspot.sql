CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"message_id" text,
	"quote" text,
	"quote_prefix" text,
	"quote_suffix" text,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"context_queued" boolean DEFAULT false NOT NULL,
	"context_consumed_turn" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_session_id_investigations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_contributors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_session_idx" ON "comments" USING btree ("session_id");