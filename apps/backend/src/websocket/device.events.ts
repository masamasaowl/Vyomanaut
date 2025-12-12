import { Socket } from 'socket.io';
import { deviceService } from '../modules/devices/device.service';
import {
  DeviceEvent,
  DeviceRegistrationPayload,
  DevicePingPayload,
  DeviceRegistrationResponse,
  DevicePingResponse,
} from '../types/device.types';

// ========================================
// Device WebSocket Event Handlers
// ========================================

/**
 * Think of this like a switchboard operator:
 * - Device sends event → We route it to the right handler
 * - According to the handler the service performs the task → We send response back
 * 
 * This gets called when a device connects to our WebSocket server
 *
 * It like a menu to the chef (service)
 */

export function setupDeviceEvents(socket: Socket): void {
  

  // ========================================
  // EVENT 1. 👶 REGISTER
  // ========================================
  /**
   * When device first connects, it says:
   * "Hi! I'm Device ABC, I have 10GB to share!"
   * 
   * Flow:
   * 1. Device sends registration data
   * 2. We validate it (is data valid?)
   * 3. We call deviceService to register
   * 4. We save deviceId to socket (so we know WHO this socket belongs to)
   * 5. We send success response back
   */
  socket.on(DeviceEvent.REGISTER, async (payload: DeviceRegistrationPayload) => {

    try {
      // 1. When data comes log it 
      console.log(`📱 Device registering:`, {
        deviceId: payload.deviceId,
        storage: `${(payload.totalStorageBytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
      });

      // 2. Validate it (basic checks)
      if (!payload.deviceId || !payload.totalStorageBytes) {

        // If fails
        // Tell the client using emit
        socket.emit(DeviceEvent.REGISTERED, {
          success: false,
          message: 'Invalid registration data. deviceId and totalStorageBytes are required.',
        });
        return;
      }

      // 3. Register device in database
      // uses -> device.service.ts
      const device = await deviceService.registerDevice(payload);

    
      // 4. IMPORTANT: Store deviceId in socket's metadata
      // This way, when THIS specific socket disconnects, we know WHICH device it was!
      socket.data.deviceId = device.deviceId;

      // 5. Send success response
      const response: DeviceRegistrationResponse = {
        success: true,
        device: {
          id: device.id,
          deviceId: device.deviceId,
          status: device.status,
          reliabilityScore: device.reliabilityScore,
          totalEarnings: device.totalEarnings.toString(),
        },
        message: 'Device registered successfully! You are now earning money! 💰',
      };

      // Tell the using emit
      socket.emit(DeviceEvent.REGISTERED, response);
      
      console.log(`✅ Device registered successfully: ${device.deviceId}`);
      
    } catch (error) {
      console.error('❌ Error registering device:', error);
      
      socket.emit(DeviceEvent.REGISTERED, {
        success: false,
        message: 'Failed to register device. Please try again.',
      });
    }
  });


  // ========================================
  // EVENT 2: 💓 Device Heartbeat/Ping 
  // ========================================
  /**
   * 
   * Every 60 seconds, device sends: "I'm alive! Here's my available storage"
   * We respond: "Got it! Here's your current status"
   * 
   * This is CRITICAL - without heartbeats, we think device is dead!
   * 
   * Real-world analogy:
   * - Like a fitness tracker checking your pulse
   * - If pulse stops → You're in trouble!
   * - If device stops pinging → It's offline!
   */
  socket.on(DeviceEvent.PING, async (payload: DevicePingPayload) => {
    try {
      const { deviceId, availableStorageBytes } = payload;

      // Update device's heartbeat in database
      // device.service.ts
      await deviceService.updateDeviceHeartbeat(deviceId, availableStorageBytes);

      // Get current device info
      const device = await deviceService.getDevice(deviceId);

      // if doesn't exist return failure
      if (!device) {
        socket.emit(DeviceEvent.PONG, {
          success: false,
          timestamp: Date.now(),
        });
        return;
      }

      // Send pong response
      const response: DevicePingResponse = {
        success: true,
        timestamp: Date.now(),
        status: device.status,
      };

      socket.emit(DeviceEvent.PONG, response);

      // Optional: Log every 10th ping to avoid spam
      // (In production, you wouldn't log every ping - too noisy!)
      if (Math.random() < 0.1) {
        console.log(`💓 Heartbeat from ${deviceId}`);
      }
      
    } catch (error) {
      console.error('❌ Error handling ping:', error);
      
      socket.emit(DeviceEvent.PONG, {
        success: false,
        timestamp: Date.now(),
      });
    }
  });


  // ========================================
  // EVENT 3: 📊Storage Update  
  // ========================================
  /**
   * Device can manually update its available storage anytime
   * (Maybe user freed up space, or filled it up)
   * 
   * This is like: "Hey! I have more/less space now!"
   */
  socket.on(DeviceEvent.STORAGE_UPDATE, async (payload: { availableStorageBytes: number }) => {

    try {

      // I know you from the ID stored in socket
      const deviceId = socket.data.deviceId;

      if (!deviceId) {
        console.warn('Storage update from unregistered device');
        return;
      }

      // Update storage (reuse heartbeat logic - it does the same thing!)
      // Just update availableStorageBytes
      await deviceService.updateDeviceHeartbeat(deviceId, payload.availableStorageBytes);

      console.log(`📊 Storage updated for ${deviceId}: ${(payload.availableStorageBytes / 1024 / 1024 / 1024).toFixed(2)} GB available`);
      
    } catch (error) {
      console.error('❌ Error updating storage:', error);
    }
  });


  // ========================================
  // EVENT 4: 🔌Device Disconnect  
  // ========================================
  /**
   * When device closes app or loses connection
   * We need to mark it offline!
   * 
   * Important: This is automatic - Socket.io fires this when connection drops
   */
  socket.on(DeviceEvent.DISCONNECT, async (reason: string) => {
    try {

      // get the ID
      const deviceId = socket.data.deviceId;

      if (!deviceId) {
        console.log('🔌 Unknown device disconnected');
        return;
      }

      // Mark device as offline
      await deviceService.markDeviceOffline(deviceId);

      console.log(`📴 Device disconnected: ${deviceId} (Reason: ${reason})`);
      
    } catch (error) {
      console.error('❌ Error handling disconnect:', error);
    }
  });


  // ========================================
  // EVENT 5: 📦Chunk Assignment Confirmation  
  // ========================================
  /**
   * Device confirms it successfully stored a chunk
   * 
   * Flow:
   * 1. Server sends chunk → Device stores it
   * 2. Device confirms → Server updates database
   */
  socket.on('chunk:confirm', async (payload: { chunkId: string; success: boolean; error?: string }) => {
    try {
      const deviceId = socket.data.deviceId;
      
      if (!deviceId) {
        console.warn('⚠️ Chunk confirmation from unregistered device');
        return;
      }
      
      if (payload.success) {
        console.log(`✅ Device ${deviceId} confirmed chunk ${payload.chunkId}`);
        // Confirmation handling is done in distribution service via socket.once()
      } else {
        console.error(`❌ Device ${deviceId} failed to store chunk ${payload.chunkId}: ${payload.error}`);
      }
      
    } catch (error) {
      console.error('❌ Error handling chunk confirmation:', error);
    }
  });



  // ========================================
  // EVENT 6: 📤Chunk Retrieval Request   
  // ========================================

  /**
   * Server requests a chunk from device
   * Device sends the chunk data back
   * 
   * Flow:
   * 1. Server sends chunk:request → Device reads from local storage
   * 2. Device sends chunk:data → Server receives encrypted chunk
   */
  // Note: This event is handled by the device, not the server
  // Server emits 'chunk:request', device responds with 'chunk:data'
  // No handler needed here - it's in the retrieval service
}


  // ========================================
  // HELPERS    
  // ========================================

/**
 * Helper: Get device ID from socket
 * Useful for other modules that need to know which device is connected
 */
export function getDeviceIdFromSocket(socket: Socket): string | undefined {
  return socket.data.deviceId;
}

/**
 * Helper: Check if socket belongs to a registered device
 */
export function isDeviceRegistered(socket: Socket): boolean {
  return !!socket.data.deviceId;
}