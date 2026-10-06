DO $$ BEGIN
  CREATE TYPE "academy_course_status" AS ENUM ('draft', 'published', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "academy_course_audience" AS ENUM ('all', 'general', 'pharmacist');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "academy_categories" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "description" text,
  "image_url" text,
  "color" varchar(20) DEFAULT '#737300',
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_visible" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "academy_instructors" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "title" text,
  "expertise" text,
  "image_url" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_visible" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "academy_courses" (
  "id" serial PRIMARY KEY,
  "category_id" integer REFERENCES "academy_categories"("id") ON DELETE SET NULL,
  "instructor_id" integer REFERENCES "academy_instructors"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "summary" text,
  "cover_url" text,
  "duration_label" text,
  "cpe_credits" numeric(5, 2) DEFAULT '0',
  "conference_code" varchar(255),
  "price" numeric(10, 2) DEFAULT '0' NOT NULL,
  "audience" "academy_course_audience" DEFAULT 'all' NOT NULL,
  "status" "academy_course_status" DEFAULT 'draft' NOT NULL,
  "is_featured" boolean DEFAULT false NOT NULL,
  "popular_order" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "academy_course_outcomes" (
  "id" serial PRIMARY KEY,
  "course_id" integer NOT NULL REFERENCES "academy_courses"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "academy_reviews" (
  "id" serial PRIMARY KEY,
  "course_id" integer NOT NULL REFERENCES "academy_courses"("id") ON DELETE CASCADE,
  "rating" integer NOT NULL,
  "body" text NOT NULL,
  "reviewer_name" text NOT NULL,
  "reviewer_role" text,
  "created_at" timestamp DEFAULT now()
);
