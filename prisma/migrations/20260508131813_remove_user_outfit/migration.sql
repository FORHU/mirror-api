/*
  Warnings:

  - You are about to drop the column `parentOutfitId` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `parentUserOutfitId` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `userOutfitId` on the `GarmentInOutfit` table. All the data in the column will be lost.
  - You are about to drop the `UserOutfit` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[avatarId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "DESIGN_TYPE" AS ENUM ('systemDesign', 'UserDesign');

-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_parentOutfitId_fkey";

-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_parentUserOutfitId_fkey";

-- DropForeignKey
ALTER TABLE "GarmentInOutfit" DROP CONSTRAINT "GarmentInOutfit_userOutfitId_fkey";

-- DropForeignKey
ALTER TABLE "UserOutfit" DROP CONSTRAINT "UserOutfit_fileId_fkey";

-- DropForeignKey
ALTER TABLE "UserOutfit" DROP CONSTRAINT "UserOutfit_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserOutfit" DROP CONSTRAINT "UserOutfit_userOutlineId_fkey";

-- AlterTable
ALTER TABLE "File" DROP COLUMN "parentOutfitId",
DROP COLUMN "parentUserOutfitId";

-- AlterTable
ALTER TABLE "GarmentInOutfit" DROP COLUMN "userOutfitId";

-- AlterTable
ALTER TABLE "Outfit" ADD COLUMN     "designType" "DESIGN_TYPE" NOT NULL DEFAULT 'systemDesign',
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userOutlineId" TEXT;

-- DropTable
DROP TABLE "UserOutfit";

-- CreateTable
CREATE TABLE "_OutfitCollection" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OutfitCollection_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_OutfitCollection_B_index" ON "_OutfitCollection"("B");

-- CreateIndex
CREATE UNIQUE INDEX "User_avatarId_key" ON "User"("avatarId");

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutfitCollection" ADD CONSTRAINT "_OutfitCollection_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutfitCollection" ADD CONSTRAINT "_OutfitCollection_B_fkey" FOREIGN KEY ("B") REFERENCES "Outfit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
