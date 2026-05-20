/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `CosmeticProduct` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CosmeticProduct" DROP COLUMN "imageUrl",
ADD COLUMN     "details" TEXT,
ADD COLUMN     "fileUrlId" TEXT;

-- AddForeignKey
ALTER TABLE "CosmeticProduct" ADD CONSTRAINT "CosmeticProduct_fileUrlId_fkey" FOREIGN KEY ("fileUrlId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
