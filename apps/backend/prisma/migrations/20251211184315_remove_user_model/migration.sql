/*
  Warnings:

  - You are about to drop the column `userId` on the `Device` table. All the data in the column will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_userId_fkey";

-- DropIndex
DROP INDEX "Device_userId_idx";

-- AlterTable
ALTER TABLE "Device" DROP COLUMN "userId";

-- DropTable
DROP TABLE "User";
