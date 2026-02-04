import { Socket, Server as SocketIOServer } from 'socket.io';
import { prisma } from '../config/database';
import { cacheDeviceStatus, updateDeviceLastSeen } from '../config/redis';
import { DeviceStatus } from '@prisma/client';
import { healthMonitoringService } from '../modules/replication/health.service';
import { authService } from '../modules/auth/auth.service';
import { deviceService } from '../modules/devices/device.service';
import { number } from 'zod';


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
 * Before any device event is processed the socket must carry a valid JWT  
 * 
 * The flow:
 *
 * 1. Extracts the JWT from
 *    socket.handshake.auth.token
 * 2. Verifies it via authService.verifyToken()
 * 3. Attaches the decoded token to socket.data
 * 4. On failure → calls next(Error)
 *
 * This runs once per connection attempt
 * before any event handlers.
 *
 * If the token is missing or invalid the socket is
 * disconnected
 * 
 * @param io  The Socket.IO server instance (from server.ts)
 */
export function setupSocketAuth(io: SocketIOServer
): void {

  // The middleware of Websocket server
  io.use(async (socket: Socket, next) => {
    try {

      // Extract token sent during websocket handshake
      const token = socket.handshake?.auth?.token as string | undefined;

      if (!token) {
        console.warn(`🚫 Socket ${socket.id} — no auth token in handshake`);
        next(new Error('auth-token-missing'));
        return;
      }

      // Verify JWT via the existing auth service
      const decoded = await authService.verifyToken(token);

      // Attach to socket.data so every handler can read it
      socket.data.userId = decoded.id;
      socket.data.email   = decoded.email;
      socket.data.role    = decoded.role;

      console.log(`✅ Socket ${socket.id} authenticated — user ${decoded.email}`);

      // Allow connection and move to next middleware
      next();                          
    } catch (err) {
      console.warn(`🚫 Socket auth failed:`, err);
      // reject the connection
      next(new Error('auth-invalid'));  
    }
  });
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
   * Register a device via WebSocket
   * 
   * This is called when client emits 'device:register' event
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

      // 2. Authenticate the connector 
      // socket.data.userId was set by the auth middleware from the JWT.
      // The client must also send the matching userId in the payload
      if (socket.data.userId !== payload.userId) {
        console.warn(
          `🚨 Ownership mismatch on socket ${socket.id}: ` +
          `JWT says ${socket.data.userId}, payload says ${payload.userId}`,
        );
        return { success: false, message: 'Authenticated user does not match payload userId' };
      }


      // 3. This is direct registration via websocket 
      // The DB write is done by the service
      const deviceData = await deviceService.registerDevice({
        deviceId:          payload.deviceId,
        deviceType:        payload.deviceType,
        userId:           payload.userId,
        totalStorageBytes: payload.totalStorageBytes,
      });
      

      // 4. Map socket to device
      // This is where we link the device details the moment it connects to us via socketID
      this.mapSocketToDevice(socket, payload.deviceId, payload.userId, payload.totalStorageBytes);
    

      // 5. Store deviceId in socket metadata
      // This is not mapping but assigning the value directly
      // By this the connected socket could be easily extracted with these data  
      socket.data.deviceId = payload.deviceId;
      
      console.log(`  ✅ Device ${payload.deviceId} registered successfully`);
      
      return {
        success: true,
        device: {
          id:               deviceData.id,
          deviceId:         deviceData.deviceId,
          status:           deviceData.status,
          reliabilityScore: deviceData.reliabilityScore,
          totalEarnings:    String(deviceData.totalEarnings),
        },
        message: 'Device registered successfully',
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
   * The periodic flush to DB is handled externally
   * (see server.ts startup where a setInterval calls
   *  deviceService.flushHeartbeatToDB)
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
      if(mapping.deviceId != payload.deviceId){
        console.error(`Stored deviceID and ping deviceID don't match`);
      }

      // 3. Update the map
      mapping.lastSeenAt = new Date();
      mapping.availableStorageBytes   = payload.availableStorageBytes;

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
}

// Export singleton instance
export const websocketDeviceManager = new WebSocketDeviceManager();