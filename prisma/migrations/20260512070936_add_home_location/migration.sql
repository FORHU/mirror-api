-- AlterTable (idempotent — columns may already exist on staging)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "homeLocationLat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "homeLocationLng" DOUBLE PRECISION;
