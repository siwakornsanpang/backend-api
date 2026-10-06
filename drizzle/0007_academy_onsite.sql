ALTER TABLE "academy_courses" ADD COLUMN IF NOT EXISTS "format" text DEFAULT 'online' NOT NULL;
ALTER TABLE "academy_courses" ADD COLUMN IF NOT EXISTS "venue" text;
ALTER TABLE "academy_courses" ADD COLUMN IF NOT EXISTS "training_starts_at" timestamp;
ALTER TABLE "academy_courses" ADD COLUMN IF NOT EXISTS "training_ends_at" timestamp;
