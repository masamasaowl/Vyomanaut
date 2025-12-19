import { prisma } from '../../config/database';
import { 
  cacheDeviceStatus, 
  updateDeviceLastSeen 
} from '../../config/redis';
import { DeviceStatus } from '@prisma/client';
import {
  DeviceRegistrationPayload,
  DeviceData,
  DeviceSummary,
  DeviceHealth,
  DeviceQueryFilters,
} from '../../types/device.types';
import { healthMonitoringService } from '../replication/health.service';


/**
 * THE DEVICE LIFECYCLE 
 * A fun analogy 
 * Birth 👶 - Device registers ("Hey, I'm Device123, I have 10GB to share!")
 * Life 💓 - Device stays connected, pings every 60s ("I'm still here!")
 * Sleep 😴 - Device goes offline (loses connection) 
 * Awakening 🌅 - Device reconnects (we need to update its status) 
 * Bye 👋 - Device uninstalls app (we mark it suspended)
 * 
 */


/**
 * Device Service ( Our MasterChef )
 * 
 * This handles ALL device-related business logic
 * Think of it as the "Chef" of Vyomanaut
 * 
 * Responsibilities:
 * 1. Register new devices
 * 2. Handle Pings
 * 3. Mark as offline
 * 4. Suspend device 
 * 5. Calculate reliability scores
 * 6. Do a health check
 * 7. Find all healthy devices
 * 8. Get a device (quick)
 * 9. Look for that perfect device to store the chunk
 * 10. BigInt conversion (to store GBs etc. info)
 */

class DeviceService {

// ========================================
// 1. 👶 Register a new device
// ========================================

  /**
   * Flow:
   * 1. Check if device already exists (by deviceId)
   * 2. If exists -> update its info and mark ONLINE
   * 3. If new -> create new record
   * 4. Cache the status in Redis for fast lookups
   */
  async registerDevice(payload: DeviceRegistrationPayload): Promise<DeviceData> {

    // from device.types.ts
    const {
      deviceId,
      deviceType,
      userId,
      totalStorageBytes,
    } = payload;

    // If device was offline, calculate how long was it used during reconnecting (🌅 Awakening)
    // look for device
    const existingDevice = await prisma.device.findUnique({
      where: { deviceId },
    });

    // offline check
    const wasOffline = existingDevice?.status === DeviceStatus.OFFLINE;

    // If device was offline, calculate how long (for 🌅 Awakening)
    // add to downtime 
    let additionalDowntime = BigInt(0);

    // If device was offline
    if (wasOffline && existingDevice) {
      const now = new Date();
      const downSince = existingDevice.lastSeenAt;

      // calculate downtime using last seen
      additionalDowntime = BigInt(now.getTime() - downSince.getTime());
    }

    // upsert -> update or insert new
    const device = await prisma.device.upsert({

      // Try to find existing device
      where: { deviceId },
      
      // If found then update it's data 
      update: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        totalStorageBytes: BigInt(totalStorageBytes),
        availableStorageBytes: BigInt(totalStorageBytes),
        
        // 🌅 AWAKENING: Add downtime since it went offline
        totalDowntime: wasOffline && existingDevice
          ? existingDevice.totalDowntime + additionalDowntime
          : undefined,
        
        // Reliability score would change when he comes back again
        reliabilityScore: wasOffline && existingDevice
          ? this.calculateReliabilityScore(

              // this function is will return just that
              existingDevice.totalUptime,
              existingDevice.totalDowntime + additionalDowntime
            )
          : undefined,
      },
      
      // If not found
      // Brand new device! Welcome aboard
      create: {
        deviceId,
        deviceType,
        userId,
        totalStorageBytes: BigInt(totalStorageBytes),
        availableStorageBytes: BigInt(totalStorageBytes),
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        // Start with perfect score
        reliabilityScore: 100.0,
        totalUptime: BigInt(0),
        totalDowntime: BigInt(0),
        totalEarnings: 0,
      },
    });

    // A lovely tweak
    // Cache the status in Redis for fast lookups
    await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);

    // Update sorted set of online devices
    // from redis.ts
    await updateDeviceLastSeen(deviceId);

    // helper logs
    if (wasOffline) {
      console.log(`🌅 Device awakened: ${deviceId} (was offline for ${(Number(additionalDowntime) / 1000 / 60).toFixed(2)} minutes)`);
    } else if (existingDevice) {
      console.log(`🔄 Device reconnected: ${deviceId}`);
    } else {
      console.log(`👶 New device born: ${deviceId}`);
    }

    // this conversion is explained down below
    return this.convertToDeviceData(device);
  }



  // ========================================
  // 2. 💓 LIFE - Handle Heartbeats
  // ========================================

  /**
   * Update device's heartbeat (called every 60 seconds)
   * -> it's how we know device is alive!
   * 
   * Flow:
   * 1. Update lastSeenAt timestamp
   * 2. Update availableStorageBytes (might have changed)
   * 3. Update Redis cache
   * 4. Calculate uptime since last ping
   */
  async updateDeviceHeartbeat(
    deviceId: string,
    availableStorageBytes: number
  ): Promise<void> {

    // Check that device! Yo! (you know his ID)
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // Things we need to update
    const now = new Date();
    const lastSeen = device.lastSeenAt;
    // Check the time gap
    const timeSinceLastSeen = now.getTime() - lastSeen.getTime();


    // Update device in DB
    await prisma.device.update({
      where: { deviceId },
      data: {
        lastSeenAt: now,
        availableStorageBytes: BigInt(availableStorageBytes),
        status: DeviceStatus.ONLINE,
        
        // Add to uptime (device was alive during this period)
        totalUptime: device.totalUptime + BigInt(timeSinceLastSeen),
      },
    });

    // Update cache
    await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);
    await updateDeviceLastSeen(deviceId);
  }


  // ========================================
  // 3. 😴 SLEEP - Mark Offline
  // ========================================

  /**
   * Called when:
   * - Device disconnects from WebSocket
   * - Device hasn't pinged in 90+ seconds (detected by background worker)
   * 
   * Important: We DON'T immediately remove chunks!
   * Device might come back online soon (phone locked screen, network hiccup)
   */
  async markDeviceOffline(deviceId: string): Promise<void> {

    // Who are you
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      console.warn(`⚠️ Tried to mark unknown device offline: ${deviceId}`);
      return;
    }

    // Update DB if device comes back online 
    // Why? 
    // We don't bother if you were offline but whenever you make a return 
    // we update your status, reliability score & total downtime 
    if (device.status === DeviceStatus.ONLINE) {
      const now = new Date();
      const lastSeen = device.lastSeenAt;
      const timeSinceLastSeen = now.getTime() - lastSeen.getTime();

      // Add to downtime using last seen
      const newTotalDowntime = device.totalDowntime + BigInt(timeSinceLastSeen);

      // Update device with new reliability score & downtime 
      await prisma.device.update({
        where: { deviceId },
        data: {

          // You'll be considered online only in the next ping☺️
          status: DeviceStatus.OFFLINE,
          lastSeenAt: now,
          totalDowntime: newTotalDowntime,
          
          // Recalculate reliability score
          reliabilityScore: this.calculateReliabilityScore(
            device.totalUptime,
            newTotalDowntime
          ),
        },
      });

      // Update cache
      await cacheDeviceStatus(deviceId, DeviceStatus.OFFLINE);

      console.log(`😴 Device fell asleep: ${deviceId}`);


      // TRIGGER HEALTH CHECK!
      // When device goes offline, check which chunks are affected
      // and queue healing jobs if needed
      setImmediate(async () => {
        try {
          await healthMonitoringService.detectAffectedChunks(device.id);
        } catch (error) {
          console.error(`❌ Failed to detect affected chunks for ${deviceId}:`, error);
        }
      });
    }
  }


  // ========================================
  // 4. 👋 BYE - Suspend Device (New!)
  // ========================================

  /**
   * Suspend a device permanently
   * 
   * Called when:
   * - User uninstalls app
   * - User manually disables earning
   * - Admin suspends device for violations
   * 
   * Suspended devices:
   * - Won't receive new chunk assignments
   * - Existing chunks are re-replicated to other devices
   * - Can be reactivated by re-registering
   */
  async suspendDevice(deviceId: string, reason?: string): Promise<void> {

    // Who is leaving today
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // If device was online, track the downtime
    // calculate the final updates
    const now = new Date();
    let additionalDowntime = BigInt(0);
    
    if (device.status === DeviceStatus.ONLINE) {
      const lastSeen = device.lastSeenAt;
      additionalDowntime = BigInt(now.getTime() - lastSeen.getTime());
    }

    // It's a goodbye my friend
    await prisma.device.update({
      where: { id: device.id }, // FIX: Use id, not deviceId
      data: {
        // 👋 BYE
        status: DeviceStatus.SUSPENDED,
        lastSeenAt: now,
        totalDowntime: device.totalDowntime + additionalDowntime,
        
        // Update reliability
        reliabilityScore: this.calculateReliabilityScore(
          device.totalUptime,
          device.totalDowntime + additionalDowntime
        ),
      },
    });

    // Update cache
    await cacheDeviceStatus(deviceId, DeviceStatus.SUSPENDED);


    // Now let's run healing tasks for all the chunks you had
    setImmediate(async () => {
      try {
        await healthMonitoringService.detectAffectedChunks(device.id);
      } catch (error) {
        console.error(`❌ Failed to detect affected chunks for ${deviceId}:`, error);
      }
    });

    // The reason is important to us 
    console.log(`👋 Device suspended: ${deviceId}${reason ? ` (Reason: ${reason})` : ''}`);
  }


  // ========================================
  // 5. 📊 Reliability Score Calculator
  // ========================================

  /**
   * Calculate reliability score based on uptime/downtime
   * 
   * Formula:
   * - Base score = (uptime / total_time) * 100
   * - Clamped between 0 and 100
   * 
   * Examples:
   * - 95% uptime = 95 score
   * - 80% uptime = 80 score
   * - 50% uptime = 50 score
   * 
   * Note -> Score affects chunk assignment priority!
   */

  private calculateReliabilityScore(
    totalUptime: bigint,
    totalDowntime: bigint
  ): number {

    // How long have you been with us
    const totalTime = Number(totalUptime + totalDowntime);
    
    if (totalTime === 0) {
      return 100.0; // New device, perfect score
    }

    // How long were you On
    const uptimePercentage = (Number(totalUptime) / totalTime) * 100;
    

    // Score is simply uptime percentage
    // Clamp between 0 and 100
    return Math.max(0, Math.min(100, Math.round(uptimePercentage * 100) / 100));
  }


  // ========================================
  // 6. Health Check
  // ========================================
  /**
   * Calculate device health metrics
   * 
   * This determines if device is reliable enough to store chunks
   * 
   * Factors:
   * - Current online/offline status
   * - Uptime percentage (higher = better)
   * - Reliability score (0-100, decreases with downtime)
   * - How long it's been offline (if offline)
   */

  async getDeviceHealth(deviceId: string): Promise<DeviceHealth> {

    // Check a particular device
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // total time
    const totalTime = Number(device.totalUptime + device.totalDowntime);

    const uptimePercentage = totalTime > 0 
      ? (Number(device.totalUptime) / totalTime) * 100 
      : 100; // New devices start at 100%


    const now = new Date();

    // Are you down? For how long has it been so
    const consecutiveDowntimeMs = device.status === DeviceStatus.OFFLINE
      ? now.getTime() - device.lastSeenAt.getTime()
      : 0;

    return {
      deviceId: device.deviceId,
      isOnline: device.status === DeviceStatus.ONLINE,
      reliabilityScore: device.reliabilityScore,
      uptimePercentage,
      consecutiveDowntimeMs,
      lastSeenAt: device.lastSeenAt,
    };
  }


  // ========================================
  // 7. Find Healthy Devices
  // ========================================
  /**
   * Find healthy devices for chunk storage
   * 
   * This is used when we need to assign chunks to devices
   * 
   * Criteria:
   * - Status = ONLINE
   * - Reliability score >= threshold (default 70)
   * - Has available storage
   * - Sorted by reliability (best first)
   */

  async findHealthyDevices(
    minAvailableStorageBytes: number,
    minReliabilityScore: number = 70,
    limit: number = 10
  ): Promise<DeviceSummary[]> {

    // look for all healthy devices in DB
    const devices = await prisma.device.findMany({
      where: {
        status: DeviceStatus.ONLINE,
        reliabilityScore: { gte: minReliabilityScore },
        availableStorageBytes: { gte: BigInt(minAvailableStorageBytes) },
      },
      orderBy: [
        { reliabilityScore: 'desc' },
        { availableStorageBytes: 'desc' },
      ],
      take: limit,

      // make sure it's online right now
      select: {
        id: true,
        deviceId: true,
        status: true,
        availableStorageBytes: true,
        reliabilityScore: true,
        lastSeenAt: true,
      },
    });

    // return 'em all
    return devices.map(d => ({
      ...d,
      availableStorageBytes: Number(d.availableStorageBytes),
    }));
  }

  // ========================================
  // 8. Get Device
  // ========================================

  async getDevice(deviceId: string): Promise<DeviceData | null> {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    return device ? this.convertToDeviceData(device) : null;
  }


  // ========================================
  // 9. To find those few perfect devices
  // ========================================

  async listDevices(filters: DeviceQueryFilters = {}): Promise<DeviceSummary[]> {

    // find them
    const devices = await prisma.device.findMany({
      where: {

        // the filters 
        status: filters.status,
        reliabilityScore: filters.minReliabilityScore 
          ? { gte: filters.minReliabilityScore } 
          : undefined,
        availableStorageBytes: filters.minAvailableStorage 
          ? { gte: BigInt(filters.minAvailableStorage) } 
          : undefined,
        userId: filters.userId,
      },
      orderBy: { lastSeenAt: 'desc' },

      // Are they online right now?
      select: {
        id: true,
        deviceId: true,
        status: true,
        availableStorageBytes: true,
        reliabilityScore: true,
        lastSeenAt: true,
      },
    });

    return devices.map(d => ({
      ...d,
      availableStorageBytes: Number(d.availableStorageBytes),
    }));
  }


  // ========================================
  // 10. Helper - BigInt Conversion
  // ========================================
  /**
   * Convert Prisma's BigInt to regular numbers for JSON
   * (JSON.stringify can't handle BigInt)
   */
  private convertToDeviceData(device: any): DeviceData {
    return {
      ...device,
      totalStorageBytes: Number(device.totalStorageBytes),
      availableStorageBytes: Number(device.availableStorageBytes),
      totalUptime: Number(device.totalUptime),
      totalDowntime: Number(device.totalDowntime),
      totalEarnings: Number(device.totalEarnings),
    };
  }
}

// Export singleton instance
export const deviceService = new DeviceService();