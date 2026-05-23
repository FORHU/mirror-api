/*
  Warnings:

  - You are about to drop the column `userId` on the `SkinAnalysis` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SkinAnalysis" DROP CONSTRAINT "SkinAnalysis_userId_fkey";

-- DropIndex
DROP INDEX "SkinAnalysis_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "SkinAnalysis" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "UserOutline" ADD COLUMN     "skinAnalysisId" TEXT;

-- AddForeignKey
ALTER TABLE "UserOutline" ADD CONSTRAINT "UserOutline_skinAnalysisId_fkey" FOREIGN KEY ("skinAnalysisId") REFERENCES "SkinAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
