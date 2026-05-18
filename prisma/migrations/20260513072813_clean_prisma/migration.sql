/*
  Warnings:

  - You are about to drop the `_OutfitCollection` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_OutfitCollection" DROP CONSTRAINT "_OutfitCollection_A_fkey";

-- DropForeignKey
ALTER TABLE "_OutfitCollection" DROP CONSTRAINT "_OutfitCollection_B_fkey";

-- AlterTable
ALTER TABLE "Outfit" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "_OutfitCollection";
