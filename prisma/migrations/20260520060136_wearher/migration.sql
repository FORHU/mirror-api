/*
  Warnings:

  - You are about to drop the column `weather` on the `UserOutline` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "WeatherType" AS ENUM ('HOT_HUMID', 'HOT_DRY', 'COLD_WET', 'COLD_DRY', 'RAINY', 'MILD');

-- CreateEnum
CREATE TYPE "WeatherIntensity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "WeatherSource" AS ENUM ('API', 'SENTINEL');

-- AlterTable
ALTER TABLE "Outfit" ALTER COLUMN "isPublic" SET DEFAULT false;

-- AlterTable
ALTER TABLE "UserOutline" DROP COLUMN "weather",
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "WeatherSnapshot" (
    "id" TEXT NOT NULL,
    "userOutlineId" TEXT NOT NULL,
    "temperature" INTEGER NOT NULL,
    "humidity" INTEGER NOT NULL,
    "uvIndex" INTEGER NOT NULL,
    "precipitationProb" INTEGER NOT NULL,
    "windSpeed" INTEGER NOT NULL,
    "conditionType" "WeatherType" NOT NULL,
    "intensity" "WeatherIntensity" NOT NULL,
    "oilRisk" INTEGER NOT NULL,
    "drynessRisk" INTEGER NOT NULL,
    "uvRisk" INTEGER NOT NULL,
    "smudgeRisk" INTEGER NOT NULL,
    "sweatRisk" INTEGER NOT NULL,
    "tags" TEXT[],
    "source" "WeatherSource" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherSnapshot_userOutlineId_key" ON "WeatherSnapshot"("userOutlineId");

-- AddForeignKey
ALTER TABLE "WeatherSnapshot" ADD CONSTRAINT "WeatherSnapshot_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
