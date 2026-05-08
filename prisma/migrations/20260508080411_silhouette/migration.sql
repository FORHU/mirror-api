-- CreateEnum
CREATE TYPE "SILHOUETTE" AS ENUM ('Slim', 'Regular', 'Relaxed', 'Oversized', 'Boxy', 'Cropped', 'Longline', 'WideLeg', 'Straight', 'Tapered', 'Flowy', 'Structured');

-- AlterTable
ALTER TABLE "Garment" ADD COLUMN     "silhouette" "SILHOUETTE" NOT NULL DEFAULT 'Regular';
