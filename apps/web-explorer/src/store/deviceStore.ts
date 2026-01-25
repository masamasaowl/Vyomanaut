import { create } from 'zustand';
import { socketManager } from '@/lib/socket';
import type { Device, ChunkLocation, StoredChunk } from '@/types';
import { chunkStorageService } from '@/services/chunkStorage';


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
  loadingChunks: boolean;
  
  // 3 Actions
  connectSocket: () => Promise<void>;
  registerDevice: (
    deviceName: string,
    storageBytes: number,
    userId: string
  ) => Promise<void>;
  disconnectSocket: () => void;
  
  // Chunk management
  loadChunks: () => Promise<void>;
  refreshChunks: () => Promise<void>;
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
  loadingChunks: false,
  

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
      // We store the chunk in our DB as soon as event gets triggered
      socketManager.onChunkAssigned(async (storedChunk: StoredChunk) => {

        // We have received a chunk
        console.log('📦 Received chunk assignment:', storedChunk.id);


        // Fetch the registered device ( Our device )
        const device = get().device;
        // If it doesn't exist 
        if (!device) {
          console.error('❌ Cannot store chunk: Device not registered');
          socketManager.confirmChunkStorage(storedChunk.id, false, 'Device not registered');
          return;
        }
        
  
        try {
          // Store chunk in PostgreSQL
          await chunkStorageService.storeChunk({
            chunkId: storedChunk.id,
            deviceId: device.deviceId,

            // The encrypted data
            encryptedData: storedChunk.encryptedData || '',
            fileId: storedChunk.fileId || '',
            sequenceNum: storedChunk.sequenceNum,
            sizeBytes: storedChunk.sizeBytes,
            checksum: storedChunk.checksum,
          });

          // Refresh chunk list
          await get().refreshChunks();
          
          // Confirm to backend
          socketManager.confirmChunkStorage(storedChunk.id, true);
          
          console.log(`✅ Chunk ${storedChunk.id} stored successfully`);
          

        } catch (error) {
          console.error('❌ Failed to store chunk:', error);

          // Inform backend about the failure
          socketManager.confirmChunkStorage(
            storedChunk.id,
            false,
            error instanceof Error ? error.message : 'Storage failed'
          );
        }
      });
      

      // iv. "chunk:request" event 
      socketManager.onChunkRequested(async (chunkId: string) => {
        // Inform about the requested chunk
        console.log('📤 Chunk retrieval requested:', chunkId);

        // Check if device is authenticated
        const device = get().device;
        if (!device) {
          socketManager.sendChunkData(chunkId, '', false, 'Device not registered');
          return;
        }


        try {
          // Retrieve chunk from PostgreSQL 
          const encryptedData = await chunkStorageService.retrieveChunk(chunkId, device.deviceId);
          
          // Send to backend
          socketManager.sendChunkData(chunkId, encryptedData, true);
          
          console.log(`✅ Chunk ${chunkId} sent to backend`);

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

        // Authenticate device
        const device = get().device;
        if (!device) {
          socketManager.confirmChunkDeletion(chunkId, false, 'Device not registered');
          return;
        }

        try {
          // Delete chunk from PostgreSQL
          await chunkStorageService.deleteChunk(chunkId, device.deviceId);
          
          // Refresh chunk list
          await get().refreshChunks();
          
          // Confirm to backend
          socketManager.confirmChunkDeletion(chunkId, true);
          
          console.log(`✅ Chunk ${chunkId} deleted successfully`);

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
   * Load chunks from PostgreSQL
   */
  loadChunks: async () => {

    // Make sure the device is registered
    const device = get().device;
    if (!device) return;
    
    // We are fetching the chunk details for the device
    set({ loadingChunks: true });
    
    try {
      // Make a Read all request to DB
      const chunks = await chunkStorageService.getDeviceChunks(device.deviceId);
      
      // Update available storage based on chunks
      const usedStorage = chunks.reduce((sum, c) => sum + c.sizeBytes, 0);
      const availableStorage = device.totalStorageBytes - usedStorage;
      
      // Work done we update the states
      set({
        chunks,
        loadingChunks: false,
        device: {
          ...device,
          availableStorageBytes: availableStorage,
        },
      });
      
    } catch (error) {
      console.error('❌ Failed to load chunks:', error);
      set({ loadingChunks: false });
    }
  },
  
  /**
   * Refresh chunks from PostgreSQL
   * Called after chunk add/remove operations
   */
  refreshChunks: async () => {
    await get().loadChunks();
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