/*
  Warnings:

  - The `fittingSlot` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the column `garmentType` on the `Garment` table from a scalar field to a list field. If there are non-null values in that column, this step will fail.

*/
-- CreateEnum
CREATE TYPE "FITTING_SLOT" AS ENUM ('None', 'HeadGarment', 'Glasses', 'Earrings', 'UpperGarment', 'LowerGarment', 'FullGarment', 'FootGarment', 'LeftHandAccessory', 'RightHandAccessory', 'NeckAccessory', 'WaistAccessory');

-- AlterTable
ALTER TABLE "Garment" DROP COLUMN "fittingSlot",
ADD COLUMN     "fittingSlot" "FITTING_SLOT"[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "userMeasurement" JSONB;

-- DropEnum
DROP TYPE "FITING_SLOTS";
