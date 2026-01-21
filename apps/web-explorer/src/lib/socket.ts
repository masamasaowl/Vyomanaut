import { io, Socket } from 'socket.io-client';
import type {
  DeviceRegistrationPayload,
  DeviceRegistrationResponse,
  ChunkMetadata,
} from '@/types';

/**
 * WebSocket Manager for Web-Explorer
 * 
 * This is made only for listening to events 
 * For running logic after they take place would be declared in the service
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

class SocketManager {
  
  // Type declarations  
  // Our walkie-talkie  
  private socket: Socket | null = null;
  // Are we trying to connect
  private isConnecting = false;
  // How many attempts did we give
  private reconnectAttempts = 0;
  // Stop trying to connect after this point
  private maxReconnectAttempts = 10;
  

  // Event callbacks
  // These are empty functions that would later store the work declared by service 
  // They are made to pass absolute control of the logic to the services 
  private onConnectedCallback: (() => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private onChunkAssignedCallback: ((chunk: ChunkMetadata) => void) | null = null;
  private onChunkRequestedCallback: ((chunkId: string) => void) | null = null;
  private onChunkDeleteCallback: ((chunkId: string, reason: string) => void) | null = null;
  

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

      // Case 1: Device is already connected   
      if (this.socket?.connected) {
        resolve();
        return;
      }
      
      // Case 2: Device is trying to connect 
      if (this.isConnecting) {
        reject(new Error('Already connecting'));
        return;
      }

      // Case 3: We establish our connection
      // We are trying to connect
      this.isConnecting = true;
      
      // Our backend URL
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      
      console.log('🔌 Connecting to WebSocket server:', API_URL);
      

      // Switch on the walkie-talkie 
      // We pass it our backend address and options 
      this.socket = io(API_URL, {
        // Use websockets only
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: this.maxReconnectAttempts,
      });
      

      // Connection events
      // 1. Connected to server successfully
      this.socket.on('connect', () => {
        console.log('✅ WebSocket connected:', this.socket?.id);

        // Reset flags
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Run the empty box which by now must be containing the work declared by the service
        this.onConnectedCallback?.();

        // The promise gets resolved
        resolve();
      });
      

      // 2. When we wish to disconnect to the server
      this.socket.on('disconnect', (reason) => {
        console.log('📴 WebSocket disconnected:', reason);
        this.onDisconnectedCallback?.();
      });
      
      // 3. When there is an connection error
      this.socket.on('connect_error', (error) => {
        console.error('❌ WebSocket connection error:', error);

        // Try reconnecting again
        this.isConnecting = false;
        this.reconnectAttempts++;
        
        // Did we hit the limit 
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Max reconnection attempts reached'));
        }
      });
      
      // Setup device event listeners
      this.setupDeviceEvents();
    });
  }
  

  /**
   * Setup event listeners for device-related events
   * We listen for events and leave and empty function so the service can act accordingly 
   * 
   * Events:
   * 1. Chunk assignment
   * 2. Chunk Retrieval
   * 3. Chunk deletion
   */
  private setupDeviceEvents() {

    // Setup the walkie-talkie before it 
    if (!this.socket) return;
    
    // We listen for 
    // 1. Chunk assignment 
    this.socket.on('chunk:assign', (data: ChunkMetadata) => {
      // log the event 
      console.log('📦 Chunk assigned:', data.id);
      // Empty event handler 
      this.onChunkAssignedCallback?.(data);
    });
    
    // 2. Chunk retrieval
    this.socket.on('chunk:request', (data: { chunkId: string }) => {
      console.log('📤 Chunk requested:', data.chunkId);
      this.onChunkRequestedCallback?.(data.chunkId);
    });
    
    // 3. Chunk deletion
    this.socket.on('chunk:delete', (data: { chunkId: string; reason: string }) => {
      console.log('🗑️ Chunk delete request:', data.chunkId, data.reason);
      this.onChunkDeleteCallback?.(data.chunkId, data.reason);
    });
  }
  

  /**
   * Register device with server
   * Simply inform and confirm the registration event
   */
  registerDevice(payload: DeviceRegistrationPayload): Promise<DeviceRegistrationResponse> {
    
    return new Promise((resolve, reject) => {

      // Is walkie-talkie connected?
      if (!this.socket?.connected) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      console.log('📱 Registering device:', payload.deviceId);
      
      // Inform server we are registering
      this.socket.emit('device:register', payload);
      

      // Wait for registration response from server
      this.socket.once('device:registered', (response: DeviceRegistrationResponse) => {

        // Validate response
        if (response.success) {
          console.log('✅ Device registered successfully:', response.device.deviceId);
          // Successful promise
          resolve(response);
        } else {
          reject(new Error('Device registration failed'));
        }
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Device registration timeout'));
      }, 10000);
    });
  }
  

  /**
   * Send heartbeat ping to backend every 60 seconds
   * This ensures our device stays live on the backend servers 
   * It helps it track our uptime
   * We expect a pong response from the backend
   * 
   * This is activated after the device registers
   */
  sendPing(deviceId: string, availableStorageBytes: number) {
    // Connect to the socket
    if (!this.socket?.connected) {
      console.warn('⚠️ Cannot send ping: Socket not connected');
      return;
    }
    
    // send a ping 
    this.socket.emit('device:ping', {
      deviceId,
      availableStorageBytes,
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
      console.warn('⚠️ Cannot confirm chunk: Socket not connected');
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
      console.warn('⚠️ Cannot send chunk data: Socket not connected');
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
      console.warn('⚠️ Cannot confirm deletion: Socket not connected');
      return;
    }
    
    this.socket.emit(`chunk:deleted:${chunkId}`, { success, error });
  }
  

  /**
   * These are methods 
   * When the service calls them, the empty boxes would store the work declared by the service
   */
  onConnected(callback: () => void) {
    this.onConnectedCallback = callback;
  }
  
  onDisconnected(callback: () => void) {
    this.onDisconnectedCallback = callback;
  }
  
  onChunkAssigned(callback: (chunk: ChunkMetadata) => void) {
    this.onChunkAssignedCallback = callback;
  }
  
  onChunkRequested(callback: (chunkId: string) => void) {
    this.onChunkRequestedCallback = callback;
  }
  
  onChunkDelete(callback: (chunkId: string, reason: string) => void) {
    this.onChunkDeleteCallback = callback;
  }
  
  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.socket) {
      console.log('🔌 Disconnecting WebSocket...');
      this.socket.disconnect();
      this.socket = null;
    }
  }
  

  // ==========================================
  // HELPERS
  // ==========================================g
  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
  
  /**
   * Get socket ID
   */
  getSocketId(): string | undefined {
    return this.socket?.id;
  }
}

// Export singleton instance
export const socketManager = new SocketManager();