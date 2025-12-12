import { describe, it, expect } from 'vitest';
import { fileService } from '../../src/modules/files/file.service';
import { deviceService } from '../../src/modules/devices/device.service';
import { chunkAssignmentService } from '../../src/modules/chunks/assignment.service';
import { prisma } from '../../src/config/database';
import { FileStatus, ChunkStatus } from '@prisma/client';
import { 
  createMockDevicePayload,
  createSmallTestFile,
  createLargeTestFile,
  generateCompanyId,
  STORAGE,
} from '../helpers';

/**
 * End-to-End File Lifecycle Tests
 * 
 * Tests the complete journey of a file through the system:
 * Upload → Process → Distribute → Retrieve → Delete
 * 
 * These tests verify that all components work together correctly!
 */

describe('E2E: Complete File Lifecycle', () => {
  
  it('should handle complete file lifecycle from upload to chunk distribution', async () => {
    // ========================================
    // PHASE 1: SETUP - Create Devices
    // ========================================
    console.log('Phase 1: Creating devices...');
    
    const devices = [];
    for (let i = 0; i < 3; i++) {
      const device = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      devices.push(device);
    }
    
    expect(devices.length).toBe(3);
    console.log(`✅ Created ${devices.length} devices`);
    
    // ========================================
    // PHASE 2: UPLOAD - Company Uploads File
    // ========================================
    console.log('Phase 2: Uploading file...');
    
    const fileBuffer = createSmallTestFile();
    const companyId = generateCompanyId();
    
    const file = await fileService.uploadFile(
      fileBuffer,
      'important-document.txt',
      'text/plain',
      companyId
    );
    
    expect(file.status).toBe(FileStatus.ACTIVE);
    expect(file.chunkCount).toBe(1);
    console.log(`✅ File uploaded: ${file.id}`);
    
    // ========================================
    // PHASE 3: PROCESS - Chunks Created
    // ========================================
    console.log('Phase 3: Verifying chunks...');
    
    const chunks = await prisma.chunk.findMany({
      where: { fileId: file.id },
    });
    
    expect(chunks.length).toBe(1);
    expect(chunks[0].status).toBe(ChunkStatus.PENDING);
    console.log(`✅ Chunk created: ${chunks[0].id}`);
    
    // ========================================
    // PHASE 4: DISTRIBUTE - Assign to Devices
    // ========================================
    console.log('Phase 4: Assigning chunks to devices...');
    
    const assignment = await chunkAssignmentService.assignChunk(
      chunks[0].id,
      chunks[0].sizeBytes
    );
    
    expect(assignment.deviceIds.length).toBe(3);
    console.log(`✅ Chunk assigned to ${assignment.deviceIds.length} devices`);
    
    // Verify ChunkLocations created
    const locations = await prisma.chunkLocation.findMany({
      where: { chunkId: chunks[0].id },
    });
    
    expect(locations.length).toBe(3);
    
    // ========================================
    // PHASE 5: CONFIRM - Devices Acknowledge
    // ========================================
    console.log('Phase 5: Simulating device confirmations...');
    
    // Simulate all devices confirming receipt
    for (const deviceId of assignment.deviceIds) {
      await chunkAssignmentService.confirmChunkDelivery(chunks[0].id, deviceId);
    }
    
    // Verify chunk is now HEALTHY
    const healthyChunk = await prisma.chunk.findUnique({
      where: { id: chunks[0].id },
    });
    
    expect(healthyChunk!.status).toBe(ChunkStatus.HEALTHY);
    expect(healthyChunk!.currentReplicas).toBe(3);
    console.log(`✅ Chunk confirmed healthy with 3 replicas`);
    
    // ========================================
    // PHASE 6: VERIFY - Check Locations
    // ========================================
    console.log('Phase 6: Verifying chunk locations...');
    
    const chunkLocations = await chunkAssignmentService.getChunkLocations(chunks[0].id);
    
    expect(chunkLocations.length).toBe(3);
    chunkLocations.forEach(loc => {
      expect(loc.isHealthy).toBe(true);
      expect(loc.lastVerified).not.toBeNull();
    });
    
    console.log(`✅ All locations verified`);
    
    // ========================================
    // PHASE 7: STATS - Verify Statistics
    // ========================================
    console.log('Phase 7: Checking statistics...');
    
    const stats = await fileService.getFileStats(companyId);
    
    expect(stats.totalFiles).toBeGreaterThanOrEqual(1);
    expect(stats.activeFiles).toBeGreaterThanOrEqual(1);
    expect(stats.totalChunks).toBeGreaterThanOrEqual(1);
    
    console.log(`✅ Statistics: ${stats.totalFiles} files, ${stats.totalChunks} chunks`);
    
    console.log('🎉 Complete lifecycle test passed!');
  });
  
  it('should handle large file with multiple chunks', async () => {
    // Setup: Create 5 devices (need more for multiple chunks)
    for (let i = 0; i < 5; i++) {
      await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(20) })
      );
    }
    
    // Upload: 12MB file = 3 chunks
    const fileBuffer = createLargeTestFile();
    const companyId = generateCompanyId();
    
    const file = await fileService.uploadFile(
      fileBuffer,
      'large-file.bin',
      'application/octet-stream',
      companyId
    );
    
    expect(file.chunkCount).toBe(3);
    
    // Get all chunks
    const chunks = await prisma.chunk.findMany({
      where: { fileId: file.id },
      orderBy: { sequenceNum: 'asc' },
    });
    
    expect(chunks.length).toBe(3);
    
    // Assign all chunks
    for (const chunk of chunks) {
      const assignment = await chunkAssignmentService.assignChunk(
        chunk.id,
        chunk.sizeBytes
      );
      
      expect(assignment.deviceIds.length).toBe(3);
      
      // Confirm deliveries
      for (const deviceId of assignment.deviceIds) {
        await chunkAssignmentService.confirmChunkDelivery(chunk.id, deviceId);
      }
    }
    
    // Verify all chunks are HEALTHY
    const healthyChunks = await prisma.chunk.findMany({
      where: {
        fileId: file.id,
        status: ChunkStatus.HEALTHY,
      },
    });
    
    expect(healthyChunks.length).toBe(3);
    
    // Verify total locations (3 chunks × 3 replicas = 9 locations)
    const allLocations = await prisma.chunkLocation.count({
      where: {
        chunk: { fileId: file.id },
      },
    });
    
    expect(allLocations).toBe(9);
  });
  
  it('should handle device going offline during distribution', async () => {
    // Setup: Create 4 devices
    const devices = [];
    for (let i = 0; i < 4; i++) {
      const device = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      devices.push(device);
    }
    
    // Upload file
    const file = await fileService.uploadFile(
      createSmallTestFile(),
      'test.txt',
      'text/plain',
      generateCompanyId()
    );
    
    const chunk = await prisma.chunk.findFirst({
      where: { fileId: file.id },
    });
    
    // Assign chunk
    const assignment = await chunkAssignmentService.assignChunk(
      chunk!.id,
      chunk!.sizeBytes
    );
    
    // Confirm 2 devices
    await chunkAssignmentService.confirmChunkDelivery(
      chunk!.id,
      assignment.deviceIds[0]
    );
    await chunkAssignmentService.confirmChunkDelivery(
      chunk!.id,
      assignment.deviceIds[1]
    );
    
    // Mark third device offline (before it confirms)
    await deviceService.markDeviceOffline(
      (await prisma.device.findUnique({ where: { id: assignment.deviceIds[2] } }))!.deviceId
    );
    
    // Check chunk status - should still be REPLICATING (not HEALTHY yet)
    const chunkStatus = await prisma.chunk.findUnique({
      where: { id: chunk!.id },
    });
    
    expect(chunkStatus!.currentReplicas).toBe(2);
    expect(chunkStatus!.status).not.toBe(ChunkStatus.HEALTHY);
    
    // Reassign to reach target
    await chunkAssignmentService.reassignChunk(chunk!.id);
    
    // Should have new assignment to the 4th device
    const locations = await prisma.chunkLocation.findMany({
      where: { chunkId: chunk!.id },
    });
    
    expect(locations.length).toBeGreaterThanOrEqual(3);
  });
  
  it('should handle file deletion', async () => {
    // Setup
    await deviceService.registerDevice(
      createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
    );
    
    // Upload file
    const file = await fileService.uploadFile(
      createSmallTestFile(),
      'to-delete.txt',
      'text/plain',
      generateCompanyId()
    );
    
    expect(file.status).toBe(FileStatus.ACTIVE);
    
    // Delete file
    await fileService.deleteFile(file.id);
    
    // Verify status changed
    const deletedFile = await fileService.getFile(file.id);
    expect(deletedFile!.status).toBe(FileStatus.DELETED);
    
    // Note: Chunks and locations remain (cleaned by background job)
    // This is expected behavior - soft delete
  });
  
  it('should maintain data integrity across multiple file operations', async () => {
    // Setup: Create devices
    for (let i = 0; i < 5; i++) {
      await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(20) })
      );
    }
    
    const companyId = generateCompanyId();
    
    // Upload multiple files concurrently
    const uploads = [
      fileService.uploadFile(createSmallTestFile(), 'file1.txt', 'text/plain', companyId),
      fileService.uploadFile(createSmallTestFile(), 'file2.txt', 'text/plain', companyId),
      fileService.uploadFile(createSmallTestFile(), 'file3.txt', 'text/plain', companyId),
    ];
    
    const files = await Promise.all(uploads);
    
    // All should succeed
    expect(files.length).toBe(3);
    files.forEach(file => {
      expect(file.status).toBe(FileStatus.ACTIVE);
    });
    
    // Get all chunks
    const allChunks = await prisma.chunk.findMany({
      where: {
        fileId: { in: files.map(f => f.id) },
      },
    });
    
    expect(allChunks.length).toBe(3); // One chunk per file
    
    // Assign all chunks
    for (const chunk of allChunks) {
      await chunkAssignmentService.assignChunk(chunk.id, chunk.sizeBytes);
    }
    
    // Verify all have locations
    const totalLocations = await prisma.chunkLocation.count({
      where: {
        chunkId: { in: allChunks.map(c => c.id) },
      },
    });
    
    expect(totalLocations).toBe(9); // 3 chunks × 3 replicas
    
    // Verify statistics
    const stats = await fileService.getFileStats(companyId);
    expect(stats.totalFiles).toBe(3);
    expect(stats.totalChunks).toBe(3);
  });
  
  it('should handle edge case: file exactly at chunk boundary', async () => {
    // Setup
    for (let i = 0; i < 3; i++) {
      await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
    }
    
    // Create file exactly 5MB (chunk size)
    const exactlyOneChunk = Buffer.alloc(5 * 1024 * 1024, 'A');
    
    const file = await fileService.uploadFile(
      exactlyOneChunk,
      'exactly-5mb.bin',
      'application/octet-stream',
      generateCompanyId()
    );
    
    // Should be exactly 1 chunk
    expect(file.chunkCount).toBe(1);
    
    const chunks = await prisma.chunk.findMany({
      where: { fileId: file.id },
    });
    
    expect(chunks.length).toBe(1);
  });
  
  it('should handle storage capacity constraints', async () => {
    // Setup: Create device with limited storage (100KB)
    await deviceService.registerDevice(
      createMockDevicePayload({ totalStorageBytes: 100 * 1024 })
    );
    
    // Try to upload 1MB file (won't fit)
    const largish = Buffer.alloc(1024 * 1024, 'A');
    
    const file = await fileService.uploadFile(
      largish,
      'too-big.bin',
      'application/octet-stream',
      generateCompanyId()
    );
    
    const chunk = await prisma.chunk.findFirst({
      where: { fileId: file.id },
    });
    
    // Should fail to assign (not enough storage)
    await expect(
      chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes)
    ).rejects.toThrow('Not enough healthy devices');
  });
});