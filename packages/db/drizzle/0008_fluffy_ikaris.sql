CREATE TYPE "public"."challenge_type" AS ENUM('counter_evidence', 'rival_interpretation', 'methodological_objection');--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "challenge_type" "challenge_type";--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "evidence_url" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "responds_to" uuid;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "turn_id" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_responds_to_assessments_id_fk" FOREIGN KEY ("responds_to") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_responds_idx" ON "assessments" USING btree ("responds_to");