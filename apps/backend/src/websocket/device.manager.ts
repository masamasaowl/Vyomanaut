import { Socket } from 'socket.io';
import { cacheDeviceStatus, updateDeviceLastSeen } from '../config/redis';
import { DeviceStatus } from '@prisma/client';
import { deviceService } from '../modules/devices/device.service';


// ===================================================
//  WEBSOCKET DEVICE MANAGER
// ===================================================

// The device and socket are mapped in DB
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
  availableStorageBytes: number;
}

/**
 * WebSocket Device Manager
 * 
 * This class owns the WebSocket layer for devices.It
 * does not touch Postgres directly — every write is
 * delegated to device.service.ts.
 * 
 * Responsibilities:
 * 1. Register new device 
 * 2. Respond to a ping from a device
 */
class WebSocketDeviceManager {
  
  // Map link: socketId → deviceId, userId, connectedAt & lastSeenAt
  // This is done using Maps for O(1) lookup of device info just from the socketID
  private socketToDevice: Map<string, SocketDeviceMap> = new Map();
  
  // Link: deviceId → socketId
  // This is used for reverse lookup
  private deviceToSocket: Map<string, string> = new Map();
  

  // ========================================
  // DEVICE REGISTRATION
  // ========================================
  
  /**
   * Connect device to websocket 
   * 
   * This is called when client emits 'device:connect' event
   * 
   * Device is already registered by device.service.ts
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
  async connectDevice(
    socket: Socket,
    payload: {
      deviceId: string;
      availableStorageBytes?: number;
    }
  ): Promise<{
    success: boolean;
    device?: any;
    message: string;
  }> {
    
    try {
      const { deviceId } = payload;

      console.log(`📱 Connecting device ${deviceId} via WebSocket...`);
      

      // 1. Verify ownership
      // If the user has registered then his userID must exist in the socket 
      const userId = socket.data.userId;
      if (!userId) {
        return { success: false, message: 'Not authenticated' };
      }

      // 2. Fetch the device from DB 
      const device = await deviceService.getDevice(deviceId);

      // Validate the device
      if (!device) {
        return {
          success: false,
          message: `Device ${deviceId} not found. Please register via REST API first.`
        };
      }
      if (device.userId !== userId) {
        return {
          success: false,
          message: 'Device does not belong to authenticated user'
        };
      }

      // 3. Update device status to ONLINE in DB
      // Heartbeats would be cached only in Redis
      await deviceService.flushHeartbeatToDB(
        deviceId,
        payload.availableStorageBytes || device.availableStorageBytes
      );


      // 4. Map socket to device
      // This is where we link the device details the moment it connects to us via socketID
      this.mapSocketToDevice(
        socket,
        deviceId,
        userId,
        payload.availableStorageBytes || device.availableStorageBytes
      );

      // 5. Update Redis cache
      await cacheDeviceStatus(deviceId, DeviceStatus.ONLINE);
      await updateDeviceLastSeen(deviceId);
    
      
      console.log(`  ✅ Device ${deviceId} connected  successfully via websocket`);
      
      return {
        success: true,
        device: {
          id: device.id,
          deviceId: device.deviceId,
          status: DeviceStatus.ONLINE,
          reliabilityScore: device.reliabilityScore,
          totalEarnings: String(device.totalEarnings),
        },
        message: 'Device connected successfully',
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
   * The hot path called every 60s to handle device ping
   * 
   * Update: 
   * 1. lastSeenAt
   * 2. availableStorage
   * 3. uptime
   *
   * The periodic flush to DB is handled by server.ts 
   * from deviceService.flushHeartbeatToDB every 120s
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

      // 1. Do a MAP lookup
      // Device sends heartbeat -> means it's online and connected to socket
      // We extract the data from this ID
      const mapping = this.socketToDevice.get(socket.id); 

      // 2. Logical checks based on MAP 
      if (!mapping) {
        console.warn(`⚠️ Heartbeat from unregistered socket ${socket.id}`);
        return {
          success: false,
          status: DeviceStatus.OFFLINE,
          timestamp: Date.now()
        };
      }

      // 3. Update the map
      mapping.lastSeenAt = new Date();
      mapping.availableStorageBytes = payload.availableStorageBytes;

      // 4. We write the updates to Redis
      // SETEX 90 s
      await cacheDeviceStatus(payload.deviceId, DeviceStatus.ONLINE);   
      // ZADD sorted-set
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
      
      // Mark device as offline in DB
      await deviceService.markDeviceOffline(mapping.deviceId);

      // Clear the maps for this socket and we prepare for a fresh connection
      this.socketToDevice.delete(socket.id);
      this.deviceToSocket.delete(mapping.deviceId);
      
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
    userId: string,
    totalStorageBytes: number
  ): void {
    
    // Create the map
    const mapping: SocketDeviceMap = {
      socketId: socket.id,
      deviceId,
      userId,
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      availableStorageBytes: totalStorageBytes
      
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
}

// Export singleton instance
export const websocketDeviceManager = new WebSocketDeviceManager();