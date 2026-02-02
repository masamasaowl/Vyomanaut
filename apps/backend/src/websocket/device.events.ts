import { Socket } from 'socket.io';
import { websocketDeviceManager } from './device.manager';
import {
  DeviceEvent,
  DevicePingPayload,
} from '../types/device.types';


/**
 * Setup WebSocket Device Event Handlers
 * 
 * Events:
 * 1. Registration
 * 2. Ping
 * 3. Storage update
 * 4. Disconnect
 * ( Logger events )
 * 5. Chunk assignment confirmation
 * 6. Chunk deletion confirmation
 */

export function setupDeviceEvents(socket: Socket): void {
  
  // ========================================
  // EVENT 1: DEVICE REGISTRATION
  // ========================================
  
  // "device:register"
  // request by client 
  socket.on(DeviceEvent.REGISTER, async (payload: any) => {
    try {
      console.log(`📱 Registration request from socket ${socket.id}`);
      
      // Use device manager for registration
      const result = await websocketDeviceManager.registerDevice(socket, payload);
      
      // Inform client about the result
      // "device:registered" event
      socket.emit(DeviceEvent.REGISTERED, result);
      
      if (result.success) {
        console.log(`✅ Device ${payload.deviceId} registered successfully`);
      } else {
        console.error(`❌ Registration failed: ${result.message}`);
      }
      
    } catch (error) {
      console.error('❌ Error in registration handler:', error);
      
      // Registration failure
      socket.emit(DeviceEvent.REGISTERED, {
        success: false,
        message: 'Internal server error during registration'
      });
    }
  });
  


  // ========================================
  // EVENT 2: HEARTBEAT/PING
  // ========================================
  
  // "device:ping" event 
  // When device sends us a ping
  socket.on(DeviceEvent.PING, async (payload: DevicePingPayload) => {
    try {
      // Use device manager for heartbeat
      const result = await websocketDeviceManager.handleHeartbeat(socket, payload);
      
      // Send pong response
      // "device:pong"
      socket.emit(DeviceEvent.PONG, result);
      

      // Only log occasionally to avoid spam (10% of the time)
      if (Math.random() < 0.1) {
        console.log(`💓 Heartbeat from ${payload.deviceId}`);
      }
      
    } catch (error) {
      console.error('❌ Error in ping handler:', error);
      
      socket.emit(DeviceEvent.PONG, {
        success: false,
        timestamp: Date.now()
      });
    }
  });
  

  // ========================================
  // EVENT 3: STORAGE UPDATE
  // ========================================
  
  // "device:storage:update" event 
  // Request sent to us by client
  socket.on(DeviceEvent.STORAGE_UPDATE, async (payload: { availableStorageBytes: number }) => {
    try {

      // Pull the device ID
      const deviceId = socket.data.deviceId;
      
      if (!deviceId) {
        console.warn('⚠️ Storage update from unregistered device');
        return;
      }
      
      // Reuse heartbeat logic because -> It updates storage too
      // It's like an unformatted "device:ping" event to the server
      await websocketDeviceManager.handleHeartbeat(socket, {
        deviceId,
        availableStorageBytes: payload.availableStorageBytes
      });
      
      console.log(`📊 Storage updated for ${deviceId}: ${(payload.availableStorageBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
      
    } catch (error) {
      console.error('❌ Error in storage update handler:', error);
    }
  });
  

  // ========================================
  // EVENT 4: DISCONNECTION
  // ========================================
  
  // "disconnect" request by client
  socket.on(DeviceEvent.DISCONNECT, async (reason: string) => {
    try {

      // Use device manager for disconnection
      await websocketDeviceManager.handleDisconnection(socket, reason);
      
    } catch (error) {
      console.error('❌ Error in disconnect handler:', error);
    }
  });
  

  // ========================================
  // EVENT 5: CHUNK CONFIRMATION ( Logging it )
  // ========================================
  
  // "chunk:confirm" sent by client on successful storage of chunk
  // Confirmation is handled by distribution service via socket.once()
  // This is just for logging in the websocket
  socket.on(DeviceEvent.CHUNK_CONFIRM, async (payload: { 
    chunkId: string; 
    success: boolean; 
    error?: string;
  }) => {
    try {
      // Fetch deviceID
      const deviceId = socket.data.deviceId;
      
      if (!deviceId) {
        console.warn('⚠️ Chunk confirmation from unregistered device');
        return;
      }
      
      if (payload.success) {
        console.log(`✅ Device ${deviceId} confirmed chunk ${payload.chunkId}`);
      } else {
        console.error(`❌ Device ${deviceId} failed to store chunk ${payload.chunkId}: ${payload.error}`);
      }
      
    } catch (error) {
      console.error('❌ Error in chunk confirmation handler:', error);
    }
  });
  

  // ========================================
  // EVENT 6: CHUNK DELETION CONFIRMATION ( logging it)
  // ========================================
  
  // Deletion confirmation is handled by deletion service via socket.once()
  socket.on(DeviceEvent.CHUNK_DELETED, async (payload: { 
    chunkId: string; 
    success: boolean; 
    error?: string;
  }) => {
    try {
      const deviceId = socket.data.deviceId;
      
      if (!deviceId) {
        console.warn('⚠️ Chunk deletion confirmation from unregistered device');
        return;
      }
      
      if (payload.success) {
        console.log(`✅ Device ${deviceId} confirmed deletion of chunk ${payload.chunkId}`);
      } else {
        console.error(`❌ Device ${deviceId} failed to delete chunk ${payload.chunkId}: ${payload.error}`);
      }
      
    } catch (error) {
      console.error('❌ Error in chunk deletion confirmation handler:', error);
    }
  });
}