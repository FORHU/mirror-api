-- Extend cosmetic product catalog with recommendation matching data.
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'SUNSCREEN';
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'MOISTURIZER';
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'EXFOLIANT';
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'SERUM';
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'CLEANSER';
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'TONER';
ALTER TYPE "COSMETIC_TYPE" ADD VALUE IF NOT EXISTS 'ESSENCE';

CREATE TYPE "COSMETIC_CATEGORY" AS ENUM ('FACE', 'EYES', 'LIPS', 'SKINCARE');
CREATE TYPE "COSMETIC_FINISH" AS ENUM ('MATTE', 'DEWY', 'NATURAL');
CREATE TYPE "SKIN_TYPE" AS ENUM ('DRY', 'OILY', 'COMBINATION', 'NORMAL', 'SENSITIVE');

ALTER TABLE "CosmeticProduct"
ADD COLUMN "category" "COSMETIC_CATEGORY",
ADD COLUMN "priceAmount" DOUBLE PRECISION,
ADD COLUMN "priceUnit" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "spf" INTEGER,
ADD COLUMN "waterproof" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "transferProof" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hydrating" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "oilFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "finish" "COSMETIC_FINISH";

-- Allow recommendations to belong either to a legacy outline flow or the
-- newer per-user skin-analysis flow.
ALTER TABLE "CosmeticRecommendation" DROP CONSTRAINT IF EXISTS "CosmeticRecommendation_userOutlineId_fkey";
ALTER TABLE "CosmeticRecommendation" ALTER COLUMN "userOutlineId" DROP NOT NULL;
ALTER TABLE "CosmeticRecommendation" ADD COLUMN "skinAnalysisId" TEXT;

CREATE TABLE "SkinAnalysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "weatherSnapshotId" TEXT,
  "skinType" "SKIN_TYPE" NOT NULL,
  "skinTone" TEXT,
  "hydrationPct" INTEGER NOT NULL,
  "oilinessPct" INTEGER NOT NULL,
  "concerns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "routineTip" TEXT NOT NULL,
  "rawSignals" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SkinAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CosmeticRecommendation_userOutlineId_rank_idx" ON "CosmeticRecommendation"("userOutlineId", "rank");
CREATE INDEX "CosmeticRecommendation_skinAnalysisId_rank_idx" ON "CosmeticRecommendation"("skinAnalysisId", "rank");
CREATE INDEX "SkinAnalysis_userId_createdAt_idx" ON "SkinAnalysis"("userId", "createdAt");

ALTER TABLE "CosmeticRecommendation"
ADD CONSTRAINT "CosmeticRecommendation_userOutlineId_fkey"
FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CosmeticRecommendation"
ADD CONSTRAINT "CosmeticRecommendation_skinAnalysisId_fkey"
FOREIGN KEY ("skinAnalysisId") REFERENCES "SkinAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkinAnalysis"
ADD CONSTRAINT "SkinAnalysis_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkinAnalysis"
ADD CONSTRAINT "SkinAnalysis_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SkinAnalysis"
ADD CONSTRAINT "SkinAnalysis_weatherSnapshotId_fkey"
FOREIGN KEY ("weatherSnapshotId") REFERENCES "WeatherSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
