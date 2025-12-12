import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deviceService } from '../../../../src/modules/devices/device.service';
import { prisma } from '../../../../src/config/database';
import { DeviceStatus } from '@prisma/client';
import { createMockDevicePayload, sleep, STORAGE, TIME } from '../../../helpers';

/**
 * Device Service Unit Tests
 * 
 * Tests the business logic for device lifecycle management
 * Covers: registration, heartbeats, offline detection, health metrics
 */

describe('Device Service', () => {
  
  // ========================================
  // DEVICE REGISTRATION TESTS
  // ========================================
  
  describe('registerDevice', () => {
    
    it('should register a new device successfully', async () => {
      // Arrange: Create mock device payload
      const payload = createMockDevicePayload();
      
      // Act: Register device
      const device = await deviceService.registerDevice(payload);
      
      // Assert: Device should be created with correct data
      expect(device).toBeDefined();
      expect(device.deviceId).toBe(payload.deviceId);
      expect(device.deviceType).toBe(payload.deviceType);
      expect(device.userId).toBe(payload.userId);
      expect(device.totalStorageBytes).toBe(payload.totalStorageBytes);
      expect(device.availableStorageBytes).toBe(payload.totalStorageBytes);
      expect(device.status).toBe(DeviceStatus.ONLINE);
      expect(device.reliabilityScore).toBe(100); // New devices start perfect
      expect(device.totalUptime).toBe(0);
      expect(device.totalDowntime).toBe(0);
      expect(device.totalEarnings).toBe(0);
    });
    
    it('should mark existing device as ONLINE when reconnecting', async () => {
      // Arrange: Register device first time
      const payload = createMockDevicePayload();
      const device1 = await deviceService.registerDevice(payload);
      
      // Mark device offline
      await deviceService.markDeviceOffline(device1.deviceId);
      
      // Act: Re-register same device (reconnection)
      const device2 = await deviceService.registerDevice(payload);
      
      // Assert: Should be same device, now ONLINE
      expect(device2.id).toBe(device1.id);
      expect(device2.status).toBe(DeviceStatus.ONLINE);
    });
    
    it('should track downtime when device reconnects after being offline', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device1 = await deviceService.registerDevice(payload);
      
      // Mark offline
      await deviceService.markDeviceOffline(device1.deviceId);
      
      // Wait a bit to simulate downtime
      await sleep(100);
      
      // Act: Reconnect
      const device2 = await deviceService.registerDevice(payload);
      
      // Assert: Should have tracked some downtime
      expect(device2.totalDowntime).toBeGreaterThan(0);
      expect(device2.reliabilityScore).toBeLessThan(100); // Score decreased
    });
    
    it('should update storage capacity on re-registration', async () => {
      // Arrange: Register with 10GB
      const payload = createMockDevicePayload({ 
        totalStorageBytes: STORAGE.GB(10) 
      });
      await deviceService.registerDevice(payload);
      
      // Act: Re-register with 20GB (user increased allocation)
      payload.totalStorageBytes = STORAGE.GB(20);
      const device = await deviceService.registerDevice(payload);
      
      // Assert: Storage should be updated
      expect(device.totalStorageBytes).toBe(STORAGE.GB(20));
      expect(device.availableStorageBytes).toBe(STORAGE.GB(20));
    });
  });
  
  // ========================================
  // HEARTBEAT TESTS
  // ========================================
  
  describe('updateDeviceHeartbeat', () => {
    
    it('should update lastSeenAt timestamp', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      const originalLastSeen = device.lastSeenAt;
      
      // Wait a bit
      await sleep(50);
      
      // Act: Send heartbeat
      await deviceService.updateDeviceHeartbeat(
        device.deviceId,
        device.availableStorageBytes
      );
      
      // Assert: lastSeenAt should be updated
      const updatedDevice = await deviceService.getDevice(device.deviceId);
      expect(updatedDevice!.lastSeenAt.getTime()).toBeGreaterThan(
        originalLastSeen.getTime()
      );
    });
    
    it('should update available storage', async () => {
      // Arrange: Register device with 10GB
      const payload = createMockDevicePayload({ 
        totalStorageBytes: STORAGE.GB(10) 
      });
      const device = await deviceService.registerDevice(payload);
      
      // Act: Send heartbeat with 8GB available (2GB used)
      await deviceService.updateDeviceHeartbeat(
        device.deviceId,
        STORAGE.GB(8)
      );
      
      // Assert: Available storage should be updated
      const updatedDevice = await deviceService.getDevice(device.deviceId);
      expect(updatedDevice!.availableStorageBytes).toBe(STORAGE.GB(8));
    });
    
    it('should accumulate uptime', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Wait a bit
      await sleep(100);
      
      // Act: Send heartbeat
      await deviceService.updateDeviceHeartbeat(
        device.deviceId,
        device.availableStorageBytes
      );
      
      // Assert: Uptime should increase
      const updatedDevice = await deviceService.getDevice(device.deviceId);
      expect(updatedDevice!.totalUptime).toBeGreaterThan(0);
    });
    
    it('should keep device ONLINE when sending heartbeats', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Act: Send multiple heartbeats
      for (let i = 0; i < 3; i++) {
        await sleep(50);
        await deviceService.updateDeviceHeartbeat(
          device.deviceId,
          device.availableStorageBytes
        );
      }
      
      // Assert: Should still be ONLINE
      const updatedDevice = await deviceService.getDevice(device.deviceId);
      expect(updatedDevice!.status).toBe(DeviceStatus.ONLINE);
    });
    
    it('should throw error for non-existent device', async () => {
      // Act & Assert: Heartbeat for unknown device should fail
      await expect(
        deviceService.updateDeviceHeartbeat('unknown-device', STORAGE.GB(10))
      ).rejects.toThrow('Device unknown-device not found');
    });
  });
  
  // ========================================
  // OFFLINE DETECTION TESTS
  // ========================================
  
  describe('markDeviceOffline', () => {
    
    it('should mark device as OFFLINE', async () => {
      // Arrange: Register device (starts ONLINE)
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Act: Mark offline
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Assert: Should be OFFLINE
      const offlineDevice = await deviceService.getDevice(device.deviceId);
      expect(offlineDevice!.status).toBe(DeviceStatus.OFFLINE);
    });
    
    it('should track downtime when going offline', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Wait to simulate some uptime
      await sleep(100);
      
      // Act: Mark offline
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Assert: Downtime should be tracked
      const offlineDevice = await deviceService.getDevice(device.deviceId);
      expect(offlineDevice!.totalDowntime).toBeGreaterThan(0);
    });
    
    it('should decrease reliability score when going offline', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      const originalScore = device.reliabilityScore;
      
      // Wait to simulate uptime
      await sleep(100);
      
      // Act: Mark offline
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Assert: Reliability should decrease
      const offlineDevice = await deviceService.getDevice(device.deviceId);
      expect(offlineDevice!.reliabilityScore).toBeLessThanOrEqual(originalScore);
    });
    
    it('should handle marking offline multiple times gracefully', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Act: Mark offline twice
      await deviceService.markDeviceOffline(device.deviceId);
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Assert: Should still be OFFLINE (no error)
      const offlineDevice = await deviceService.getDevice(device.deviceId);
      expect(offlineDevice!.status).toBe(DeviceStatus.OFFLINE);
    });
    
    it('should not throw error for non-existent device', async () => {
      // Act & Assert: Should not throw (just log warning)
      await expect(
        deviceService.markDeviceOffline('unknown-device')
      ).resolves.not.toThrow();
    });
  });
  
  // ========================================
  // HEALTH METRICS TESTS
  // ========================================
  
  describe('getDeviceHealth', () => {
    
    it('should calculate uptime percentage correctly', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Simulate some uptime and downtime manually
      await prisma.device.update({
        where: { id: device.id },
        data: {
          totalUptime: BigInt(TIME.HOURS(9)),  // 9 hours up
          totalDowntime: BigInt(TIME.HOURS(1)), // 1 hour down
        },
      });
      
      // Act: Get health
      const health = await deviceService.getDeviceHealth(device.deviceId);
      
      // Assert: 90% uptime (9 out of 10 hours)
      expect(health.uptimePercentage).toBeCloseTo(90, 1);
    });
    
    it('should show 100% uptime for new devices', async () => {
      // Arrange: Register fresh device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Act: Get health immediately
      const health = await deviceService.getDeviceHealth(device.deviceId);
      
      // Assert: New device has 100% uptime
      expect(health.uptimePercentage).toBe(100);
    });
    
    it('should track consecutive downtime when offline', async () => {
      // Arrange: Register and mark offline
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Wait to accumulate downtime
      await sleep(100);
      
      // Act: Get health
      const health = await deviceService.getDeviceHealth(device.deviceId);
      
      // Assert: Should have consecutive downtime
      expect(health.isOnline).toBe(false);
      expect(health.consecutiveDowntimeMs).toBeGreaterThan(0);
    });
    
    it('should show zero consecutive downtime when online', async () => {
      // Arrange: Register device (online)
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Act: Get health
      const health = await deviceService.getDeviceHealth(device.deviceId);
      
      // Assert: No consecutive downtime when online
      expect(health.isOnline).toBe(true);
      expect(health.consecutiveDowntimeMs).toBe(0);
    });
    
    it('should throw error for non-existent device', async () => {
      // Act & Assert
      await expect(
        deviceService.getDeviceHealth('unknown-device')
      ).rejects.toThrow('Device unknown-device not found');
    });
  });
  
  // ========================================
  // DEVICE SELECTION TESTS
  // ========================================
  
  describe('findHealthyDevices', () => {
    
    it('should find devices with sufficient storage and reliability', async () => {
      // Arrange: Create 5 devices with varying specs
      const devices = [
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) }),
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(20) }),
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(5) }),
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(15) }),
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(8) }),
      ];
      
      for (const payload of devices) {
        await deviceService.registerDevice(payload);
      }
      
      // Act: Find devices with at least 8GB available
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.GB(8),
        70,  // Min reliability
        10   // Limit
      );
      
      // Assert: Should find 4 devices (all except 5GB one)
      expect(healthy.length).toBe(4);
      healthy.forEach(d => {
        expect(d.availableStorageBytes).toBeGreaterThanOrEqual(STORAGE.GB(8));
        expect(d.reliabilityScore).toBeGreaterThanOrEqual(70);
        expect(d.status).toBe(DeviceStatus.ONLINE);
      });
    });
    
    it('should sort by reliability score (highest first)', async () => {
      // Arrange: Create devices with different reliability
      const device1 = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      const device2 = await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.GB(10) })
      );
      
      // Manually set different reliability scores
      await prisma.device.update({
        where: { id: device1.id },
        data: { reliabilityScore: 95 },
      });
      await prisma.device.update({
        where: { id: device2.id },
        data: { reliabilityScore: 85 },
      });
      
      // Act: Find healthy devices
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.MB(100),
        70,
        10
      );
      
      // Assert: Should be sorted by reliability (highest first)
      expect(healthy[0].reliabilityScore).toBeGreaterThanOrEqual(
        healthy[1].reliabilityScore
      );
    });
    
    it('should exclude offline devices', async () => {
      // Arrange: Create 3 devices, mark 1 offline
      const payloads = [
        createMockDevicePayload(),
        createMockDevicePayload(),
        createMockDevicePayload(),
      ];
      
      const devices = [];
      for (const payload of payloads) {
        devices.push(await deviceService.registerDevice(payload));
      }
      
      // Mark one offline
      await deviceService.markDeviceOffline(devices[1].deviceId);
      
      // Act: Find healthy devices
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.MB(100),
        70,
        10
      );
      
      // Assert: Should only find 2 (offline excluded)
      expect(healthy.length).toBe(2);
      expect(healthy.every(d => d.status === DeviceStatus.ONLINE)).toBe(true);
    });
    
    it('should respect limit parameter', async () => {
      // Arrange: Create 10 devices
      for (let i = 0; i < 10; i++) {
        await deviceService.registerDevice(createMockDevicePayload());
      }
      
      // Act: Request only 5
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.MB(100),
        70,
        5  // Limit to 5
      );
      
      // Assert: Should return exactly 5
      expect(healthy.length).toBe(5);
    });
    
    it('should return empty array when no devices meet criteria', async () => {
      // Arrange: Create device with low storage
      await deviceService.registerDevice(
        createMockDevicePayload({ totalStorageBytes: STORAGE.MB(100) })
      );
      
      // Act: Request devices with 10GB (none qualify)
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.GB(10),
        70,
        10
      );
      
      // Assert: Should return empty array
      expect(healthy).toEqual([]);
    });
  });
  
  // ========================================
  // DEVICE SUSPENSION TESTS
  // ========================================
  
  describe('suspendDevice', () => {
    
    it('should suspend device and mark as SUSPENDED', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Act: Suspend device
      await deviceService.suspendDevice(device.deviceId, 'User uninstalled app');
      
      // Assert: Should be SUSPENDED
      const suspendedDevice = await deviceService.getDevice(device.deviceId);
      expect(suspendedDevice!.status).toBe(DeviceStatus.SUSPENDED);
    });
    
    it('should track downtime when suspending online device', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Wait to simulate uptime
      await sleep(100);
      
      // Act: Suspend
      await deviceService.suspendDevice(device.deviceId);
      
      // Assert: Should have tracked downtime
      const suspendedDevice = await deviceService.getDevice(device.deviceId);
      expect(suspendedDevice!.totalDowntime).toBeGreaterThan(0);
    });
    
    it('should update reliability score when suspending', async () => {
      // Arrange: Register device
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      const originalScore = device.reliabilityScore;
      
      await sleep(100);
      
      // Act: Suspend
      await deviceService.suspendDevice(device.deviceId);
      
      // Assert: Reliability should decrease
      const suspendedDevice = await deviceService.getDevice(device.deviceId);
      expect(suspendedDevice!.reliabilityScore).toBeLessThanOrEqual(originalScore);
    });
    
    it('should throw error for non-existent device', async () => {
      // Act & Assert
      await expect(
        deviceService.suspendDevice('unknown-device')
      ).rejects.toThrow('Device unknown-device not found');
    });
  });
});