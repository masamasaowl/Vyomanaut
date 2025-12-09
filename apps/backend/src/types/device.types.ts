// import two enums from prisma
import { DeviceStatus, DeviceType } from '@prisma/client';

/**
 * Device Types for Vyomanaut
 * 
 * Think of this file as our "contract" - it defines:
 * - What data devices send to us
 * - What data we send back to devices
 * - What data we store internally
 */

// ========================================
// INCOMING DATA (from mobile app)
// ========================================

/**
 * When a device first connects and registers
 * This is like filling out a registration form
 */
export interface DeviceRegistrationPayload {

  // This is exactly like our Device Model  
  deviceId: string;           
  deviceType: DeviceType;     
  userId: string;             
  totalStorageBytes: number; 
  

  // Some optionals we can 
  model?: string;             // e.g., "Samsung Galaxy S21"
  osVersion?: string;         // e.g., "Android 13"
  appVersion?: string;        // e.g., "1.0.0"
}

/**
 * When device sends a heartbeat/ping
 * This is like saying "I'm still alive!"
 */
export interface DevicePingPayload {
  deviceId: string;
  availableStorageBytes: number;  
}

// ========================================
// OUTGOING DATA (to mobile app)
// ========================================

/**
 * So once you register we send back this response 
 */
export interface DeviceRegistrationResponse {
  success: boolean;
  device: {
    id: string;                 // Our internal DB ID
    deviceId: string;           // Their device ID (for their reference)
    status: DeviceStatus;
    reliabilityScore: number;
    totalEarnings: string;      // Decimal as string (safe for frontend)
  };
  message: string;
}

/**
 * Now based on the status of the device we can send * it a message
 */
export interface DevicePingResponse {  
  success: boolean;
  timestamp: number;
  status: DeviceStatus;
}


// ========================================
// INTERNAL DATA (used within backend)
// ========================================

/**
 * Device with all its data 
 * Contains all the fields of the Device model
 */
export interface DeviceData {
  id: string;
  deviceId: string;
  deviceType: DeviceType;
  userId: string;
  
  totalStorageBytes: number;
  availableStorageBytes: number;
  
  status: DeviceStatus;
  lastSeenAt: Date;
  ipAddress: string | null;
  
  reliabilityScore: number;
  totalUptime: number;
  totalDowntime: number;
  
  totalEarnings: number;  // Decimal converted to number for calculations
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A shorter version of the same 
 * eg: to show "all online devices", we don't need everything
 */
export interface DeviceSummary {
  id: string;
  deviceId: string;
  status: DeviceStatus;
  availableStorageBytes: number;
  reliabilityScore: number;
  lastSeenAt: Date;
}

/**
 * Device health metrics
 * Super important as is used to assign chunks efficiently 
 */
export interface DeviceHealth {
  deviceId: string;
  isOnline: boolean;
  reliabilityScore: number;
  uptimePercentage: number;     
  consecutiveDowntimeMs: number;
  lastSeenAt: Date;
}

// ========================================
// QUERY FILTERS
// ========================================

/**
 * To find that one perfect device 
 */
export interface DeviceQueryFilters {
  status?: DeviceStatus;
  minReliabilityScore?: number;
  minAvailableStorage?: number;
  userId?: string;
}

// ========================================
// WEBSOCKET EVENTS
// ========================================

/**
 * The dictionary to all the talk between http and WebSocket
 * used by -> device.events.ts
 */
export enum DeviceEvent {
  // Client -> Server
  REGISTER = 'device:register',
  PING = 'device:ping',
  DISCONNECT = 'disconnect',
  STORAGE_UPDATE = 'device:storage:update',
  
  // Server -> Client
  REGISTERED = 'device:registered',
  PONG = 'device:pong',
  STATUS_UPDATE = 'device:status:update',
  CHUNK_ASSIGNED = 'device:chunk:assigned',
  CHUNK_DELETE = 'device:chunk:delete',
}