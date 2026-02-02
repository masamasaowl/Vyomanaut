import { Socket } from 'socket.io';
import { prisma } from '../config/database';
import { cacheDeviceStatus, updateDeviceLastSeen } from '../config/redis';
import { DeviceStatus } from '@prisma/client';
import { healthMonitoringService } from '../modules/replication/health.service';


interface SocketDeviceMap {
  // The Websocket ID which changes on every reconnect ( never persists )  
  socketId: string;
  // The stable ID of the device 
  deviceId: string;
  // Owner of the device 
  userId: string;
  // connection stats 
  connectedAt: Date;
  lastSeenAt: Date;
}


/**
 * WebSocket Device Manager
 * 
 * Central hub for managing device WebSocket connections
 * 
 * Responsibilities:
 * 1. Register new device 
 * 2. Respond to a ping from a device
 * 3. 
 */
class WebSocketDeviceManager {
  
  // Link socketId → deviceId, userId, connectedAt & lastSeenAt
  // This is done using Maps for O(1) lookup of device info just from the socketID
  private socketToDevice: Map<string, SocketDeviceMap> = new Map();
  
  // Link deviceId → socketId
  // This is used for reverse lookup
  private deviceToSocket: Map<string, string> = new Map();
  

  // ========================================
  // DEVICE REGISTRATION
  // ========================================
  
  /**
   * Register a device via WebSocket
   * 
   * This is called when device emits 'device:register' event
   * 
   * Flow:
   * 1. Validate payload
   * 2. Create/Update device in database
   * 3. Map socket to device
   * 4. Update status to ONLINE
   * 5. Cache in Redis
   * 
   * @param socket Our websocket 
   * @param payload Contains the incoming device info from frontend 
   * @returns success boolean, device info and message 
   */
  async registerDevice(
    socket: Socket,
    payload: {
      deviceId: string;
      userId: string;
      deviceType: 'ANDROID' | 'IOS' | 'DESKTOP' | 'MACOS' | 'LINUX';
      totalStorageBytes: number;
      model?: string;
      osVersion?: string;
      appVersion?: string;
    }
  ): Promise<{
    success: boolean;
    device?: any;
    message: string;
  }> {
    
    try {
      console.log(`📱 Registering device ${payload.deviceId} via WebSocket...`);
      
      // 1. Validate payload
      // We check the four mandatory fields
      const validation = this.validateRegistration(payload);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.error!
        };
      }
      
      // 2. Check if device already exists
      const existingDevice = await prisma.device.findUnique({
        where: { deviceId: payload.deviceId }
      });
      
      // 3. Calculate downtime if device was offline
      // As the device pinged again so it might have gone offline
      let additionalDowntime = BigInt(0);

      // If the device is registered in DB and was only offline
      if (existingDevice && existingDevice.status === DeviceStatus.OFFLINE) {

        // Calculate downtime
        const now = new Date();
        const downSince = existingDevice.lastSeenAt;
        // Add to downtime
        additionalDowntime = BigInt(now.getTime() - downSince.getTime());
        
        console.log(`  🌅 Device was offline for ${(Number(additionalDowntime) / 1000 / 60).toFixed(2)} minutes`);
      }
      

      // 4. Create or update device in DB
      const device = await prisma.device.upsert({
        where: { deviceId: payload.deviceId },

        // If device came back online we do two things
        update: {
          status: DeviceStatus.ONLINE,
          lastSeenAt: new Date(),
          totalStorageBytes: BigInt(payload.totalStorageBytes),
          availableStorageBytes: BigInt(payload.totalStorageBytes),
          
          // i. Update downtime if was offline
          totalDowntime: existingDevice && existingDevice.status === DeviceStatus.OFFLINE
            ? existingDevice.totalDowntime + additionalDowntime
            : undefined,
          
          // ii. Recalculate reliability if was offline
          reliabilityScore: existingDevice && existingDevice.status === DeviceStatus.OFFLINE
            ? this.calculateReliabilityScore(
                existingDevice.totalUptime,
                existingDevice.totalDowntime + additionalDowntime
              )
            : undefined,
        },

        // If new device came then create it's record
        create: {
          deviceId: payload.deviceId,
          deviceType: payload.deviceType,
          userId: payload.userId,
          totalStorageBytes: BigInt(payload.totalStorageBytes),
          availableStorageBytes: BigInt(payload.totalStorageBytes),
          status: DeviceStatus.ONLINE,
          lastSeenAt: new Date(),
          reliabilityScore: 100.0,
          totalUptime: BigInt(0),
          totalDowntime: BigInt(0),
          totalEarnings: 0,
        }
      });
      

      // Map socket to device
      // This is where we link the device details the moment it connects to us via socketID
      this.mapSocketToDevice(socket, payload.deviceId, payload.userId);
      

      // Cache in Redis
      // Super important for quick lookups from RAM
      await cacheDeviceStatus(payload.deviceId, DeviceStatus.ONLINE);
      await updateDeviceLastSeen(payload.deviceId);
      

      // Store deviceId & userID in socket metadata
      // By this the connected socket could be easily extracted with these data  
      socket.data.deviceId = payload.deviceId;
      socket.data.userId = payload.userId;
      
      console.log(`  ✅ Device ${payload.deviceId} registered successfully`);
      
      return {
        success: true,
        device: {
          id: device.id,
          deviceId: device.deviceId,
          status: device.status,
          reliabilityScore: device.reliabilityScore,
          totalEarnings: device.totalEarnings.toString(),
        },
        message: existingDevice 
          ? 'Device reconnected successfully!' 
          : 'Device registered successfully!'
      };
      
    } catch (error) {
      console.error(`❌ Error registering device:`, error);
      return {
        success: false,
        message: 'Failed to register device. Please try again.'
      };
    }
  }
  

  // ========================================
  // HEARTBEAT HANDLING
  // ========================================
  
  
  /**
   * Handle device ping
   * Update: 
   * 1. lastSeenAt
   * 2. availableStorage
   * 3. uptime
   * 
   * @param socket our Websocket 
   * @param payload Has the deviceId and storage
   * @returns success boolean of heartbeat
   */
  async handleHeartbeat(
    socket: Socket,
    payload: {
      deviceId: string;
      availableStorageBytes: number;
    }
  ): Promise<{
    success: boolean;
    status: DeviceStatus;
    timestamp: number;
  }> {
    
    try {

      // Device sends heartbeat -> means it's online and connected to socket
      // We extract the data from this ID
      const mapping = this.socketToDevice.get(socket.id);
      
      // If device couldn't be mapped then it's strange 
      if (!mapping) {
        console.warn(`⚠️ Heartbeat from unregistered socket ${socket.id}`);
        return {
          success: false,
          status: DeviceStatus.OFFLINE,
          timestamp: Date.now()
        };
      }

      if(mapping.deviceId != payload.deviceId){
        console.error(`Stored deviceID and ping deviceID don't match`);
      }
      
      // 1. Update last seen in map
      mapping.lastSeenAt = new Date();
      
      // Get device from DB through deviceID
      const device = await prisma.device.findUnique({
        where: { deviceId: payload.deviceId }
      });
      
      if (!device) {
        return {
          success: false,
          status: DeviceStatus.OFFLINE,
          timestamp: Date.now()
        };
      }
      
      // Calculate time since last update
      const now = new Date();
      const lastSeen = device.lastSeenAt;
      const timeSinceLastSeen = now.getTime() - lastSeen.getTime();
      

      // 2. Update device values 
      await prisma.device.update({
        where: { deviceId: payload.deviceId },
        data: {
          lastSeenAt: now,
          availableStorageBytes: BigInt(payload.availableStorageBytes),
          status: DeviceStatus.ONLINE,
          totalUptime: device.totalUptime + BigInt(timeSinceLastSeen),
        }
      });
      

      // 3. Update Redis cache
      await cacheDeviceStatus(payload.deviceId, DeviceStatus.ONLINE);
      await updateDeviceLastSeen(payload.deviceId);
      
      return {
        success: true,
        status: DeviceStatus.ONLINE,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error(`❌ Error handling heartbeat:`, error);
      return {
        success: false,
        status: DeviceStatus.OFFLINE,
        timestamp: Date.now()
      };
    }
  }
  

  // ========================================
  // DISCONNECTION HANDLING
  // ========================================
  
  /**
   * Handle device disconnection
   * 
   * Called when socket disconnects
   * Basically we mark it offline
   * We
   * 1. Mark device offline (in DB and cache)
   * 2. Delete the device socket map
   * 3. Send chunks for redistribution
   * 
   * @param socket 
   * @param reason the reason why a device disconnected
   * @returns 
   */
  async handleDisconnection(socket: Socket, reason: string): Promise<void> {
    try {
      // It must be online while getting disconnected so fetch values at that time
      const mapping = this.socketToDevice.get(socket.id);
      
      if (!mapping) {
        console.log(`🔌 Unknown socket disconnected: ${socket.id}`);
        return;
      }
      
      console.log(`📴 Device ${mapping.deviceId} disconnected (Reason: ${reason})`);
      
      // Get device from DB based on deviceID
      const device = await prisma.device.findUnique({
        where: { deviceId: mapping.deviceId }
      });
      
      if (!device) {
        console.warn(`⚠️ Device ${mapping.deviceId} not found in database`);
        return;
      }
      
      // Calculate uptime since last update
      const now = new Date();
      const lastSeen = device.lastSeenAt;
      const timeSinceLastSeen = now.getTime() - lastSeen.getTime();
      
      // Update device to OFFLINE
      await prisma.device.update({
        where: { deviceId: mapping.deviceId },
        data: {
          status: DeviceStatus.OFFLINE,
          lastSeenAt: now,
          totalUptime: device.totalUptime + BigInt(timeSinceLastSeen),
        }
      });
      
      // Update Redis cache
      // We store the mapping deviceID as no payload is given to us 
      await cacheDeviceStatus(mapping.deviceId, DeviceStatus.OFFLINE);
      
      // Remove from maps
      // A new map would be created when it would reconnect
      this.socketToDevice.delete(socket.id);
      this.deviceToSocket.delete(mapping.deviceId);
      
      console.log(`  ✅ Device ${mapping.deviceId} marked as OFFLINE`);
      

      // Redistribute the chunks of the device that went offline
      // We call our background worker there to handle the task
      setImmediate(async () => {
        try {
          // Call chunk health service
          await healthMonitoringService.
          detectAffectedChunks(device.id);
        } catch (error) {
          console.error(`❌ Failed to detect affected chunks:`, error);
        }
      });
      
    } catch (error) {
      console.error(`❌ Error handling disconnection:`, error);
    }
  }
  


  // ========================================
  // SOCKET-DEVICE MAPPING ( HELPERS )
  // ========================================
  
  /**
   * It implements our new Map functionality for fast lookups inside this service
   * It is called as when device registers
   * 
   * @param socket 
   * @param deviceId 
   * @param userId 
   */
  private mapSocketToDevice(
    socket: Socket,
    deviceId: string,
    userId: string
  ): void {
    
    // Create the map
    const mapping: SocketDeviceMap = {
      socketId: socket.id,
      deviceId,
      userId,
      connectedAt: new Date(),
      lastSeenAt: new Date(),
    };
    
    this.socketToDevice.set(socket.id, mapping);
    this.deviceToSocket.set(deviceId, socket.id);
    
    console.log(`  🔗 Mapped socket ${socket.id} → device ${deviceId}`);
  }
  

  /**
   * Get device ID from socket
   */
  getDeviceIdFromSocket(socket: Socket): string | undefined {

    // The socket ID is available with all upon initialization
    // We simply hand over the deviceID that references this socket
    const mapping = this.socketToDevice.get(socket.id);
    return mapping?.deviceId;
  }
  
  /**
   * Get socket from device ID
   * It's the vice-versa
   */
  getSocketFromDeviceId(deviceId: string): string | undefined {
    return this.deviceToSocket.get(deviceId);
  }
  
  /**
   * Check if device is connected
   * Passing the deviceID we check if the socket is connected or not
   */
  isDeviceConnected(deviceId: string): boolean {
    return this.deviceToSocket.has(deviceId);
  }
  
  /**
   * Get all connected devices
   * A array containing information of all connected devices
   */
  getConnectedDevices(): SocketDeviceMap[] {
    return Array.from(this.socketToDevice.values());
  }
  
  /**
   * Get connection stats
   * 
   */
  getConnectionStats(): {
    totalConnections: number;
    uniqueDevices: number;
    devices: SocketDeviceMap[];
  } {
    const devices = this.getConnectedDevices();
    
    return {
      totalConnections: this.socketToDevice.size,
      uniqueDevices: new Set(devices.map(d => d.deviceId)).size,
      devices
    };
  }
  

  // ========================================
  // VALIDATION
  // ========================================
  
  /**
   * Validate device registration payload
   * Checks the four required fields in device registration
   */
  private validateRegistration(payload: any): {
    valid: boolean;
    error?: string;
  } {
    
    if (!payload.deviceId) {
      return { valid: false, error: 'deviceId is required' };
    }
    
    if (!payload.userId) {
      return { valid: false, error: 'userId is required' };
    }
    
    if (!payload.deviceType) {
      return { valid: false, error: 'deviceType is required' };
    }
    
    if (!payload.totalStorageBytes || payload.totalStorageBytes < 1073741824) {
      return { 
        valid: false, 
        error: 'Device must offer at least 1GB of storage' 
      };
    }
    
    const validTypes = ['ANDROID', 'IOS', 'DESKTOP', 'MACOS', 'LINUX'];
    if (!validTypes.includes(payload.deviceType)) {
      return { 
        valid: false, 
        error: `deviceType must be one of: ${validTypes.join(', ')}` 
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Calculate reliability score
   * Formula:
   * [ % R = U / (U+D) * 100 ]
   */
  private calculateReliabilityScore(
    totalUptime: bigint,
    totalDowntime: bigint
  ): number {

    // Total time (U+D)
    const totalTime = Number(totalUptime + totalDowntime);

    // Begin with 100%
    if (totalTime === 0) {
      return 100.0;
    }
    
    // Your uptime
    const uptimePercentage = (Number(totalUptime) / totalTime) * 100;

    // The reliability score is = Uptime percentage
    // Just don't let it cross 0-100%
    return Math.max(0, Math.min(100, Math.round(uptimePercentage * 100) / 100));
  }
}

// Export singleton instance
export const websocketDeviceManager = new WebSocketDeviceManager();