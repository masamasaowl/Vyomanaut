/*
  Warnings:

  - Added the required column `aad` to the `Chunk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authTag` to the `Chunk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `iv` to the `Chunk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dekId` to the `File` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN     "aad" TEXT NOT NULL,
ADD COLUMN     "authTag" TEXT NOT NULL,
ADD COLUMN     "iv" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "dekId" TEXT NOT NULL;
