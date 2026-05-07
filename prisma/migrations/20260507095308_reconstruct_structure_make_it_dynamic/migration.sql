/*
  Warnings:

  - You are about to drop the column `bodyPart` on the `Garment` table. All the data in the column will be lost.
  - You are about to drop the column `colorHex` on the `Garment` table. All the data in the column will be lost.
  - You are about to drop the column `colorName` on the `Garment` table. All the data in the column will be lost.
  - You are about to drop the column `scaleFactor` on the `Garment` table. All the data in the column will be lost.
  - You are about to drop the column `zIndex` on the `Garment` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "LayerLevel" AS ENUM ('INNER', 'BASE', 'MID', 'OUTER', 'OVER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNISEX');

-- CreateEnum
CREATE TYPE "FittingSlots" AS ENUM ('None', 'HeadGarment', 'Glasses', 'Earrings', 'UpperGarment', 'LowerGarment', 'FullGarment', 'FootGarment', 'LeftHandAccessory', 'RightHandAccessory', 'NeckAccessory', 'WaistAccessory');

-- CreateEnum
CREATE TYPE "GarmentTypes" AS ENUM ('None', 'Hat', 'Beanie', 'Cap', 'Headband', 'Shirt', 'TShirt', 'Polo', 'Blouse', 'Hoodie', 'Sweater', 'Jacket', 'Coat', 'Blazer', 'Pants', 'Jeans', 'Shorts', 'Skirt', 'Dress', 'Jumpsuit', 'Romper', 'Suit', 'Shoes', 'Sneakers', 'Sandals', 'Boots', 'Heels', 'Socks', 'Watch', 'Belt', 'Sunglasses', 'Bag', 'Backpack', 'Necklace', 'Bracelet', 'Ring', 'Earrings', 'Scarf', 'Gloves');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Category" ADD VALUE 'Springwear';
ALTER TYPE "Category" ADD VALUE 'Autumnwear';

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "bucket" TEXT,
ADD COLUMN     "extension" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "path" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "size" INTEGER,
ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "Garment" DROP COLUMN "bodyPart",
DROP COLUMN "colorHex",
DROP COLUMN "colorName",
DROP COLUMN "scaleFactor",
DROP COLUMN "zIndex",
ADD COLUMN     "fileId" TEXT,
ADD COLUMN     "fittingSlot" "FittingSlots" NOT NULL DEFAULT 'None',
ADD COLUMN     "garmentType" "GarmentTypes" NOT NULL DEFAULT 'None',
ADD COLUMN     "gender" "Gender" NOT NULL DEFAULT 'UNISEX',
ADD COLUMN     "layerLevel" "LayerLevel" NOT NULL DEFAULT 'BASE',
ADD COLUMN     "metaData" JSONB;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerAvatarUrl" TEXT,
ADD COLUMN     "providerUserId" TEXT;

-- DropEnum
DROP TYPE "BodyPart";

-- CreateTable
CREATE TABLE "Kiosk" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Garment" ADD CONSTRAINT "Garment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
