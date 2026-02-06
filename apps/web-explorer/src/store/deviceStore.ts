import { create } from 'zustand';
import { DeviceSocketManager, socketManager } from '@/lib/socket';
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
  
  // Performance metrics
  metrics: {
    chunksReceived: number;
    chunksSent: number;
    avgLatency: number;
    lastUpdate: Date;
  };

  // 3 Actions
  connectSocket: (jwt: string) => Promise<void>;
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
  metrics: {
    chunksReceived: 0,
    chunksSent: 0,
    avgLatency: 0,
    lastUpdate: new Date()
  },
  

  // =================================================
  // Part 2: The Functions of the store 
  // ================================================


   
  /**
   * We connect to the socket  
   * 
   * 1. We ensure device is registered 
   * 2. Create a dedicated socket manager for the
   *    user and configure it
   * 3. Declare the work to be done for each socket
   *    event takes place
   * 4. Now we connect send the connection request
   *    to server
   * 5. Track latency of this setup      
   */ 
  connectSocket: async (jwt: string) => {
    try {

      // 1. Reset errors before we try again    
      set({ connectionError: null });

      // 2. Fetch the entire store
      const state = get();

      // 3. If device is not present -> it hasn't been registered in the server
      if (!state.device) {
        throw new Error('Device not registered. Register first via REST API.');
      }


      // 4. Create socket manager for this device
      const socketManager = new DeviceSocketManager
      ({

        // These are the configuration options we defined at start of socket.ts
        deviceId: state.device.deviceId,
        jwt,

        // 5. We simply fill up the empty boxes declared there 
        // So we are deciding what happens after an event eg: 'connect' takes place 

        // i. 'connect' event
        onConnected: () => {
          set({ isConnected: true, connectionError: null });
        },

        // ii. 'disconnect' event 
        onDisconnected: () => {
          set({ isConnected: false });
        },

        // iii. 'error' event 
        onError: (error: any) => {
          set({ connectionError: error.message });
        }
      });
      // === Configuration complete ===

      
      // 6. We continue filling the boxes now for the device-server specific events

      // iv. 'chunk:assign' event 
      // We store the chunk in our DB as soon as event gets triggered
      socketManager.onChunkAssigned(async (storedChunk: StoredChunk) => {

        // We have received a chunk
        console.log('📦 Received chunk assignment:', storedChunk.id);


        // Fetch the registered device
        const device = get().device;
        // If it doesn't exist -> Register again
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

          // Update metrics
          set(state => ({
            metrics: {
              ...state.metrics,
              chunksReceived: state.metrics.chunksReceived + 1,
              lastUpdate: new Date()
            }
          }));

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
      

      // v. "chunk:request" event 
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

          // Update metrics
          set(state => ({
            metrics: {
              ...state.metrics,
              chunksSent: state.metrics.chunksSent + 1,
              lastUpdate: new Date()
            }
          }));
          
          // Send to backend
          socketManager.sendChunkData(chunkId, encryptedData, true);
          
          console.log(`✅ Chunk ${chunkId} sent to backend`);

        } catch (error) {
          console.error('❌ Failed to retrieve chunk:', error);
          // Inform about the failed fetch
          socketManager.sendChunkData(
            chunkId,
            '',
            false,
            error instanceof Error ? error.message : 'Retrieval failed'
          );
        }
      });
      

      // vi. "chunk:delete" event 
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
          // Inform server about the failed deletion
          socketManager.confirmChunkDeletion(
            chunkId,
            false,
            error instanceof Error ? error.message : 'Deletion failed'
          );
        }
      });
      // === Event setup complete ===

    
      // Now we connect to the server!
      await socketManager.connect();
      
      // We track the latency metric for this connect to happen
      setInterval(() => {
        if (socketManager.isConnected()) {
          set(state => ({
            metrics: {
              ...state.metrics,
              avgLatency: socketManager.getLatency()
            }
          }));
        }
      }, 5000);

      // We give the green signal 
      set({ isConnected: true });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({ connectionError: errorMessage, isConnected: false });
      throw error;
    }
  },
  

  /**
   * Update device state after device registers through HTTP
   * 
   * Registration only takes place through REST API
   * We update the state in the store as the device registers after making a request to the server
   */
  registerDevice: async (deviceName: string, storageBytes: number, userId: string) => {

    
    const deviceId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const device: Device = {
      id: deviceId, // Will be replaced by DB id, only exists to for type declaration 
      deviceId,
      deviceType: 'DESKTOP',
      userId,
      totalStorageBytes: storageBytes,
      availableStorageBytes: storageBytes,
      status: 'OFFLINE',
      lastSeenAt: new Date(),
      reliabilityScore: 100,
      totalEarnings: 0,
      pendingEarnings: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    set({ device, isRegistered: true });
  },

  /**
   * Update state after disconnect from WebSocket
   */
  disconnectSocket: () => {
    // Disconnect
    socketManager.disconnect();
    // Update state
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
      
      // Work done! we update the states
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
