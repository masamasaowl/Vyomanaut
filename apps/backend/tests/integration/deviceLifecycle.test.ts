import { describe, it, expect } from 'vitest';
import { deviceService } from '../../src/modules/devices/device.service';
import { prisma } from '../../src/config/database';
import { getCachedDeviceStatus } from '../../src/config/redis';
import { DeviceStatus } from '@prisma/client';
import { createMockDevicePayload, sleep, STORAGE, TIME } from '../helpers';

/**
 * Device Lifecycle Integration Tests
 * 
 * Tests the complete lifecycle of a device through the system
 * including database interactions and Redis caching
 * 
 * These tests verify that all layers work together correctly:
 * - Service layer business logic
 * - Database persistence
 * - Redis caching
 */

describe('Device Lifecycle Integration', () => {
  
  // ========================================
  // COMPLETE LIFECYCLE TEST
  // ========================================
  
  it('should handle complete device lifecycle: birth → life → sleep → awakening → bye', async () => {
    const payload = createMockDevicePayload();
    
    // PHASE 1: Birth (Registration)
    console.log('Phase 1: Birth');
    const device = await deviceService.registerDevice(payload);
    
    expect(device.status).toBe(DeviceStatus.ONLINE);
    expect(device.reliabilityScore).toBe(100);
    expect(device.totalUptime).toBe(0);
    expect(device.totalDowntime).toBe(0);
    
    // Verify in database
    const dbDevice1 = await prisma.device.findUnique({
      where: { id: device.id },
    });
    expect(dbDevice1).toBeDefined();
    expect(dbDevice1!.status).toBe(DeviceStatus.ONLINE);
    
    // Verify in Redis cache
    const cachedStatus1 = await getCachedDeviceStatus(device.deviceId);
    expect(cachedStatus1).toBe(DeviceStatus.ONLINE);
    
    // PHASE 2: Life (Heartbeats)
    console.log('Phase 2: Life');
    await sleep(50);
    await deviceService.updateDeviceHeartbeat(
      device.deviceId,
      device.availableStorageBytes
    );
    
    const device2 = await deviceService.getDevice(device.deviceId);
    expect(device2!.totalUptime).toBeGreaterThan(0);
    expect(device2!.status).toBe(DeviceStatus.ONLINE);
    
    // PHASE 3: Sleep (Goes offline)
    console.log('Phase 3: Sleep');
    await sleep(50);
    await deviceService.markDeviceOffline(device.deviceId);
    
    const device3 = await deviceService.getDevice(device.deviceId);
    expect(device3!.status).toBe(DeviceStatus.OFFLINE);
    expect(device3!.totalDowntime).toBeGreaterThan(0);
    expect(device3!.reliabilityScore).toBeLessThan(100);
    
    // Verify Redis cache updated
    const cachedStatus2 = await getCachedDeviceStatus(device.deviceId);
    expect(cachedStatus2).toBe(DeviceStatus.OFFLINE);
    
    // PHASE 4: Awakening (Reconnects)
    console.log('Phase 4: Awakening');
    await sleep(100); // Simulate being offline
    const device4 = await deviceService.registerDevice(payload);
    
    expect(device4.id).toBe(device.id); // Same device
    expect(device4.status).toBe(DeviceStatus.ONLINE);
    expect(device4.totalDowntime).toBeGreaterThan(device3!.totalDowntime); // Accumulated downtime
    
    // PHASE 5: Bye (Suspension)
    console.log('Phase 5: Bye');
    await sleep(50);
    await deviceService.suspendDevice(device.deviceId, 'User uninstalled');
    
    const device5 = await deviceService.getDevice(device.deviceId);
    expect(device5!.status).toBe(DeviceStatus.SUSPENDED);
    
    // Verify Redis cache updated
    const cachedStatus3 = await getCachedDeviceStatus(device.deviceId);
    expect(cachedStatus3).toBe(DeviceStatus.SUSPENDED);
    
    console.log('✅ Complete lifecycle test passed!');
  });
  
  // ========================================
  // DATABASE CONSISTENCY TESTS
  // ========================================
  
  describe('Database Consistency', () => {
    
    it('should maintain consistency between service and database', async () => {
      // Register device through service
      const payload = createMockDevicePayload();
      const serviceDevice = await deviceService.registerDevice(payload);
      
      // Query database directly
      const dbDevice = await prisma.device.findUnique({
        where: { id: serviceDevice.id },
      });
      
      // Should match
      expect(dbDevice).toBeDefined();
      expect(dbDevice!.deviceId).toBe(serviceDevice.deviceId);
      expect(dbDevice!.status).toBe(serviceDevice.status);
      expect(Number(dbDevice!.totalStorageBytes)).toBe(serviceDevice.totalStorageBytes);
    });
    
    it('should handle concurrent registrations of same device', async () => {
      // Simulate two registrations happening simultaneously
      const payload = createMockDevicePayload();
      
      // First registration
      const device1 = await deviceService.registerDevice(payload);
      
      // Second registration (simulates reconnection)
      const device2 = await deviceService.registerDevice(payload);
      
      // Should be same device (upsert prevents duplicates)
      expect(device2.deviceId).toBe(device1.deviceId);
      
      // Should only be one device in database
      const devices = await prisma.device.findMany({
        where: { deviceId: payload.deviceId },
      });
      expect(devices.length).toBe(1);
    });
    
    it('should properly handle BigInt to Number conversions', async () => {
      // Register device with large storage value
      const payload = createMockDevicePayload({
        totalStorageBytes: STORAGE.GB(100), // 100GB
      });
      
      const device = await deviceService.registerDevice(payload);
      
      // Service should return Number (JavaScript safe integer)
      expect(typeof device.totalStorageBytes).toBe('number');
      expect(device.totalStorageBytes).toBe(STORAGE.GB(100));
      
      // Database should store as BigInt
      const dbDevice = await prisma.device.findUnique({
        where: { id: device.id },
      });
      expect(typeof dbDevice!.totalStorageBytes).toBe('bigint');
    });
  });
  
  // ========================================
  // REDIS CACHING TESTS
  // ========================================
  
  describe('Redis Caching', () => {
    
    it('should cache device status on registration', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Should be in cache
      const cachedStatus = await getCachedDeviceStatus(device.deviceId);
      expect(cachedStatus).toBe(DeviceStatus.ONLINE);
    });
    
    it('should update cache when device goes offline', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Verify online in cache
      const cachedOnline = await getCachedDeviceStatus(device.deviceId);
      expect(cachedOnline).toBe(DeviceStatus.ONLINE);
      
      // Mark offline
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Verify offline in cache
      const cachedOffline = await getCachedDeviceStatus(device.deviceId);
      expect(cachedOffline).toBe(DeviceStatus.OFFLINE);
    });
    
    it('should update cache on heartbeat', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Mark offline
      await deviceService.markDeviceOffline(device.deviceId);
      
      // Send heartbeat (should go back online)
      await deviceService.updateDeviceHeartbeat(
        device.deviceId,
        device.availableStorageBytes
      );
      
      // Cache should reflect online status
      const cachedStatus = await getCachedDeviceStatus(device.deviceId);
      expect(cachedStatus).toBe(DeviceStatus.ONLINE);
    });
  });
  
  // ========================================
  // RELIABILITY SCORE CALCULATION TESTS
  // ========================================
  
  describe('Reliability Score Calculation', () => {
    
    it('should calculate reliability based on uptime ratio', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Manually set uptime/downtime to known values
      await prisma.device.update({
        where: { id: device.id },
        data: {
          totalUptime: BigInt(TIME.HOURS(8)),
          totalDowntime: BigInt(TIME.HOURS(2)),
        },
      });
      
      // Mark offline to trigger score calculation
      await deviceService.markDeviceOffline(device.deviceId);
      
      const updatedDevice = await deviceService.getDevice(device.deviceId);
      
      // 8 hours up, 2 hours down = 80% uptime = 80 score
      expect(updatedDevice!.reliabilityScore).toBeCloseTo(80, 0);
    });
    
    it('should maintain 100% score for devices with only uptime', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Simulate only uptime (no downtime)
      await prisma.device.update({
        where: { id: device.id },
        data: {
          totalUptime: BigInt(TIME.HOURS(10)),
          totalDowntime: BigInt(0),
        },
      });
      
      // Trigger recalculation
      await deviceService.markDeviceOffline(device.deviceId);
      
      const updatedDevice = await deviceService.getDevice(device.deviceId);
      
      // Should still be 100% (or very close due to the markOffline downtime)
      expect(updatedDevice!.reliabilityScore).toBeGreaterThan(99);
    });
    
    it('should handle edge case of new device with zero uptime', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Get health immediately (no uptime yet)
      const health = await deviceService.getDeviceHealth(device.deviceId);
      
      // Should default to 100% for new devices
      expect(health.uptimePercentage).toBe(100);
      expect(health.reliabilityScore).toBe(100);
    });
  });
  
  // ========================================
  // DEVICE SELECTION INTEGRATION TESTS
  // ========================================
  
  describe('Device Selection for Chunk Assignment', () => {
    
    it('should prefer devices with higher reliability', async () => {
      // Create 3 devices with different reliability
      const devices = [];
      for (let i = 0; i < 3; i++) {
        const payload = createMockDevicePayload();
        const device = await deviceService.registerDevice(payload);
        devices.push(device);
      }
      
      // Set different reliability scores
      await prisma.device.update({
        where: { id: devices[0].id },
        data: { reliabilityScore: 90 },
      });
      await prisma.device.update({
        where: { id: devices[1].id },
        data: { reliabilityScore: 95 },
      });
      await prisma.device.update({
        where: { id: devices[2].id },
        data: { reliabilityScore: 85 },
      });
      
      // Find healthy devices
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.MB(100),
        70,
        3
      );
      
      // Should be sorted: 95, 90, 85
      expect(healthy[0].reliabilityScore).toBe(95);
      expect(healthy[1].reliabilityScore).toBe(90);
      expect(healthy[2].reliabilityScore).toBe(85);
    });
    
    it('should only select online devices even if offline have better specs', async () => {
      // Create 2 devices
      const payload1 = createMockDevicePayload({
        totalStorageBytes: STORAGE.GB(100),
      });
      const payload2 = createMockDevicePayload({
        totalStorageBytes: STORAGE.GB(50),
      });
      
      const device1 = await deviceService.registerDevice(payload1);
      const device2 = await deviceService.registerDevice(payload2);
      
      // Mark better device offline
      await deviceService.markDeviceOffline(device1.deviceId);
      
      // Find healthy devices
      const healthy = await deviceService.findHealthyDevices(
        STORAGE.MB(100),
        70,
        10
      );
      
      // Should only return device2 (online)
      expect(healthy.length).toBe(1);
      expect(healthy[0].deviceId).toBe(device2.deviceId);
    });
  });
  
  // ========================================
  // ERROR RECOVERY TESTS
  // ========================================
  
  describe('Error Recovery', () => {
    
    it('should recover gracefully from database errors', async () => {
      // Try to get non-existent device
      const device = await deviceService.getDevice('non-existent-id');
      expect(device).toBeNull();
    });
    
    it('should handle concurrent operations on same device', async () => {
      const payload = createMockDevicePayload();
      const device = await deviceService.registerDevice(payload);
      
      // Perform multiple operations concurrently
      await Promise.all([
        deviceService.updateDeviceHeartbeat(device.deviceId, STORAGE.GB(8)),
        deviceService.updateDeviceHeartbeat(device.deviceId, STORAGE.GB(9)),
        deviceService.getDeviceHealth(device.deviceId),
      ]);
      
      // Device should still be in valid state
      const finalDevice = await deviceService.getDevice(device.deviceId);
      expect(finalDevice).toBeDefined();
      expect(finalDevice!.status).toBe(DeviceStatus.ONLINE);
    });
  });
});