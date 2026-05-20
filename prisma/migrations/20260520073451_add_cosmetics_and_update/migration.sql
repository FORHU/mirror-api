/*
  Warnings:

  - You are about to drop the column `userId` on the `ChatMessage` table. All the data in the column will be lost.
  - You are about to drop the `ChatSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Cosmetics` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "COSMETIC_TYPE" AS ENUM ('NONE', 'LIPSTICK', 'LIP_TINT', 'LIP_GLOSS', 'FOUNDATION', 'CONCEALER', 'POWDER', 'BLUSH', 'HIGHLIGHTER', 'CONTOUR', 'EYESHADOW', 'EYELINER', 'MASCARA', 'BROW', 'PRIMER', 'SETTING_SPRAY');

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_userId_fkey";

-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "Cosmetics" DROP CONSTRAINT "Cosmetics_userOutlineId_fkey";

-- DropIndex
DROP INDEX "ChatMessage_userId_conversationId_idx";

-- AlterTable
ALTER TABLE "ChatMessage" DROP COLUMN "userId";

-- DropTable
DROP TABLE "ChatSession";

-- DropTable
DROP TABLE "Cosmetics";

-- CreateTable
CREATE TABLE "CosmeticProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "imageUrl" TEXT,
    "hexColor" TEXT,
    "metaData" JSONB,
    "type" "COSMETIC_TYPE",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CosmeticProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CosmeticRecommendation" (
    "id" TEXT NOT NULL,
    "userOutlineId" TEXT NOT NULL,
    "cosmeticProductId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "rank" INTEGER,
    "reason" TEXT,
    "signals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CosmeticRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherSnapshot_userOutlineId_idx" ON "WeatherSnapshot"("userOutlineId");

-- AddForeignKey
ALTER TABLE "CosmeticRecommendation" ADD CONSTRAINT "CosmeticRecommendation_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CosmeticRecommendation" ADD CONSTRAINT "CosmeticRecommendation_cosmeticProductId_fkey" FOREIGN KEY ("cosmeticProductId") REFERENCES "CosmeticProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
