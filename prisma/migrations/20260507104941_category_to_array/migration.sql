/*
  Warnings:

  - The values [Traditional,Cultural,Uniform] on the enum `Category` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `Kiosk` table. If the table is not empty, all the data it contains will be lost.
  - Changed the column `category` on the `Garment` table from a scalar field to a list field. If there are non-null values in that column, this step will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Category_new" AS ENUM ('Streetwear', 'Casual', 'Formal', 'Business', 'SmartCasual', 'Sportswear', 'Activewear', 'Athleisure', 'Winterwear', 'Summerwear', 'Rainwear', 'Springwear', 'Autumnwear', 'Vintage', 'Minimalist', 'Luxury', 'AvantGarde');
ALTER TABLE "Garment" ALTER COLUMN "category" TYPE "Category_new"[] USING ("category"::text::"Category_new"[]);
ALTER TYPE "Category" RENAME TO "Category_old";
ALTER TYPE "Category_new" RENAME TO "Category";
DROP TYPE "public"."Category_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GarmentTypes" ADD VALUE 'Traditional';
ALTER TYPE "GarmentTypes" ADD VALUE 'Cultural';
ALTER TYPE "GarmentTypes" ADD VALUE 'Uniform';

-- AlterTable
ALTER TABLE "Garment" ALTER COLUMN "category" SET DATA TYPE "Category"[];

-- DropTable
DROP TABLE "Kiosk";
