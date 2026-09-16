-- Full recipient bio (rich text) on honors
ALTER TABLE "honors" ADD COLUMN IF NOT EXISTS "full_detail" text;
