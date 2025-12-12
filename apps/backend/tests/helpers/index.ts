import { DeviceType } from '@prisma/client';
import { DeviceRegistrationPayload } from '../../src/types/device.types';

/**
 * Test Helpers
 * 
 * Reusable utilities for creating test data
 * We generate fake data instead of rewriting the same logic again and again
 */


/**
 * Generate a unique device ID for testing
 * eg: test-device-1700000000000-abcd3f
 */
export function generateDeviceId(): string {
  return `test-device-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generate a unique user ID for testing
 * eg: test-user-1450000000000-ad3f56778

 */
export function generateUserId(): string {
  return `test-user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}


/**
 * Create a fake device registration request (payload) that looks genuine 
 * 
 * Usage:
 * const payload = createMockDevicePayload();
 * const customPayload = createMockDevicePayload({ totalStorageBytes: 5GB });
 * 
 * eg: {
  "deviceId": "...",
  "deviceType": "ANDROID",
  "userId": "...",
  "totalStorageBytes": 10000000000,
  "model": "Samsung X",
  "osVersion": "Android 14",
  "appVersion": "2.0.1"
}
 */
export function createMockDevicePayload(
  overrides?: Partial<DeviceRegistrationPayload>
): DeviceRegistrationPayload {
  return {
    deviceId: generateDeviceId(),
    deviceType: DeviceType.ANDROID,
    userId: generateUserId(),
    totalStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB default
    model: 'Test Device Model',
    osVersion: 'Test OS 1.0',
    appVersion: '1.0.0',
    ...overrides,
  };
}

/**
 * Wait for a specified time (useful for testing timeouts)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * Create multiple mock device payloads
 * meaning many fake devices at once
 */
export function createMockDevices(count: number): DeviceRegistrationPayload[] {
  return Array.from({ length: count }, () => createMockDevicePayload());
}


// ========================================
// HELPERS    
// ========================================
/**
 * Storage size helpers (for readability in tests)
 * We turn 
 * totalStorageBytes: 1073741824,
 * into 
 * totalStorageBytes: STORAGE.GB(1),
 */
export const STORAGE = {
  MB: (n: number) => n * 1024 * 1024,
  GB: (n: number) => n * 1024 * 1024 * 1024,
};

/**
 * Time helpers (for readability in tests)
 * 
 * Turn this
 * await sleep(2000);
 * into 
 * await sleep(TIME.SECONDS(2));
 */
export const TIME = {
  SECONDS: (n: number) => n * 1000,
  MINUTES: (n: number) => n * 60 * 1000,
  HOURS: (n: number) => n * 60 * 60 * 1000,
};

// Re-export file helpers to use everywhere
export * from './fileHelper';