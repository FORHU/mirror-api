/*
  Warnings:

  - You are about to drop the column `isPublic` on the `Outfit` table. All the data in the column will be lost.
  - You are about to drop the `Interaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_UserOutlineOutfits` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[fileId]` on the table `Outfit` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `fileId` to the `Outfit` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "GarmentInOutfit" DROP CONSTRAINT "GarmentInOutfit_outfitId_fkey";

-- DropForeignKey
ALTER TABLE "Interaction" DROP CONSTRAINT "Interaction_garmentId_fkey";

-- DropForeignKey
ALTER TABLE "Interaction" DROP CONSTRAINT "Interaction_outfitId_fkey";

-- DropForeignKey
ALTER TABLE "Outfit" DROP CONSTRAINT "Outfit_userId_fkey";

-- DropForeignKey
ALTER TABLE "_UserOutlineOutfits" DROP CONSTRAINT "_UserOutlineOutfits_A_fkey";

-- DropForeignKey
ALTER TABLE "_UserOutlineOutfits" DROP CONSTRAINT "_UserOutlineOutfits_B_fkey";

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "parentOutfitId" TEXT,
ADD COLUMN     "parentUserOutfitId" TEXT;

-- AlterTable
ALTER TABLE "GarmentInOutfit" ADD COLUMN     "userOutfitId" TEXT,
ALTER COLUMN "outfitId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Outfit" DROP COLUMN "isPublic",
ADD COLUMN     "fileId" TEXT NOT NULL,
ADD COLUMN     "metaData" JSONB,
ALTER COLUMN "userId" DROP NOT NULL;

-- DropTable
DROP TABLE "Interaction";

-- DropTable
DROP TABLE "_UserOutlineOutfits";

-- CreateTable
CREATE TABLE "UserOutfit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "fileId" TEXT NOT NULL,
    "userOutlineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOutfit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserOutfit_fileId_key" ON "UserOutfit"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Outfit_fileId_key" ON "Outfit"("fileId");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_parentOutfitId_fkey" FOREIGN KEY ("parentOutfitId") REFERENCES "Outfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_parentUserOutfitId_fkey" FOREIGN KEY ("parentUserOutfitId") REFERENCES "UserOutfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutfit" ADD CONSTRAINT "UserOutfit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutfit" ADD CONSTRAINT "UserOutfit_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutfit" ADD CONSTRAINT "UserOutfit_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentInOutfit" ADD CONSTRAINT "GarmentInOutfit_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "Outfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentInOutfit" ADD CONSTRAINT "GarmentInOutfit_userOutfitId_fkey" FOREIGN KEY ("userOutfitId") REFERENCES "UserOutfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
