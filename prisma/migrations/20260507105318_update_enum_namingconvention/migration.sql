/*
  Warnings:

  - The `category` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `fittingSlot` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `garmentType` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `gender` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `layerLevel` column on the `Garment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "LAYERLEVEL" AS ENUM ('INNER', 'BASE', 'MID', 'OUTER', 'OVER');

-- CreateEnum
CREATE TYPE "GENDER" AS ENUM ('MALE', 'FEMALE', 'UNISEX');

-- CreateEnum
CREATE TYPE "FITINGSLOTS" AS ENUM ('None', 'HeadGarment', 'Glasses', 'Earrings', 'UpperGarment', 'LowerGarment', 'FullGarment', 'FootGarment', 'LeftHandAccessory', 'RightHandAccessory', 'NeckAccessory', 'WaistAccessory');

-- CreateEnum
CREATE TYPE "GARMENTTYPES" AS ENUM ('None', 'Hat', 'Beanie', 'Cap', 'Headband', 'Shirt', 'TShirt', 'Polo', 'Blouse', 'Hoodie', 'Sweater', 'Jacket', 'Coat', 'Blazer', 'Pants', 'Jeans', 'Shorts', 'Skirt', 'Dress', 'Jumpsuit', 'Romper', 'Suit', 'Shoes', 'Sneakers', 'Sandals', 'Boots', 'Heels', 'Socks', 'Watch', 'Belt', 'Sunglasses', 'Bag', 'Backpack', 'Necklace', 'Bracelet', 'Ring', 'Earrings', 'Scarf', 'Gloves', 'Traditional', 'Cultural', 'Uniform');

-- CreateEnum
CREATE TYPE "CATEGORY" AS ENUM ('Streetwear', 'Casual', 'Formal', 'Business', 'SmartCasual', 'Sportswear', 'Activewear', 'Athleisure', 'Winterwear', 'Summerwear', 'Rainwear', 'Springwear', 'Autumnwear', 'Vintage', 'Minimalist', 'Luxury', 'AvantGarde');

-- AlterTable
ALTER TABLE "Garment" DROP COLUMN "category",
ADD COLUMN     "category" "CATEGORY"[],
DROP COLUMN "fittingSlot",
ADD COLUMN     "fittingSlot" "FITINGSLOTS" NOT NULL DEFAULT 'None',
DROP COLUMN "garmentType",
ADD COLUMN     "garmentType" "GARMENTTYPES" NOT NULL DEFAULT 'None',
DROP COLUMN "gender",
ADD COLUMN     "gender" "GENDER" NOT NULL DEFAULT 'UNISEX',
DROP COLUMN "layerLevel",
ADD COLUMN     "layerLevel" "LAYERLEVEL" NOT NULL DEFAULT 'BASE';

-- DropEnum
DROP TYPE "Category";

-- DropEnum
DROP TYPE "FittingSlots";

-- DropEnum
DROP TYPE "GarmentTypes";

-- DropEnum
DROP TYPE "Gender";

-- DropEnum
DROP TYPE "LayerLevel";
