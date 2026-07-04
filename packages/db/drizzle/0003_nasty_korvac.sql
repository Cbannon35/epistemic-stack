CREATE TABLE "investigation_turns" (
	"session_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"contributor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigation_turns_session_id_turn_id_pk" PRIMARY KEY("session_id","turn_id")
);
--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "forked_from" text;--> statement-breakpoint
ALTER TABLE "investigation_turns" ADD CONSTRAINT "investigation_turns_session_id_investigations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_turns" ADD CONSTRAINT "investigation_turns_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_turns_session_idx" ON "investigation_turns" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_forked_from_investigations_id_fk" FOREIGN KEY ("forked_from") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;