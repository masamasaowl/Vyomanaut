import { io, Socket } from 'socket.io-client';
import type {
  StoredChunk,
} from '@/types';

/**
 * WebSocket Manager for Web-Explorer
 * 
 * This is made only for listening to events 
 * For running logic after they take place would be declared in the service
 * 
 * * ========= Optimized version =========
 * 1. JWT authentication handshake
 * 2. Reconnection with exponential backoff
 * 3. Monitor latency
 * 
 * 
 * Events
 * 1. Connection events
 * 2. Device events
 * 3. Registration
 * 4. Ping
 * 5. Confirm chunk storage 
 * 6. Send chunk data 
 * 
 * Available callbacks 
 * 1. onConnected
 * 2. onDisconnected
 * 3. onChunkAssigned
 * 4. onChunkRequested
 * 5. onChunkDelete
 */


/**
 * This interface contains contains the frequently used options of the socket manager
 * They enable us to customize it 
 */
interface SocketConfig {
  deviceId: string;
  jwt: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

interface LatencyMetrics {
  lastPing: number;
  avgLatency: number;
  samples: number[];
}


class DeviceSocketManager {
  
  // Type declarations  
  // Our walkie-talkie  
  private socket: Socket | null = null;
  // The configuration for our socket
  // We use it to access values across the setup 
  private config: SocketConfig;
  // How many attempts did we give
  private reconnectAttempts = 0;
  // Stop trying to connect after this point
  private maxReconnectAttempts = 10;
  private isIntentionalDisconnect = false;
  

  // Performance monitoring to monitor latency
  private latencyMetrics: LatencyMetrics = {
    lastPing: Date.now(),
    avgLatency: 0,
    samples: []
  };

  // Event callbacks
  // These are empty functions that would later store the work declared by service 
  // They are made to pass absolute control of the logic to the services 
  private onConnectedCallback: (() => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private onChunkAssignedCallback: ((chunk: StoredChunk) => void) | null = null;
  private onChunkRequestedCallback: ((chunkId: string) => void) | null = null;
  private onChunkDeleteCallback: ((chunkId: string, reason: string) => void) | null = null;
  
  // Setup the Socket at start 
  constructor(config: SocketConfig) {
    this.config = config;
  }


  // ================================================
  // CONNECT TO SERVER
  // ================================================

  /**
   * Connect to backend WebSocket server
   * 
   * Functionalities
   * 1. Connect to server 
   * 2. Declare the socket 
   * 3. Connection events 
   *    - Connected 
   *    - Disconnected 
   *    - Connection error
   */
  connect(): Promise<void> {

    // Return a promise to check if the device is connected or not
    return new Promise((resolve, reject) => {

      // Device is already connected   
      if (this.socket?.connected) {
        resolve();
        return;
      }

      // Our backend URL
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      
      console.log(`🔌 [${this.config.deviceId}] Connecting with JWT handshake...`);

      // This is the start of connection
      const startTime = Date.now();
      

      // Switch on the walkie-talkie 
      // Pass JWT to server 
      this.socket = io(API_URL, {
        // Pass token for authentication during handshake
        auth: {
          token: this.config.jwt
        },
        // Use websockets only faster than polling
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: this.maxReconnectAttempts,
      });
      

      // Connection events
      // 1. Connected to server successfully
      this.socket.on('connect', () => {

        // This is when we got connected
        const connectionTime = Date.now() - startTime;

        console.log(`✅ [${this.config.deviceId}] Connected in ${connectionTime}ms (Socket: ${this.socket?.id})`);

        // Reset flag
        this.reconnectAttempts = 0;

        // Run the empty box which by now must be containing the work declared by the service
        this.onConnectedCallback?.();

        // Also configure according to connection
        this.config.onConnected?.();

        // Start latency monitoring
        this.startLatencyMonitoring();
        
        // Now immediately send the first ping to server 
        // The device is marked ONLINE in DB
        this.sendDeviceConnect();

        // The promise gets resolved
        resolve();
      });
      

      // 2. When we wish to disconnect to the server
      this.socket.on('disconnect', (reason) => {
        console.log(`📴 [${this.config.deviceId}] Disconnected: ${reason}`);
        this.onDisconnectedCallback?.();
        this.config.onDisconnected?.();
      });
      
      // 3. When there is an connection error
      this.socket.on('connect_error', (error) => {
        console.error(`❌ [${this.config.deviceId}] Connection error:`, error.message);

        // Try reconnecting again
        this.reconnectAttempts++;
        
        // Reconnect limit reached
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.config.onError?.(new Error('Max reconnection attempts reached'));
          reject(error);
        }  
      });
      
      // Setup device event listeners
      this.setupDeviceEvents();

      // Connection timeout fallback
      // 10s
      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }
  

  /**
   * Send device:connect event (after auth via handshake)
   */
  private sendDeviceConnect() {
    if (!this.socket?.connected) return;
    
    this.socket.emit('device:connect', {
      deviceId: this.config.deviceId,

      // As DB has no limits 
      // So by default we show storage as 10GB
      availableStorageBytes: 10 * 1024 * 1024 * 1024 
    });
  }


  /**
   * Setup event listeners for device-related events
   * We listen for events and leave an empty function so the service can act accordingly 
   * 
   * Events:
   * 1. Chunk assignment
   * 2. Chunk Retrieval
   * 3. Chunk Deletion
   */
  private setupDeviceEvents() {

    // Setup the walkie-talkie first 
    if (!this.socket) return;
    
    // Take Device connected confirmation from server
    this.socket.on('device:connected', (data) => {
      if (data.success) {
        console.log(`✅ [${this.config.deviceId}] Device connected to backend`);
      } else {
        console.error(`❌ [${this.config.deviceId}] Device connection failed:`, data.message);
        this.config.onError?.(new Error(data.message));
      }
    });


    // We listen for 
    // 1. Chunk assignment 
    this.socket.on('chunk:assign', (data: StoredChunk) => {
      // log the event 
      console.log(`📦 [${this.config.deviceId}] Chunk assigned:`, data.id);
      // Empty event handler 
      this.onChunkAssignedCallback?.(data);
    });
    
    // 2. Chunk retrieval
    this.socket.on('chunk:request', (data: { chunkId: string }) => {
      console.log(`📤 [${this.config.deviceId}] Chunk requested:`, data.chunkId);
      this.onChunkRequestedCallback?.(data.chunkId);
    });
    
    // 3. Chunk deletion
    this.socket.on('chunk:delete', (data: { chunkId: string; reason: string }) => {
      console.log(`🗑️ [${this.config.deviceId}] chunk delete request:`, data.chunkId, data.reason);
      this.onChunkDeleteCallback?.(data.chunkId, data.reason);
    });

    // 4. Pong response
    // When we receive a pong from server then we update the latency
    this.socket.on('device:pong', () => {
      this.updateLatencyMetrics();
    });
  }
  
  
  // ================================================
  // DEVICE SERVER INTERACTIONS
  // ================================================

  /**
   * Send heartbeat ping to backend every 60 seconds
   * This ensures our device stays live on the backend servers 
   * It helps it track our uptime
   * We expect a pong response from the backend
   * 
   * This is activated after the device connects
   */
  sendPing(availableStorageBytes: number = 10 * 1024 * 1024 * 1024) {

    if (!this.socket?.connected){
      console.warn('⚠️ Cannot send ping: Socket not connected');
      return;
    } 
    
    this.socket.emit('device:ping', {
      deviceId: this.config.deviceId,
      availableStorageBytes
    });
  }
  
  /**
   * Confirm chunk storage success
   * This is happening on our end when we store a single chunk 
   * This informs the server that the chunk has been stored 
   * 
   * Used in "chunk:assign"
   */
  confirmChunkStorage(chunkId: string, success: boolean, error?: string) {
    if (!this.socket?.connected) {
      console.warn(`⚠️ [${this.config.deviceId}]Cannot confirm chunk: Socket not connected`);
      return;
    }
    
    this.socket.emit(`chunk:confirm:${chunkId}`, { success, error });
  }
  
  /**
   * Send chunk data back to backend
   * Happens when the server requests for chunk data to be displayed on the company dashboard 
   * 
   * Used in "chunk:request"
   */
  sendChunkData(chunkId: string, data: string, success: boolean, error?: string) {
    if (!this.socket?.connected) {
      console.warn(`⚠️ [${this.config.deviceId}] Cannot send chunk data: Socket not connected`);
      return;
    }
    
    this.socket.emit(`chunk:data:${chunkId}`, { success, data, error });
  }
  
  /**
   * Confirm chunk deletion
   * Used in "chunk:delete"
   */
  confirmChunkDeletion(chunkId: string, success: boolean, error?: string) {
    if (!this.socket?.connected) {
      console.warn(`⚠️ [${this.config.deviceId}] Cannot confirm deletion: Socket not connected`);
      return;
    }
    
    this.socket.emit(`chunk:deleted:${chunkId}`, { success, error });
  }
  

  // ================================================
  // MONITOR LATENCY
  // ================================================

  /**
   * Latency monitoring of ping
   */
  private startLatencyMonitoring() {
    setInterval(() => {
      if (this.socket?.connected) {
        this.latencyMetrics.lastPing = Date.now();
        this.sendPing();
      }
    }, 30000); // Every 30s
  }

  /**
   * For every pong we register the latency to track system health
   */
  private updateLatencyMetrics() {
    const latency = Date.now() - this.latencyMetrics.lastPing;
    this.latencyMetrics.samples.push(latency);
    
    // Keep last 10 samples
    if (this.latencyMetrics.samples.length > 10) {
      this.latencyMetrics.samples.shift();
    }
    
    // Calculate average
    this.latencyMetrics.avgLatency = 
      this.latencyMetrics.samples.reduce((a, b) => a + b, 0) / 
      this.latencyMetrics.samples.length;
  }


  // ================================================
  // EVENT CALLBACKS
  // ================================================

  /**
   * These are methods or empty boxes filled by deviceStore.ts
   */
  onConnected(callback: () => void) {
    this.onConnectedCallback = callback;
  }
  
  onDisconnected(callback: () => void) {
    this.onDisconnectedCallback = callback;
  }
  
  onChunkAssigned(callback: (chunk: StoredChunk) => void) {
    this.onChunkAssignedCallback = callback;
  }
  
  onChunkRequested(callback: (chunkId: string) => void) {
    this.onChunkRequestedCallback = callback;
  }
  
  onChunkDelete(callback: (chunkId: string, reason: string) => void) {
    this.onChunkDeleteCallback = callback;
  }
  
  /**
   * Disconnect from server intentionally 
   */
  disconnect() {
    if (this.socket) {
      console.log(`🔌 [${this.config.deviceId}] Disconnecting...`);
      this.isIntentionalDisconnect = true;
      this.socket.disconnect();
      this.socket = null;
    }
  }
  

  // ==========================================
  // HELPERS
  // ==========================================g
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
  
  getSocketId(): string | undefined {
    return this.socket?.id;
  }
  
  getLatency(): number {
    return this.latencyMetrics.avgLatency;
  }
  
  getDeviceId(): string {
    return this.config.deviceId;
  }
}


// Export singleton instance
export const socketManager = new DeviceSocketManager({
  // They will be set later
  deviceId: '', 
  jwt: ''
});

export { DeviceSocketManager };