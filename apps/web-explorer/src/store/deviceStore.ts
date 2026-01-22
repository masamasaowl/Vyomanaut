import { create } from 'zustand';
import { socketManager } from '@/lib/socket';
import type { Device, ChunkMetadata, ChunkLocation } from '@/types';


// Type declaration of the store
interface DeviceState {
  // Device info
  device: Device | null;
  isRegistered: boolean;
  
  // Connection status
  isConnected: boolean;
  connectionError: string | null;
  
  // Chunks stored on this device
  chunks: ChunkLocation[];
  
  // 3 Actions
  connectSocket: () => Promise<void>;
  registerDevice: (
    deviceName: string,
    storageBytes: number,
    userId: string
  ) => Promise<void>;
  disconnectSocket: () => void;
  
  // Chunk management
  addChunk: (chunk: ChunkLocation) => void;
  removeChunk: (chunkId: string) => void;
  updateChunkHealth: (chunkId: string, isHealthy: boolean) => void;
}


/**
 * Device Store
 * 
 * Manages device state and coordinates with WebSocket
 * Directly depends on the socket.ts to respond to the events 
 */

export const useDeviceStore = create<DeviceState>((set, get) => ({

  // ================================================
  // Part 1: Declare initial state of state variables 
  // ================================================ 
  device: null,
  isRegistered: false,
  isConnected: false,
  connectionError: null,
  chunks: [],
  

  // =================================================
  // Part 2: The Functions of the store 
  // ================================================


   
  /**
   * This is the service to the socket events  
   * 
   * It's functionalities
   * 1. Connect to the server 
   * 2. Declare the work that must be done after each socket event takes place ( it uses the empty boxes we have declared inside the socket )
   * 
   */ 
  connectSocket: async () => {
    try {

      // Reset errors before we try again    
      set({ connectionError: null });
      
      // 1. Open the websocket connection
      // This is mandatory to begin using the various callbacks associated with our events
      await socketManager.connect();
      

      
      // 2. Now we simply fill up the empty boxes declared there 
      // So we are the service deciding what happens after an event eg: 'connect' takes place 
      
      // i.  If 'connect' event takes place 
      socketManager.onConnected(() => {
        set({ isConnected: true, connectionError: null });
      });
      
      // ii. 'disconnect' event 
      socketManager.onDisconnected(() => {
        set({ isConnected: false });
      });
      
      
      // iii. 'chunk:assign' event 
      // We store the chunk in our DB as soon as it happens
      socketManager.onChunkAssigned(async (chunkMetadata: ChunkMetadata) => {

        // We have received a chunk
        console.log('📦 Received chunk assignment:', chunkMetadata.id);
        
        // Store chunk in PostgreSQL (will implement in next step)

        // For now, we simply add chunk to local state
        try {
          
          // Step 1: Define the incoming chunk
          const newChunk: ChunkLocation = {
            id: crypto.randomUUID(),
            chunkId: chunkMetadata.id,
            deviceId: get().device?.deviceId || '',
            localPath: `/chunks/${chunkMetadata.id}`,
            isHealthy: true,
            lastVerified: new Date(),
            createdAt: new Date(),
          };
          
          // Step 2: Save this chunk inside a state variable 
          get().addChunk(newChunk);
          
          // Step 3: Inform the backend that the chunk has been stored 
          socketManager.confirmChunkStorage(chunkMetadata.id, true);


        } catch (error) {
          console.error('❌ Failed to store chunk:', error);

          // Inform backend about the failure
          socketManager.confirmChunkStorage(
            chunkMetadata.id,
            false,
            error instanceof Error ? error.message : 'Storage failed'
          );
        }
      });
      

      // iv. "chunk:request" event 
      socketManager.onChunkRequested(async (chunkId: string) => {
        // Inform about the requested chunk
        console.log('📤 Chunk retrieval requested:', chunkId);
        
        try {
          // Retrieve chunk from PostgreSQL (will implement in next step)

          // For now, send mock data
          const mockData = 'base64_encoded_chunk_data';
          
          // Send the chunk data to the server 
          socketManager.sendChunkData(chunkId, mockData, true);
        } catch (error) {
          console.error('❌ Failed to retrieve chunk:', error);

          // Send the failed fetch to the chunk
          socketManager.sendChunkData(
            chunkId,
            '',
            false,
            error instanceof Error ? error.message : 'Retrieval failed'
          );
        }
      });
      

      // v. "chunk:delete" event 
      socketManager.onChunkDelete(async (chunkId: string, reason: string) => {
        console.log('🗑️ Chunk deletion requested:', chunkId, reason);
        
        try {
          // Delete chunk from PostgreSQL (will implement in next step)

          // Currently we simply delete chunk from our state variable
          get().removeChunk(chunkId);
          
          // We send the delete confirmation to the server
          socketManager.confirmChunkDeletion(chunkId, true);
        } catch (error) {
          console.error('❌ Failed to delete chunk:', error);

          // Failed chunk deletion sent to the server
          socketManager.confirmChunkDeletion(
            chunkId,
            false,
            error instanceof Error ? error.message : 'Deletion failed'
          );
        }
      });
      
      // When all the empty boxes have been set up and the socket.ts is all wired, then we give the green signal 
      set({ isConnected: true });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({ connectionError: errorMessage, isConnected: false });
      throw error;
    }
  },
  

  /**
   * Register device with backend
   * 
   * Functionality
   * 
   * 1. Generate a user ID
   * 2. Send details of the user and the device to server
   * 3. Confirm registration
   * 4. Save entire device information as state variable
   * 5. Send heartbeat ping to device upon register every 60 seconds
   * 
   */
  registerDevice: async (deviceName: string, storageBytes: number, userId: string) => {

    // We fetch the state of our store 
    const state = get();
    
    // Using this state we confirm if the device is connected to the server 
    if (!state.isConnected) {
      throw new Error('WebSocket not connected. Connect first.');
    }
    
    // Generate unique device ID
    const deviceId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Fetch the browser info using navigator 
    const userAgent = navigator.userAgent;
    // We fetch the browser name 
    const browserInfo =
    userAgent.includes('Chrome') ? 'Chrome' :
    userAgent.includes('Firefox') ? 'Firefox' :
    userAgent.includes('Safari') ? 'Safari' : 'Unknown';
    
    // Pass all the user information to the server on register
    const payload = {
      deviceId,
      deviceType: 'DESKTOP' as const,
      userId,
      totalStorageBytes: storageBytes,
      model: `Browser (${browserInfo})`,
      osVersion: navigator.platform,
      appVersion: '1.0.0-web',
    };
    
    try {

      // Now register through socket 
      const response = await socketManager.registerDevice(payload);
      
      // Create device object
      const device: Device = {
        id: response.device.id,
        deviceId: response.device.deviceId,
        deviceType: 'DESKTOP',
        userId,
        totalStorageBytes: storageBytes,
        availableStorageBytes: storageBytes,
        status: response.device.status,
        lastSeenAt: new Date(),
        reliabilityScore: response.device.reliabilityScore,
        totalEarnings: parseFloat(response.device.totalEarnings),
        pendingEarnings: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      set({ device, isRegistered: true });
      
      // Start heartbeat (ping every 60 seconds)
      setInterval(() => {

        // If device exists
        if (get().device) {
          
          // We send a ping through socket every 60 seconds
          socketManager.sendPing(
            device.deviceId,
            device.availableStorageBytes
          );
        }
      }, 60000);
      
    } catch (error) {
      console.error('❌ Device registration failed:', error);
      throw error;
    }
  },
  

  /**
   * Disconnect from WebSocket
   */
  disconnectSocket: () => {
    socketManager.disconnect();
    set({ isConnected: false, device: null, isRegistered: false });
  },
  
  /**
   * Add chunk to local state
   * 
   * Used in "chunk:assign" event 
   */
  addChunk: (chunk: ChunkLocation) => {
    set((state) => ({
      chunks: [...state.chunks, chunk],
      device: state.device ? {
        ...state.device,

        // Mock: reduce by 1MB
        availableStorageBytes: state.device.
        availableStorageBytes - 1024 * 1024, 
      } : null,
    }));
  },
  

  /**
   * Remove chunk from local state
   * 
   * Used in "chunk:delete" event 
   */
  removeChunk: (chunkId: string) => {
    set((state) => ({
      chunks: state.chunks.filter(c => c.chunkId !== chunkId),
      device: state.device ? {
        ...state.device,
        availableStorageBytes: state.device.availableStorageBytes + 1024 * 1024, // Mock: add back 1MB
      } : null,
    }));
  },
  
  /**
   * Update chunk health status
   */
  updateChunkHealth: (chunkId: string, isHealthy: boolean) => {
    set((state) => ({
      chunks: state.chunks.map(c =>
        c.chunkId === chunkId ? { ...c, isHealthy, lastVerified: new Date() } : c
      ),
    }));
  },
}));