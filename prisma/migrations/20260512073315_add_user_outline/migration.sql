/*
  Warnings:

  - You are about to drop the column `order` on the `GarmentInOutfit` table. All the data in the column will be lost.
  - You are about to drop the column `userPrompt` on the `UserOutline` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[conversationId]` on the table `UserOutline` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'AI', 'ADMIN');

-- CreateEnum
CREATE TYPE "WEATHER_CONDITION" AS ENUM ('summer', 'winter', 'rainy', 'breathable', 'waterproof', 'layeringPiece');

-- DropForeignKey
ALTER TABLE "UserOutline" DROP CONSTRAINT "UserOutline_userId_fkey";

-- AlterTable
ALTER TABLE "Garment" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "GarmentInOutfit" DROP COLUMN "order",
ADD COLUMN     "layerLevel" "LAYER_LEVEL",
ADD COLUMN     "slot" "FITTING_SLOT";

-- AlterTable
ALTER TABLE "UserOutline" DROP COLUMN "userPrompt",
ADD COLUMN     "conversationId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "conversationId" TEXT,
    "role" "ChatMessageRole" NOT NULL DEFAULT 'USER',

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatMessageId" TEXT NOT NULL,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionMemory" (
    "id" TEXT NOT NULL,
    "chatMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmotionMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMap" (
    "id" TEXT NOT NULL,
    "userOutlineId" TEXT NOT NULL,
    "mapData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_refreshToken_key" ON "ChatSession"("refreshToken");

-- CreateIndex
CREATE INDEX "Conversation_userId_lastMessageAt_idx" ON "Conversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_userId_isDeleted_idx" ON "Conversation"("userId", "isDeleted");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_conversationId_idx" ON "ChatMessage"("userId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_chatMessageId_key" ON "Embedding"("chatMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmotionMemory_chatMessageId_key" ON "EmotionMemory"("chatMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMap_userOutlineId_key" ON "UserMap"("userOutlineId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOutline_conversationId_key" ON "UserOutline"("conversationId");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserOutline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutline" ADD CONSTRAINT "UserOutline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutline" ADD CONSTRAINT "UserOutline_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionMemory" ADD CONSTRAINT "EmotionMemory_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionMemory" ADD CONSTRAINT "EmotionMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMap" ADD CONSTRAINT "UserMap_userOutlineId_fkey" FOREIGN KEY ("userOutlineId") REFERENCES "UserOutline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garment" ADD CONSTRAINT "Garment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
