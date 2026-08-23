-- Allow longer short_name on services (e-service)
ALTER TABLE "services" ALTER COLUMN "short_name" SET DATA TYPE text;
