/*
  Warnings:

  - You are about to drop the column `deletedAt` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `Garment` table. All the data in the column will be lost.
  - The `fittingSlot` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `garmentType` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `gender` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `layerLevel` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `GarmentInOutfit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `intent` on the `Interaction` table. All the data in the column will be lost.
  - You are about to drop the column `message` on the `Interaction` table. All the data in the column will be lost.
  - You are about to drop the column `response` on the `Interaction` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[fileId]` on the table `Garment` will be added. If there are existing duplicate values, this will fail.
  - Made the column `filename` on table `File` required. This step will fail if there are existing NULL values in that column.
  - Made the column `fileUrl` on table `File` required. This step will fail if there are existing NULL values in that column.
  - Made the column `provider` on table `File` required. This step will fail if there are existing NULL values in that column.
  - Made the column `fileId` on table `Garment` required. This step will fail if there are existing NULL values in that column.
  - The required column `id` was added to the `GarmentInOutfit` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `garmentId` to the `Interaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `Interaction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LAYER_LEVEL" AS ENUM ('INNER', 'BASE', 'MID', 'OUTER', 'OVER');

-- CreateEnum
CREATE TYPE "GARMENT_GENDER" AS ENUM ('MALE', 'FEMALE', 'UNISEX');

-- CreateEnum
CREATE TYPE "USER_GENDER" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "FITING_SLOTS" AS ENUM ('None', 'HeadGarment', 'Glasses', 'Earrings', 'UpperGarment', 'LowerGarment', 'FullGarment', 'FootGarment', 'LeftHandAccessory', 'RightHandAccessory', 'NeckAccessory', 'WaistAccessory');

-- CreateEnum
CREATE TYPE "GARMENT_TYPES" AS ENUM ('None', 'Hat', 'Beanie', 'Cap', 'Headband', 'Shirt', 'TShirt', 'Polo', 'Blouse', 'Hoodie', 'Sweater', 'Jacket', 'Coat', 'Blazer', 'Pants', 'Jeans', 'Shorts', 'Skirt', 'Dress', 'Jumpsuit', 'Romper', 'Suit', 'Shoes', 'Sneakers', 'Sandals', 'Boots', 'Heels', 'Socks', 'Watch', 'Belt', 'Sunglasses', 'Bag', 'Backpack', 'Necklace', 'Bracelet', 'Ring', 'Earrings', 'Scarf', 'Gloves', 'Traditional', 'Cultural', 'Uniform');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CATEGORY" ADD VALUE 'Traditional';
ALTER TYPE "CATEGORY" ADD VALUE 'Cultural';
ALTER TYPE "CATEGORY" ADD VALUE 'Uniform';

-- DropForeignKey
ALTER TABLE "Garment" DROP CONSTRAINT "Garment_fileId_fkey";

-- DropIndex
DROP INDEX "Session_userId_idx";

-- AlterTable
ALTER TABLE "File" DROP COLUMN "deletedAt",
DROP COLUMN "updatedAt",
ALTER COLUMN "filename" SET NOT NULL,
ALTER COLUMN "fileUrl" SET NOT NULL,
ALTER COLUMN "provider" SET NOT NULL,
ALTER COLUMN "provider" SET DEFAULT 'S3';

-- AlterTable
ALTER TABLE "Garment" DROP COLUMN "deletedAt",
ALTER COLUMN "fileId" SET NOT NULL,
DROP COLUMN "fittingSlot",
ADD COLUMN     "fittingSlot" "FITING_SLOTS"[],
DROP COLUMN "garmentType",
ADD COLUMN     "garmentType" "GARMENT_TYPES" NOT NULL DEFAULT 'None',
DROP COLUMN "gender",
ADD COLUMN     "gender" "GARMENT_GENDER" NOT NULL DEFAULT 'UNISEX',
DROP COLUMN "layerLevel",
ADD COLUMN     "layerLevel" "LAYER_LEVEL" NOT NULL DEFAULT 'BASE';

-- AlterTable
ALTER TABLE "GarmentInOutfit" DROP CONSTRAINT "GarmentInOutfit_pkey",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "GarmentInOutfit_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Interaction" DROP COLUMN "intent",
DROP COLUMN "message",
DROP COLUMN "response",
ADD COLUMN     "garmentId" TEXT NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Outfit" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gender" "USER_GENDER" DEFAULT 'MALE';

-- DropEnum
DROP TYPE "FITINGSLOTS";

-- DropEnum
DROP TYPE "GARMENTTYPES";

-- DropEnum
DROP TYPE "GENDER";

-- DropEnum
DROP TYPE "LAYERLEVEL";

-- CreateTable
CREATE TABLE "UserOutline" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userPrompt" TEXT[],
    "location" TEXT,
    "startTime" TIMESTAMP(3),
    "weather" JSONB,
    "calendarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserOutline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cosmetics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "type" TEXT,
    "imageUrl" TEXT,
    "hexColor" TEXT,
    "userOutlineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserOutlineOutfits" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserOutlineOutfits_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserOutline_calendarId_key" ON "UserOutline"("calendarId");

-- CreateIndex
CREATE INDEX "_UserOutlineOutfits_B_index" ON "_UserOutlineOutfits"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Garment_fileId_key" ON "Garment"("fileId");

-- AddForeignKey
ALTER TABLE "UserOutline" ADD CONSTRAINT "UserOutline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutline" ADD CONSTRAINT "UserOutline_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cosmetics" ADD CONSTRAINT "Cosmetics_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garment" ADD CONSTRAINT "Garment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "Garment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserOutlineOutfits" ADD CONSTRAINT "_UserOutlineOutfits_A_fkey" FOREIGN KEY ("A") REFERENCES "Outfit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserOutlineOutfits" ADD CONSTRAINT "_UserOutlineOutfits_B_fkey" FOREIGN KEY ("B") REFERENCES "UserOutline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
