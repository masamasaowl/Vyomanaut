/**
 * Type definitions matching backend API responses
 * These would help us maintain consistency in the types between the two
 */


// ===================================
// AUTH TYPES
// ===================================

export interface User {
  id: string;
  email: string;
  role: 'USER' | 'COMPANY' | 'ADMIN';
  name?: string;
}

export interface AuthResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  user: User;
}

// ===================================
// FILE TYPES
// ===================================

export type FileStatus = 'UPLOADING' | 'ACTIVE' | 'DEGRADED' | 'DELETED';
export type ChunkStatus = 'PENDING' | 'REPLICATING' | 'HEALTHY' | 'DEGRADED' | 'LOST';

export interface FileMetadata {
  id: string;
  originalName: string;
  sizeBytes: number;
  sizeMB: string;
  mimeType: string;
  chunkCount: number;
  status: FileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FileDetails extends FileMetadata {
  companyId: string;
  encryptionKey: string;
  checksum: string;
}

export interface ChunkMetadata {
  id: string;
  sequenceNum: number;
  sizeBytes: number;
  sizeKB: string;
  status: ChunkStatus;
  currentReplicas: number;
  targetReplicas: number;
  createdAt: string;
}

export interface FileUploadResponse {
  success: boolean;
  file: FileMetadata;
  message: string;
}

export interface FileListResponse {
  success: boolean;
  count: number;
  files: FileMetadata[];
}

export interface FileStats {
  totalFiles: number;
  totalSizeBytes: number;
  totalSizeGB: string;
  activeFiles: number;
  totalChunks: number;
}

// ===================================
// DEVICE TYPES
// ===================================

export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'SUSPENDED';
export type DeviceType = 'ANDROID' | 'IOS' | 'DESKTOP' | 'MACOS' | 'LINUX';

export interface Device {
  id: string;
  deviceId: string;
  deviceType: DeviceType;
  status: DeviceStatus;
  totalStorageBytes: number;
  availableStorageBytes: number;
  availableStorageGB: string;
  reliabilityScore: number;
  lastSeenAt: string;
  totalEarnings: string;
  createdAt: string;
}

export interface DeviceHealth {
  deviceId: string;
  isOnline: boolean;
  reliabilityScore: number;
  uptimePercentage: number;
  consecutiveDowntimeHours: string;
  lastSeenAt: string;
}

export interface DeviceStats {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  totalStorageGB: string;
  averageReliability: string;
}

// ===================================
// PAYMENT TYPES
// ===================================

export interface EarningsBreakdown {
  chunkId: string;
  fileId: string;
  fileName: string;
  sizeGB: number;
  hoursStored: number;
  ratePerGBHour: number;
  earned: number;
  storedSince: string;
  lastVerified: string;
}

export interface DeviceEarnings {
  deviceId: string;
  totalEarnings: number;
  thisMonth: number;
  lastMonth: number;
  breakdown: EarningsBreakdown[];
  stats: {
    totalGBStored: number;
    totalHoursOnline: number;
    chunksStored: number;
    avgEarningsPerGB: number;
  };
}

export interface SystemPaymentStats {
  totalEarningsPaid: number;
  pendingEarnings: number;
  devicesEarning: number;
  avgEarningsPerDevice: number;
  topEarners: Array<{
    deviceId: string;
    earnings: number;
  }>;
}

// ===================================
// API RESPONSE TYPES
// ===================================

export interface ApiError {
  success: false;
  error: string;
}

export interface ApiSuccess<T = any> {
  success: true;
  data?: T;
  message?: string;
}

export interface HealthCheck {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
}