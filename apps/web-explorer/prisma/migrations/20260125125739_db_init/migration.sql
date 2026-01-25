-- CreateTable
CREATE TABLE "StoredChunk" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chunkId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sequenceNum" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "isHealthy" BOOLEAN NOT NULL DEFAULT true,
    "lastVerified" TIMESTAMP(3),

    CONSTRAINT "StoredChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoredChunk_chunkId_idx" ON "StoredChunk"("chunkId");

-- CreateIndex
CREATE INDEX "StoredChunk_deviceId_idx" ON "StoredChunk"("deviceId");

-- CreateIndex
CREATE INDEX "StoredChunk_chunkId_deviceId_idx" ON "StoredChunk"("chunkId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredChunk_chunkId_deviceId_key" ON "StoredChunk"("chunkId", "deviceId");
