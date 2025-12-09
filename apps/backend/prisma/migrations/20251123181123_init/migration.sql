-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('ANDROID', 'IOS', 'DESKTOP');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('UPLOADING', 'ACTIVE', 'DEGRADED', 'DELETED');

-- CreateEnum
CREATE TYPE "ChunkStatus" AS ENUM ('PENDING', 'REPLICATING', 'HEALTHY', 'DEGRADED', 'LOST');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "userId" TEXT NOT NULL,
    "totalStorageBytes" BIGINT NOT NULL,
    "availableStorageBytes" BIGINT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "totalUptime" BIGINT NOT NULL DEFAULT 0,
    "totalDowntime" BIGINT NOT NULL DEFAULT 0,
    "totalEarnings" DECIMAL(10,6) NOT NULL DEFAULT 0,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "companyId" TEXT NOT NULL,
    "encryptionKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'UPLOADING',
    "chunkCount" INTEGER NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fileId" TEXT NOT NULL,
    "sequenceNum" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ChunkStatus" NOT NULL DEFAULT 'PENDING',
    "currentReplicas" INTEGER NOT NULL DEFAULT 0,
    "targetReplicas" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkLocation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chunkId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "lastVerified" TIMESTAMP(3),
    "isHealthy" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChunkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceMetric" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "storageUsedBytes" BIGINT NOT NULL,
    "chunksStored" INTEGER NOT NULL,
    "uptime" BOOLEAN NOT NULL,

    CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMetric" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDevices" INTEGER NOT NULL,
    "devicesOnline" INTEGER NOT NULL,
    "totalStorageBytes" BIGINT NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "totalFiles" INTEGER NOT NULL,

    CONSTRAINT "SystemMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceId_key" ON "Device"("deviceId");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Device_reliabilityScore_idx" ON "Device"("reliabilityScore");

-- CreateIndex
CREATE INDEX "File_companyId_idx" ON "File"("companyId");

-- CreateIndex
CREATE INDEX "File_status_idx" ON "File"("status");

-- CreateIndex
CREATE INDEX "Chunk_status_idx" ON "Chunk"("status");

-- CreateIndex
CREATE INDEX "Chunk_fileId_idx" ON "Chunk"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_fileId_sequenceNum_key" ON "Chunk"("fileId", "sequenceNum");

-- CreateIndex
CREATE INDEX "ChunkLocation_deviceId_idx" ON "ChunkLocation"("deviceId");

-- CreateIndex
CREATE INDEX "ChunkLocation_chunkId_idx" ON "ChunkLocation"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "ChunkLocation_chunkId_deviceId_key" ON "ChunkLocation"("chunkId", "deviceId");

-- CreateIndex
CREATE INDEX "DeviceMetric_deviceId_createdAt_idx" ON "DeviceMetric"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemMetric_createdAt_idx" ON "SystemMetric"("createdAt");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkLocation" ADD CONSTRAINT "ChunkLocation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkLocation" ADD CONSTRAINT "ChunkLocation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
