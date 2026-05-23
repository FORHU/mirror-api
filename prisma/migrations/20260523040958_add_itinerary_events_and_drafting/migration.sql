-- CreateEnum
CREATE TYPE "OUTLINE_STATUS" AS ENUM ('DRAFT', 'FINALIZED');

-- AlterTable
ALTER TABLE "CosmeticRecommendation" ADD COLUMN     "itineraryEventId" TEXT;

-- AlterTable
ALTER TABLE "Outfit" ADD COLUMN     "itineraryEventId" TEXT;

-- AlterTable
ALTER TABLE "UserOutline" ADD COLUMN     "status" "OUTLINE_STATUS" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "ItineraryEvent" (
    "id" TEXT NOT NULL,
    "userOutlineId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timeBlock" TEXT NOT NULL,
    "oilRisk" INTEGER,
    "drynessRisk" INTEGER,
    "uvRisk" INTEGER,
    "smudgeRisk" INTEGER,
    "sweatRisk" INTEGER,
    "weatherTags" TEXT[],
    "fashionSuggestion" TEXT,
    "cosmeticsSuggestion" TEXT,
    "routeSuggestion" TEXT,
    "routeOrigin" TEXT,
    "routeDestination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItineraryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CosmeticRecommendation_itineraryEventId_rank_idx" ON "CosmeticRecommendation"("itineraryEventId", "rank");

-- AddForeignKey
ALTER TABLE "CosmeticRecommendation" ADD CONSTRAINT "CosmeticRecommendation_itineraryEventId_fkey" FOREIGN KEY ("itineraryEventId") REFERENCES "ItineraryEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_itineraryEventId_fkey" FOREIGN KEY ("itineraryEventId") REFERENCES "ItineraryEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryEvent" ADD CONSTRAINT "ItineraryEvent_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
