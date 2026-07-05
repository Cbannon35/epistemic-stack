ALTER TABLE "lenses" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "lenses" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lenses" ADD CONSTRAINT "lenses_owner_id_contributors_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;