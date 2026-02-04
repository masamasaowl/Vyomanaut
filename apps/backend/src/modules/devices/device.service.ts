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
// 1. Register a new device
// ========================================

  /**
   * Called by:
   *   - POST /api/v1/devices/register  (first-time REST registration)
   *   - device.manager.ts              (WebSocket re-registration after reconnect)
   *
   * Algorithm:
   *   - Single prisma.upsert keyed on the unique `deviceId` column.
   *   - On UPDATE we only recompute reliability when the device was previously OFFLINE
   *   - BigInt conversion happens once at the boundary
   *
   * @param payload  Validated registration payload (from controller or manager)
   * @returns        Converted DeviceData ready for JSON responses
   */
  async registerDevice(payload: DeviceRegistrationPayload): Promise<DeviceData> {
    // from device.types.ts
    const {
      deviceId,
      deviceType,
      userId,
      totalStorageBytes,
    } = payload;

    // When your device registers 
    if (totalStorageBytes < 1 * 1024 * 1024 * 1024) {
      throw new Error('Device must offer at least 1GB of storage');
    }

    // We check if the device was already registered
    const existing = await prisma.device.findUnique({
      where: { deviceId },
    });

    // offline check
    const wasOffline = existing?.status === DeviceStatus.OFFLINE;

    // If device was offline, calculate how long to increase downtime 
    let additionalDowntime = BigInt(0);

    // If device was offline
    if (wasOffline && existing) {
      const now = new Date();
      const downSince = existing.lastSeenAt;

      // calculate downtime using last seen
      additionalDowntime = BigInt(now.getTime() - downSince.getTime());
    }

    // Upsert -> update or insert new
    const device = await prisma.device.upsert({

      // Try to find existing device
      where: { deviceId },
      
      // If found then update it's data 
      update: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        totalStorageBytes: BigInt(totalStorageBytes),
        availableStorageBytes: BigInt(totalStorageBytes),
        
        ...(wasOffline && existing
          ? {
              totalDowntime: existing.totalDowntime + additionalDowntime,
              reliabilityScore: this.calculateReliabilityScore(
                existing.totalUptime,
                existing.totalDowntime + additionalDowntime,
              ),
            }
          : {}),
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
    } else if (existing) {
      console.log(`🔄 Device reconnected: ${deviceId}`);
    } else {
      console.log(`👶 New device born: ${deviceId}`);
    }

    // this conversion is explained down below
    return this.convertToDeviceData(device);
  }


  // ========================================
  // 2. Flush Heartbeats
  // ========================================

  /**
   * This works together with the websocket/device.manager.ts
   * It is called to flush the last known state to DB while the manager stores the ping in Redis
   *  
   * Flow:
   * 1. Called by the manager in a set duration
   * 2. Calculates the uptime 
   * 3. Writes to the DB
   */
  async flushHeartbeatToDB(
    deviceId: string,
    availableStorageBytes: number
  ): Promise<void> {

    // Check that device
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // Things we need to update
    const now = new Date();
    // Update the uptime 
    const uptimeDelta = BigInt(now.getTime() - device.lastSeenAt.getTime());


    // Update device in DB
    await prisma.device.update({
      where: { deviceId },
      data: {
        lastSeenAt: now,
        availableStorageBytes: BigInt(availableStorageBytes),
        status: DeviceStatus.ONLINE,
        totalUptime: device.totalUptime + uptimeDelta,
      },
    });
  }


  // ========================================
  // 3. Mark Offline
  // ========================================

  /**
   * Called by device.manager on WebSocket disconnect
   * 
   * Triggers async health-check for chunks on this device.
   *
   * @param deviceId  device identifier
   */
  async markDeviceOffline(deviceId: string): Promise<void> {

    // Who was it
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      console.warn(`⚠️ Tried to mark unknown device offline: ${deviceId}`);
      return;
    }

    // Current state in DB -> Device is ONLINE
    // Only act if the device is actually transitioning from ONLINE
    if (device.status !== DeviceStatus.ONLINE) {
      console.log(`  ℹ️  Device ${deviceId} already ${device.status}, skipping`);
      return;
    }

    // We calculate the uptime before signing you off
    const now = new Date();
    const uptimeDelta = BigInt(now.getTime() - device.lastSeenAt.getTime());


    // Update the device going to sleep in DB
    await prisma.device.update({
      where: { deviceId },
      data: {
        status: DeviceStatus.OFFLINE,
        lastSeenAt: now,
        totalUptime: device.totalUptime + uptimeDelta,   // credit uptime up to disconnect
        totalDowntime: device.totalDowntime,
        reliabilityScore: this.calculateReliabilityScore(
          device.totalUptime + uptimeDelta,
          device.totalDowntime,
        ),
      },
    });

    // Update cache
    await cacheDeviceStatus(deviceId, DeviceStatus.OFFLINE);

    console.log(`😴 Device went offline: ${deviceId}`);


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


  // ========================================
  // 4. Suspend Device
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
   * - Can only be reactivated by re-registering
   * 
   * @param deviceId  Unique device identifier
   * @param reason    Human-readable suspension reason (logged only)
   */
  async suspendDevice(deviceId: string, reason?: string): Promise<void> {

    // Who is leaving today
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

  
    // Calculate the final updates
    const now = new Date();
    let additionalDowntime = BigInt(0);
    
    // By default device might be set to online in our DB
    if (device.status === DeviceStatus.ONLINE) {
      additionalDowntime = BigInt(now.getTime() - device.lastSeenAt.getTime());
    }

    // Your final downtime
    const finalDowntime = device.totalDowntime + additionalDowntime;

    // It's a goodbye my friend
    await prisma.device.update({
      where: { id: device.id },
      data: {
        status: DeviceStatus.SUSPENDED,
        lastSeenAt: now,
        totalDowntime: finalDowntime,
        reliabilityScore: this.calculateReliabilityScore(
          device.totalUptime,
          finalDowntime,
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
   * brand-new device has 0/0 → returns 100
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
   * We only read into DB
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
  // 8. Get Device from DB (Read only)
  // ========================================

  async getDevice(deviceId: string): Promise<DeviceData | null> {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    return device ? this.convertToDeviceData(device) : null;
  }


  // ========================================
  // 9. List device with filters (Read only)
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