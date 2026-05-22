/*
  Warnings:

  - You are about to drop the `EmotionMemory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "EmotionMemory" DROP CONSTRAINT "EmotionMemory_chatMessageId_fkey";

-- DropForeignKey
ALTER TABLE "EmotionMemory" DROP CONSTRAINT "EmotionMemory_userId_fkey";

-- DropTable
DROP TABLE "EmotionMemory";
