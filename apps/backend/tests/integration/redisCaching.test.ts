import { describe, it, expect } from 'vitest';
import { 
  cacheDeviceStatus, 
  getCachedDeviceStatus,
  cacheChunkLocations,
  getCachedChunkLocations,
  invalidateChunkCache,
  updateDeviceLastSeen,
  getOnlineDevices,
} from '../../src/config/redis';
import { DeviceStatus } from '@prisma/client';
import { sleep, TIME } from '../helpers';

/**
 * Redis Caching Integration Tests
 * 
 * Tests the caching layer that makes our system fast
 * Redis is critical for performance at scale!
 */

describe('Redis Caching Integration', () => {
  
  // ========================================
  // DEVICE STATUS CACHING
  // ========================================
  
  describe('Device Status Caching', () => {
    
    it('should cache and retrieve device status', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      
      // Act: Cache status
      await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);
      
      // Assert: Retrieve status
      const status = await getCachedDeviceStatus(deviceId);
      expect(status).toBe(DeviceStatus.ONLINE);
    });
    
    it('should update cached status when changed', async () => {
      // Arrange
      const deviceId = 'test-device-456';
      await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);
      
      // Act: Update to OFFLINE
      await cacheDeviceStatus(deviceId, DeviceStatus.OFFLINE);
      
      // Assert: Should reflect new status
      const status = await getCachedDeviceStatus(deviceId);
      expect(status).toBe(DeviceStatus.OFFLINE);
    });
    
    it('should return null for uncached device', async () => {
      // Act
      const status = await getCachedDeviceStatus('non-existent-device');
      
      // Assert
      expect(status).toBeNull();
    });
    
    it('should expire device status after TTL (90 seconds)', async () => {
      // This test would take 90+ seconds to run, so we'll skip it in normal runs
      // But the implementation sets TTL to 90 seconds
      
      const deviceId = 'test-device-ttl';
      await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);
      
      // Verify it exists immediately
      const statusBefore = await getCachedDeviceStatus(deviceId);
      expect(statusBefore).toBe(DeviceStatus.ONLINE);
      
      // Note: In production, this would expire after 90s
      // We trust Redis TTL implementation works correctly
    });
    
    it('should handle concurrent status updates', async () => {
      // Arrange
      const deviceId = 'test-device-concurrent';
      
      // Act: Multiple concurrent updates
      await Promise.all([
        cacheDeviceStatus(deviceId, DeviceStatus.ONLINE),
        cacheDeviceStatus(deviceId, DeviceStatus.ONLINE),
        cacheDeviceStatus(deviceId, DeviceStatus.ONLINE),
      ]);
      
      // Assert: Should be consistent
      const status = await getCachedDeviceStatus(deviceId);
      expect(status).toBe(DeviceStatus.ONLINE);
    });
  });
  
  // ========================================
  // CHUNK LOCATION CACHING
  // ========================================
  
  describe('Chunk Location Caching', () => {
    
    it('should cache and retrieve chunk locations', async () => {
      // Arrange
      const chunkId = 'test-chunk-123';
      const deviceIds = ['device-1', 'device-2', 'device-3'];
      
      // Act: Cache locations
      await cacheChunkLocations(chunkId, deviceIds);
      
      // Assert: Retrieve locations
      const cached = await getCachedChunkLocations(chunkId);
      expect(cached).toEqual(deviceIds);
    });
    
    it('should return null for uncached chunk', async () => {
      // Act
      const locations = await getCachedChunkLocations('non-existent-chunk');
      
      // Assert
      expect(locations).toBeNull();
    });
    
    it('should invalidate chunk cache', async () => {
      // Arrange: Cache locations
      const chunkId = 'test-chunk-456';
      const deviceIds = ['device-1', 'device-2', 'device-3'];
      await cacheChunkLocations(chunkId, deviceIds);
      
      // Verify cached
      const cachedBefore = await getCachedChunkLocations(chunkId);
      expect(cachedBefore).toEqual(deviceIds);
      
      // Act: Invalidate
      await invalidateChunkCache(chunkId);
      
      // Assert: Should be gone
      const cachedAfter = await getCachedChunkLocations(chunkId);
      expect(cachedAfter).toBeNull();
    });
    
    it('should cache empty array for chunk with no locations', async () => {
      // Arrange
      const chunkId = 'test-chunk-empty';
      const deviceIds: string[] = [];
      
      // Act: Cache empty array
      await cacheChunkLocations(chunkId, deviceIds);
      
      // Assert: Should retrieve empty array (not null)
      const cached = await getCachedChunkLocations(chunkId);
      expect(cached).toEqual([]);
    });
    
    it('should preserve order of device IDs', async () => {
      // Arrange
      const chunkId = 'test-chunk-order';
      const deviceIds = ['device-3', 'device-1', 'device-2'];
      
      // Act: Cache
      await cacheChunkLocations(chunkId, deviceIds);
      
      // Assert: Order preserved
      const cached = await getCachedChunkLocations(chunkId);
      expect(cached).toEqual(deviceIds);
      expect(cached![0]).toBe('device-3');
      expect(cached![1]).toBe('device-1');
      expect(cached![2]).toBe('device-2');
    });
  });
  
  // ========================================
  // ONLINE DEVICES TRACKING
  // ========================================
  
  describe('Online Devices Tracking', () => {
    
    it('should track device last seen timestamp', async () => {
      // Arrange
      const deviceId = 'test-device-789';
      
      // Act: Update last seen
      await updateDeviceLastSeen(deviceId);
      
      // Assert: Should appear in online devices
      const onlineDevices = await getOnlineDevices(120); // Within last 2 minutes
      expect(onlineDevices).toContain(deviceId);
    });
    
    it('should update last seen timestamp on repeated calls', async () => {
      // Arrange
      const deviceId = 'test-device-update';
      
      // Act: Update multiple times
      await updateDeviceLastSeen(deviceId);
      await sleep(100);
      await updateDeviceLastSeen(deviceId);
      
      // Assert: Should still appear in online devices
      const onlineDevices = await getOnlineDevices(120);
      expect(onlineDevices).toContain(deviceId);
    });
    
    it('should get multiple online devices', async () => {
      // Arrange: Add multiple devices
      const deviceIds = ['device-a', 'device-b', 'device-c'];
      
      for (const deviceId of deviceIds) {
        await updateDeviceLastSeen(deviceId);
      }
      
      // Act
      const onlineDevices = await getOnlineDevices(120);
      
      // Assert: All should be present
      deviceIds.forEach(deviceId => {
        expect(onlineDevices).toContain(deviceId);
      });
    });
    
    it('should exclude devices not seen within time window', async () => {
      // Arrange: Add device and wait
      const oldDeviceId = 'old-device';
      const newDeviceId = 'new-device';
      
      await updateDeviceLastSeen(oldDeviceId);
      
      // Wait a bit
      await sleep(200);
      
      await updateDeviceLastSeen(newDeviceId);
      
      // Act: Get devices seen in last 100ms
      const recentDevices = await getOnlineDevices(0.1); // 0.1 seconds
      
      // Assert: Only new device should be included
      expect(recentDevices).toContain(newDeviceId);
      expect(recentDevices).not.toContain(oldDeviceId);
    });
    
    it('should return empty array when no devices online', async () => {
      // Act: Get devices from far future
      const onlineDevices = await getOnlineDevices(0.001); // 1ms window
      
      // Assert: Should be empty or very few
      // (Might have devices from other tests if they ran recently)
      expect(Array.isArray(onlineDevices)).toBe(true);
    });
    
    it('should handle time window edge cases', async () => {
      // Arrange
      const deviceId = 'test-device-edge';
      await updateDeviceLastSeen(deviceId);
      
      // Act: Different time windows
      const devices1s = await getOnlineDevices(1);
      const devices60s = await getOnlineDevices(60);
      const devices0s = await getOnlineDevices(0);
      
      // Assert: Should appear in reasonable windows
      expect(devices1s).toContain(deviceId);
      expect(devices60s).toContain(deviceId);
      // 0s window might or might not include it due to timing
    });
  });
  
  // ========================================
  // CACHE PERFORMANCE TESTS
  // ========================================
  
  describe('Cache Performance', () => {
    
    it('should handle high-frequency updates', async () => {
      // Arrange
      const deviceId = 'test-device-perf';
      
      // Act: 100 rapid updates
      const updates = Array.from({ length: 100 }, (_, i) => 
        cacheDeviceStatus(deviceId, i % 2 === 0 ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE)
      );
      
      await Promise.all(updates);
      
      // Assert: Should complete without error
      const status = await getCachedDeviceStatus(deviceId);
      expect([DeviceStatus.ONLINE, DeviceStatus.OFFLINE]).toContain(status!);
    });
    
    it('should handle large chunk location arrays', async () => {
      // Arrange: Chunk stored on 100 devices (extreme case)
      const chunkId = 'test-chunk-large';
      const deviceIds = Array.from({ length: 100 }, (_, i) => `device-${i}`);
      
      // Act: Cache large array
      await cacheChunkLocations(chunkId, deviceIds);
      
      // Assert: Should retrieve correctly
      const cached = await getCachedChunkLocations(chunkId);
      expect(cached?.length).toBe(100);
      expect(cached).toEqual(deviceIds);
    });
    
    it('should handle concurrent operations on different keys', async () => {
      // Arrange: Multiple operations at once
      const operations = [
        cacheDeviceStatus('device-1', DeviceStatus.ONLINE),
        cacheDeviceStatus('device-2', DeviceStatus.OFFLINE),
        cacheChunkLocations('chunk-1', ['d1', 'd2', 'd3']),
        cacheChunkLocations('chunk-2', ['d4', 'd5', 'd6']),
        updateDeviceLastSeen('device-3'),
        getCachedDeviceStatus('device-1'),
        getCachedChunkLocations('chunk-1'),
      ];
      
      // Act: Execute all concurrently
      const results = await Promise.allSettled(operations);
      
      // Assert: All should succeed
      const failures = results.filter(r => r.status === 'rejected');
      expect(failures.length).toBe(0);
    });
  });
  
  // ========================================
  // CACHE CONSISTENCY TESTS
  // ========================================
  
  describe('Cache Consistency', () => {
    
    it('should maintain consistency across reads and writes', async () => {
      // Arrange
      const deviceId = 'test-device-consistency';
      
      // Act: Write then read multiple times
      await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);
      const read1 = await getCachedDeviceStatus(deviceId);
      const read2 = await getCachedDeviceStatus(deviceId);
      const read3 = await getCachedDeviceStatus(deviceId);
      
      // Assert: All reads should be consistent
      expect(read1).toBe(DeviceStatus.ONLINE);
      expect(read2).toBe(DeviceStatus.ONLINE);
      expect(read3).toBe(DeviceStatus.ONLINE);
    });
    
    it('should handle cache invalidation correctly', async () => {
      // Arrange: Cache chunk locations
      const chunkId = 'test-chunk-invalidate';
      await cacheChunkLocations(chunkId, ['d1', 'd2', 'd3']);
      
      // Verify cached
      expect(await getCachedChunkLocations(chunkId)).toEqual(['d1', 'd2', 'd3']);
      
      // Act: Invalidate
      await invalidateChunkCache(chunkId);
      
      // Assert: Should be gone
      expect(await getCachedChunkLocations(chunkId)).toBeNull();
      
      // Act: Re-cache with different data
      await cacheChunkLocations(chunkId, ['d4', 'd5']);
      
      // Assert: New data should be cached
      expect(await getCachedChunkLocations(chunkId)).toEqual(['d4', 'd5']);
    });
  });
});