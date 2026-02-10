import { create } from 'zustand';
import { DeviceSocketManager, socketManager } from '@/lib/socket';
import type { Device, StoredChunk } from '@/types';
import { chunkStorageService } from '@/services/chunkStorage';


// Type declaration of the store
interface DeviceState {
  // Device info
  device: Device | null;
  isRegistered: boolean;
  
  // Connection status
  isConnected: boolean;
  connectionError: string | null;
  latency: number;
  
  // Chunks stored on this device
  chunks: StoredChunk[];
  chunksLoading: boolean;
  chunksError: string | null;
  
  // Performance metrics
  metrics: {
    chunksReceived: number;
    chunksSent: number;
    bytesStored: number;
    sessionEarnings: number;
    uptimeSeconds: number;
  };

  retryCount: number;
  maxRetries: number;

  // 3 Actions
  registerDevice: (
    name: string,
    storageBytes: number,
    userId: string,
    deviceId: string
  ) => Promise<void>;

  connectSocket: (
    jwt: string,
    deviceId: string
  ) => Promise<void>;
  
  disconnectSocket: () => void;
  
  // Chunk management
  loadChunks: () => Promise<void>;
  updateMetrics: () => void;
  resetRetryCount: () => void;
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
  latency: 0,
  
  chunks: [],
  chunksLoading: false,
  chunksError: null,
  
  metrics: {
    chunksReceived: 0,
    chunksSent: 0,
    bytesStored: 0,
    sessionEarnings: 0,
    uptimeSeconds: 0,
  },
  // Fix unending fetch reloads
  retryCount: 0,
  maxRetries: 3,

  // =================================================
  // Part 2: The Functions of the store 
  // ================================================


  /**
   * Update device state after device registers through HTTP
   * 
   * Registration only takes place through REST API
   * We update the state in the store as the device registers after making a request to the server
   */
  registerDevice: async (name: string, storageBytes: number, userId: string, deviceId: string) => {
    console.log('📝 Registering the device:', deviceId);

    // Save the device details in the state
    const newDevice: Device = {
      id: deviceId, 
      deviceId,
      deviceType: 'DESKTOP',
      userId,
      name,
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
    
    console.log('✅ DeviceStore: Device object created:', newDevice);

    set({
      device: newDevice,
      isRegistered: true,
      connectionError: null,
      retryCount: 0, // Reset retry count
    });

    console.log('✅ DeviceStore: State updated');
  },

   
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
  connectSocket: async (jwt: string, deviceId: string) => {
    try {

      // 1. Reset errors before we try again    
      set({ connectionError: null });

      // 2. Fetch the entire store
      const { device } = get();

      // 3. If device is not present -> it hasn't been registered in the server
      if (!device) {
        throw new Error('Device not registered. Register first via REST API.');
      }
      if (device.deviceId !== deviceId) {
      console.error('❌ DeviceStore: Device ID mismatch!');
      console.error('  Store has:', device.deviceId);
      console.error('  Trying to connect:', deviceId);
    }


      // 4. Create socket manager for this device
      const socketManager = new DeviceSocketManager
      ({

        // These are the configuration options we defined at start of socket.ts
        deviceId: device.deviceId,
        jwt,

        // 5. We simply fill up the empty boxes declared there 
        // So we are deciding what happens after an event eg: 'connect' takes place 

        // i. 'connect' event
        onConnected: () => {
          set({ 
            isConnected: true,
            connectionError: null,
            device: {
              ...device,
              status: 'ONLINE',
            },
          });

          // Start loading chunks
          get().loadChunks();
        },


        // ii. 'disconnect' event 
        onDisconnected: () => {
          set({
            isConnected: false,
            device: device ? {
              ...device,
              status: 'OFFLINE',
            } : null,
          });
        },

        // iii. 'error' event 
        onError: (error: any) => {
          set({
            connectionError: error,
            isConnected: false,
          });
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
          await get().loadChunks();
          
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
          await get().loadChunks();
          
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
   * Update state after disconnect from WebSocket
   */
  disconnectSocket: () => {
    // Disconnect
    socketManager.disconnect();
    // Update state
    set({
      isConnected: false,
      device: get().device ? {
        ...get().device!,
        status: 'OFFLINE',
      } : null,
    });
  },
  
  
  /**
   * Load chunks from PostgreSQL
   */
  loadChunks: async () => {

    // Make sure the device is registered
    const { device, chunksLoading, retryCount, maxRetries } = get();

    if (!device) return;

    // Stop trying to load multiple chunks
    if (retryCount >= maxRetries) {
      console.error('🚫 DeviceStore: Max retries reached, stopping chunk loading');
      set({
        chunksError: `Failed to load chunks after ${maxRetries} attempts. Device may not be properly registered.`,
        chunksLoading: false,
      });
      return;
    }

    // Prevent concurrent loads
    if (chunksLoading) {
      console.log('⏸️ DeviceStore: Chunk loading already in progress');
      return;
    }
    
    // We are fetching the chunk details for the device
    set({ chunksLoading: true, chunksError: null });
    
    try {
      // Make a Read all request to DB
      const chunks = await chunkStorageService.getDeviceChunks(device.deviceId);
      
      // Update available storage based on chunks
      const bytesStored = chunks.reduce((sum, c) => sum + c.sizeBytes, 0);
      
      // Work done! we update the states
      set({
        chunks,
        chunksLoading: false,
        chunksError: null,
        retryCount: 0, // Reset on success
        metrics: {
          ...get().metrics,
          chunksReceived: chunks.length,
          bytesStored,
        },  
      });
      
    } catch (error: any) {
      console.error('❌ Failed to load chunks:', error);
      const newRetryCount = retryCount + 1;
      
      set({
        chunksLoading: false,
        chunksError: error?.message,
        retryCount: newRetryCount,
      });
    }
  },

   // ============================================
  // Reset Retry Count
  // ============================================
  resetRetryCount: () => {
    console.log('🔄 DeviceStore: Resetting retry count');
    set({ retryCount: 0, chunksError: null });
  },
  
  // ============================================
  // Update Metrics
  // ============================================
  updateMetrics: () => {
    const { device, chunks } = get();
    
    if (!device) return;
    
    const bytesStored = chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
    
    // Calculate earnings (example: $0.001 per GB per hour)
    const gbStored = bytesStored / (1024 * 1024 * 1024);
    const uptimeHours = get().metrics.uptimeSeconds / 3600;
    const sessionEarnings = gbStored * uptimeHours * 0.001;
    
    set({
      metrics: {
        ...get().metrics,
        bytesStored,
        sessionEarnings,
        uptimeSeconds: get().metrics.uptimeSeconds + 1,
      },
    });
  },

}));
