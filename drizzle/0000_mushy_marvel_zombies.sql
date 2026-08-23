CREATE TYPE "public"."news_category" AS ENUM('news', 'recruitment', 'procurement');--> statement-breakpoint
CREATE TYPE "public"."news_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('qr_payment', 'credit_card', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'pending', 'processing', 'incomplete', 'ready_to_ship', 'shipping', 'success');--> statement-breakpoint
CREATE TYPE "public"."taxpayer_type" AS ENUM('individual', 'corporate');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"description" text,
	"thumbnail_url" text,
	"original_thumbnail_url" text,
	"logo_url" text,
	"icon_url" text,
	"url" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "council_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"start_year" text DEFAULT '' NOT NULL,
	"end_year" text DEFAULT '' NOT NULL,
	"president_name" text NOT NULL,
	"secretary_name" text NOT NULL,
	"president_image" text,
	"original_president_image" text,
	"secretary_image" text,
	"original_secretary_image" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "council_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"prefix" text,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"type" text NOT NULL,
	"image_url" text,
	"original_image_url" text,
	"order" integer NOT NULL,
	"background" text
);
--> statement-breakpoint
CREATE TABLE "home_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"banners" json DEFAULT '[]'::json,
	"popups" json DEFAULT '[]'::json,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "honor_awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "honors" (
	"id" serial PRIMARY KEY NOT NULL,
	"award_id" integer DEFAULT 0 NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"prefix" text,
	"name" text NOT NULL,
	"award_name" text,
	"work_name" text,
	"award_detail" text,
	"image_url" text,
	"original_image_url" text,
	"video_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "laws" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"announced_at" date,
	"order" integer DEFAULT 0,
	"pdf_url" text,
	"status" text DEFAULT 'online',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "medicine_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text,
	"thumbnail_url" text,
	"category" text DEFAULT 'medicine' NOT NULL,
	"status" "news_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "news" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text,
	"thumbnail_url" text,
	"status" "news_status" DEFAULT 'draft' NOT NULL,
	"category" "news_category" NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"published_at" timestamp,
	"is_highlight" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "other_service_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "other_service_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"pdf_url" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"label" text NOT NULL,
	"group" text,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "pharmacist_home_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"banners" json DEFAULT '[]'::json,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"registration_id" text NOT NULL,
	"province" text,
	"status" text DEFAULT 'ใช้งาน',
	"address" text,
	"expiry_date" text,
	"image_url" text,
	CONSTRAINT "pharmacists_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "policy_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "policy_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"summary_pdf_url" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"category" text NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "public_project_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text,
	"thumbnail_url" text,
	"category" text DEFAULT 'public_project' NOT NULL,
	"status" "news_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "request_payment_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" varchar(50) NOT NULL,
	"payment_date" timestamp,
	"amount_paid" numeric(10, 2),
	"payment_method" "payment_method",
	"payment_reference_id" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "request_shipping_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" varchar(50) NOT NULL,
	"shipping_address" text,
	"tracking_number" varchar(100),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "request_tax_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" varchar(50) NOT NULL,
	"taxpayer_type" "taxpayer_type",
	"tax_invoice_name" varchar(255),
	"tax_id_number" varchar(13),
	"branch_code" varchar(50),
	"registered_tax_address" text,
	"tax_invoice_number" varchar(100),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"pharmacist_license_id" text NOT NULL,
	"request_date" timestamp DEFAULT now(),
	"request_status" "request_status" DEFAULT 'draft',
	"license_type" varchar(100),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"icon_url" text,
	"order" integer DEFAULT 0 NOT NULL,
	"description" text,
	"link_url" text,
	"is_popular" boolean DEFAULT false,
	"popular_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "web_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_name_th" varchar(255) DEFAULT 'สภาเภสัชกรรม' NOT NULL,
	"site_name_en" varchar(255) DEFAULT 'The Pharmacy Council of Thailand' NOT NULL,
	"slogan" text,
	"logo_path" varchar(512),
	"address" text,
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"google_maps_url" text,
	"google_maps_embed" text,
	"facebook_url" varchar(512),
	"line_id" varchar(100),
	"youtube_url" varchar(512),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "other_service_items" ADD CONSTRAINT "other_service_items_category_id_other_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."other_service_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_projects" ADD CONSTRAINT "policy_projects_category_id_policy_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."policy_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_payment_logs" ADD CONSTRAINT "request_payment_logs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_shipping_details" ADD CONSTRAINT "request_shipping_details_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_tax_invoices" ADD CONSTRAINT "request_tax_invoices_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;