CREATE TABLE IF NOT EXISTS "academy_lessons" (
  "id" serial PRIMARY KEY,
  "course_id" integer NOT NULL REFERENCES "academy_courses"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "video_url" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "quiz" json
);

CREATE TABLE IF NOT EXISTS "academy_enrollments" (
  "id" serial PRIMARY KEY,
  "pharmacist_license" text NOT NULL,
  "display_name" text,
  "course_id" integer NOT NULL REFERENCES "academy_courses"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'active' NOT NULL,
  "progress_percent" numeric(5, 2) DEFAULT '0',
  "enrolled_at" timestamp DEFAULT now(),
  CONSTRAINT "academy_enrollments_license_course" UNIQUE ("pharmacist_license", "course_id")
);

CREATE TABLE IF NOT EXISTS "academy_lesson_progress" (
  "id" serial PRIMARY KEY,
  "pharmacist_license" text NOT NULL,
  "lesson_id" integer NOT NULL REFERENCES "academy_lessons"("id") ON DELETE CASCADE,
  "is_completed" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "academy_lesson_progress_license_lesson" UNIQUE ("pharmacist_license", "lesson_id")
);
