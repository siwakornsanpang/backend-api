ALTER TABLE "academy_courses" ADD COLUMN IF NOT EXISTS "exam" json;
ALTER TABLE "academy_enrollments" ADD COLUMN IF NOT EXISTS "exam_passed" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "academy_lesson_documents" (
  "id" serial PRIMARY KEY,
  "lesson_id" integer NOT NULL REFERENCES "academy_lessons"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "file_url" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);
