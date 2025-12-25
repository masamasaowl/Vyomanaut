-- AlterTable
ALTER TABLE "ChunkLocation" ADD COLUMN     "lastEarningsUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "totalEarnings" DECIMAL(10,6) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "lastPaymentAt" TIMESTAMP(3),
ADD COLUMN     "pendingEarnings" DECIMAL(10,6) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EarningRecord" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "storageGB" DOUBLE PRECISION NOT NULL,
    "hoursOnline" DOUBLE PRECISION NOT NULL,
    "earned" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "EarningRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EarningRecord_deviceId_period_idx" ON "EarningRecord"("deviceId", "period");

-- AddForeignKey
ALTER TABLE "EarningRecord" ADD CONSTRAINT "EarningRecord_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
