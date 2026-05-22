-- AlterTable
ALTER TABLE "File" ADD COLUMN     "outfitCollectionId" TEXT;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_outfitCollectionId_fkey" FOREIGN KEY ("outfitCollectionId") REFERENCES "Outfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
