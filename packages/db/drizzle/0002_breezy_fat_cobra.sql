CREATE TABLE "hypothesis_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"claim_id" text NOT NULL,
	"polarity" text NOT NULL,
	"diagnosticity" double precision,
	"contribution_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hypotheses" ALTER COLUMN "question_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "hypothesis_links" ADD CONSTRAINT "hypothesis_links_hypothesis_id_hypotheses_id_fk" FOREIGN KEY ("hypothesis_id") REFERENCES "public"."hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypothesis_links" ADD CONSTRAINT "hypothesis_links_claim_id_claims_canonical_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("canonical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypothesis_links" ADD CONSTRAINT "hypothesis_links_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hyplinks_hyp_idx" ON "hypothesis_links" USING btree ("hypothesis_id");--> statement-breakpoint
CREATE INDEX "hyplinks_claim_idx" ON "hypothesis_links" USING btree ("claim_id");