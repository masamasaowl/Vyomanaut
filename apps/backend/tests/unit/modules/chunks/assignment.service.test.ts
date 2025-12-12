import { describe, it, expect, beforeEach } from 'vitest';
import { chunkAssignmentService } from '../../../../src/modules/chunks/assignment.service';
import { fileService } from '../../../../src/modules/files/file.service';
import { deviceService } from '../../../../src/modules/devices/device.service';
import { prisma } from '../../../../src/config/database';
import { ChunkStatus } from '@prisma/client';
import { 
  createMockDevicePayload, 
  createSmallTestFile, 
  generateCompanyId, 
  STORAGE 
} from '../../../helpers';

/**
 * Chunk Assignment Service Unit Tests
 * 
 * Tests the logic for selecting which devices should store which chunks
 * This is critical for redundancy and reliability!
 */

describe('Chunk Assignment Service', () => {
  
  // ========================================
  // CHUNK ASSIGNMENT TESTS
  // ========================================
  
  describe('assignChunk', () => {
    
    it('should assign chunk to 3 devices (redundancy factor)', async () => {
      // Arrange: Create 5 devices (more than needed)
      for (let i = 0; i < 5; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      // Create a file with chunks
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act: Assign chunk
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Assert: Should assign to exactly 3 devices
      expect(assignment.deviceIds.length).toBe(3);
    });
    
    it('should create ChunkLocation records for each assignment', async () => {
      // Arrange: Create devices
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      // Create file and chunk
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act: Assign chunk
      await chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes);
      
      // Assert: ChunkLocation records should exist
      const locations = await prisma.chunkLocation.findMany({
        where: { chunkId: chunk!.id },
      });
      
      expect(locations.length).toBe(3);
      
      // Each location should have path and be marked unhealthy initially
      locations.forEach(loc => {
        expect(loc.localPath).toContain('/storage/chunks/');
        expect(loc.isHealthy).toBe(true); // Starts as true, waiting for confirmation
      });
    });
    
    it('should update chunk status to REPLICATING', async () => {
      // Arrange
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Verify initial status
      expect(chunk!.status).toBe(ChunkStatus.PENDING);
      
      // Act: Assign
      await chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes);
      
      // Assert: Status changed to REPLICATING
      const updatedChunk = await prisma.chunk.findUnique({
        where: { id: chunk!.id },
      });
      
      expect(updatedChunk!.status).toBe(ChunkStatus.REPLICATING);
      expect(updatedChunk!.currentReplicas).toBe(0); // Not confirmed yet
    });
    
    it('should select devices with highest reliability first', async () => {
      // Arrange: Create devices with different reliability
      const device1 = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      const device2 = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      const device3 = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      
      // Set different reliability scores
      await prisma.device.update({
        where: { id: device1.id },
        data: { reliabilityScore: 95 },
      });
      await prisma.device.update({
        where: { id: device2.id },
        data: { reliabilityScore: 85 },
      });
      await prisma.device.update({
        where: { id: device3.id },
        data: { reliabilityScore: 90 },
      });
      
      // Create chunk
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act: Assign
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Assert: Should select devices in reliability order
      const locations = await prisma.chunkLocation.findMany({
        where: { chunkId: chunk!.id },
        include: { device: true },
      });
      
      const scores = locations.map(loc => loc.device.reliabilityScore).sort((a, b) => b - a);
      
      // Top 3 scores should be 95, 90, 85
      expect(scores[0]).toBe(95);
      expect(scores[1]).toBe(90);
      expect(scores[2]).toBe(85);
    });
    
    it('should throw error when not enough healthy devices', async () => {
      // Arrange: Only 2 devices (need 3)
      await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      
      // Create chunk
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act & Assert: Should throw
      await expect(
        chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes)
      ).rejects.toThrow('Not enough healthy devices');
    });
    
    it('should exclude offline devices from assignment', async () => {
      // Arrange: 4 devices, mark 1 offline
      const devices: any = [];
      for (let i = 0; i < 4; i++) {
        const device = await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
        devices.push(device);
      }
      
      // Mark one offline
      await deviceService.markDeviceOffline(devices[0].deviceId);
      
      // Create chunk
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act: Assign
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Assert: Should only use online devices
      const locations = await prisma.chunkLocation.findMany({
        where: { chunkId: chunk!.id },
        include: { device: true },
      });
      
      // None should be the offline device
      const offlineDeviceUsed = locations.some(loc => loc.device.id === devices[0].id);
      expect(offlineDeviceUsed).toBe(false);
    });
  });
  
  // ========================================
  // CHUNK DELIVERY CONFIRMATION TESTS
  // ========================================
  
  describe('confirmChunkDelivery', () => {
    
    it('should increment replica count on confirmation', async () => {
      // Arrange: Create devices and assign chunk
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Act: Confirm delivery to first device
      await chunkAssignmentService.confirmChunkDelivery(
        chunk!.id,
        assignment.deviceIds[0]
      );
      
      // Assert: Replica count increased
      const updatedChunk = await prisma.chunk.findUnique({
        where: { id: chunk!.id },
      });
      
      expect(updatedChunk!.currentReplicas).toBe(1);
    });
    
    it('should update ChunkLocation lastVerified timestamp', async () => {
      // Arrange
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Get location before confirmation
      const locationBefore = await prisma.chunkLocation.findFirst({
        where: {
          chunkId: chunk!.id,
          deviceId: assignment.deviceIds[0],
        },
      });
      
      expect(locationBefore!.lastVerified).toBeNull();
      
      // Act: Confirm
      await chunkAssignmentService.confirmChunkDelivery(
        chunk!.id,
        assignment.deviceIds[0]
      );
      
      // Assert: lastVerified should be set
      const locationAfter = await prisma.chunkLocation.findFirst({
        where: {
          chunkId: chunk!.id,
          deviceId: assignment.deviceIds[0],
        },
      });
      
      expect(locationAfter!.lastVerified).not.toBeNull();
      expect(locationAfter!.isHealthy).toBe(true);
    });
    
    it('should mark chunk as HEALTHY when reaching target replicas', async () => {
      // Arrange
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Act: Confirm all 3 deliveries
      for (const deviceId of assignment.deviceIds) {
        await chunkAssignmentService.confirmChunkDelivery(chunk!.id, deviceId);
      }
      
      // Assert: Chunk should be HEALTHY
      const updatedChunk = await prisma.chunk.findUnique({
        where: { id: chunk!.id },
      });
      
      expect(updatedChunk!.status).toBe(ChunkStatus.HEALTHY);
      expect(updatedChunk!.currentReplicas).toBe(3);
    });
    
    it('should throw error when confirming non-existent assignment', async () => {
      // Arrange: Create chunk but don't assign
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act & Assert: Should throw
      await expect(
        chunkAssignmentService.confirmChunkDelivery(chunk!.id, 'fake-device-id')
      ).rejects.toThrow('ChunkLocation not found');
    });
  });
  
  // ========================================
  // CHUNK LOCATION RETRIEVAL TESTS
  // ========================================
  
  describe('getChunkLocations', () => {
    
    it('should return all device locations for a chunk', async () => {
      // Arrange
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      await chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes);
      
      // Act
      const locations = await chunkAssignmentService.getChunkLocations(chunk!.id);
      
      // Assert
      expect(locations.length).toBe(3);
      locations.forEach(loc => {
        expect(loc.deviceId).toBeDefined();
        expect(loc.localPath).toContain('/storage/chunks/');
        expect(loc.isHealthy).toBe(true);
      });
    });
    
    it('should return empty array for unassigned chunk', async () => {
      // Arrange: Create chunk but don't assign
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Act
      const locations = await chunkAssignmentService.getChunkLocations(chunk!.id);
      
      // Assert
      expect(locations).toEqual([]);
    });
  });
  
  // ========================================
  // CHUNK REASSIGNMENT TESTS
  // ========================================
  
  describe('reassignChunk', () => {
    
    it('should reassign chunk when below redundancy target', async () => {
      // Arrange: Create 5 devices
      for (let i = 0; i < 5; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      // Assign to 3 devices
      const assignment = await chunkAssignmentService.assignChunk(
        chunk!.id,
        chunk!.sizeBytes
      );
      
      // Simulate one device going offline
      const locations = await prisma.chunkLocation.findMany({
        where: { chunkId: chunk!.id },
      });
      
      await prisma.chunkLocation.update({
        where: { id: locations[0].id },
        data: { isHealthy: false },
      });
      
      // Mark corresponding device offline
      await deviceService.markDeviceOffline(
        (await prisma.device.findUnique({ where: { id: locations[0].deviceId } }))!.deviceId
      );
      
      // Act: Reassign
      await chunkAssignmentService.reassignChunk(chunk!.id);
      
      // Assert: Should have new assignment
      const newLocations = await prisma.chunkLocation.findMany({
        where: { 
          chunkId: chunk!.id,
          isHealthy: true,
        },
      });
      
      // Should have assignments (original 2 healthy + new ones)
      expect(newLocations.length).toBeGreaterThan(2);
    });
    
    it('should not reassign when at target replicas', async () => {
      // Arrange: Healthy chunk with 3 replicas
      for (let i = 0; i < 3; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      await chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes);
      
      const locationsBefore = await prisma.chunkLocation.count({
        where: { chunkId: chunk!.id },
      });
      
      // Act: Try to reassign
      await chunkAssignmentService.reassignChunk(chunk!.id);
      
      // Assert: No new assignments
      const locationsAfter = await prisma.chunkLocation.count({
        where: { chunkId: chunk!.id },
      });
      
      expect(locationsAfter).toBe(locationsBefore);
    });
    
    it('should avoid assigning to devices that already have the chunk', async () => {
      // Arrange: 4 devices, assign to 3, mark 1 unhealthy
      for (let i = 0; i < 4; i++) {
        await deviceService.registerDevice(
          createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
        );
      }
      
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      await chunkAssignmentService.assignChunk(chunk!.id, chunk!.sizeBytes);
      
      // Mark one location unhealthy
      const locations = await prisma.chunkLocation.findMany({
        where: { chunkId: chunk!.id },
      });
      
      await prisma.chunkLocation.update({
        where: { id: locations[0].id },
        data: { isHealthy: false },
      });
      
      // Act: Reassign
      await chunkAssignmentService.reassignChunk(chunk!.id);
      
      // Assert: Should use the 4th device (not the first 3)
      const allLocations = await prisma.chunkLocation.findMany({
        where: { chunkId: chunk!.id },
      });
      
      const deviceIds = allLocations.map(loc => loc.deviceId);
      const uniqueDeviceIds = new Set(deviceIds);
      
      // Should have used 4 different devices
      expect(uniqueDeviceIds.size).toBe(4);
    });
  });
  
  // ========================================
  // DEGRADED CHUNK DETECTION TESTS
  // ========================================
  
  describe('getChunksNeedingReassignment', () => {
    
    it('should find chunks with DEGRADED status', async () => {
      // Arrange: Create chunk and manually set to DEGRADED
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      await prisma.chunk.update({
        where: { id: chunk!.id },
        data: { status: ChunkStatus.DEGRADED },
      });
      
      // Act
      const degradedChunks = await chunkAssignmentService.getChunksNeedingReassignment();
      
      // Assert
      expect(degradedChunks).toContain(chunk!.id);
    });
    
    it('should find chunks in REPLICATING with insufficient replicas', async () => {
      // Arrange: Create chunk, set to REPLICATING but with low replica count
      const file = await fileService.uploadFile(
        createSmallTestFile(),
        'test.txt',
        'text/plain',
        generateCompanyId()
      );
      
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      await prisma.chunk.update({
        where: { id: chunk!.id },
        data: {
          status: ChunkStatus.REPLICATING,
          currentReplicas: 1,
          targetReplicas: 3,
        },
      });
      
      // Act
      const needsReassignment = await chunkAssignmentService.getChunksNeedingReassignment();
      
      // Assert
      expect(needsReassignment).toContain(chunk!.id);
    });
  });
});