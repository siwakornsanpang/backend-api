CREATE TABLE IF NOT EXISTS "academy_orders" (
  "id" serial PRIMARY KEY,
  "pharmacist_license" text NOT NULL,
  "display_name" text,
  "course_id" integer NOT NULL REFERENCES "academy_courses"("id") ON DELETE CASCADE,
  "amount" numeric(10, 2) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "slip_url" text,
  "created_at" timestamp DEFAULT now(),
  "reviewed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "academy_refund_requests" (
  "id" serial PRIMARY KEY,
  "order_id" integer NOT NULL REFERENCES "academy_orders"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "academy_certificates" (
  "id" serial PRIMARY KEY,
  "enrollment_id" integer NOT NULL UNIQUE REFERENCES "academy_enrollments"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "issued_at" timestamp DEFAULT now()
);
