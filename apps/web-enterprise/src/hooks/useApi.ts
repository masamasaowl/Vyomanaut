import useSWR, { mutate } from 'swr';
import { fileAPI, deviceAPI, paymentAPI } from '@/lib/api';
import type {
  FileListResponse,
  FileStats,
  FileDetails,
  ChunkMetadata,
  DeviceStats,
  Device,
  DeviceHealth,
  SystemPaymentStats,
} from '@/types';

/**
 * DATA FETCHING HOOKS
 *
 * All the hooks use our API calling them using SWR eliminating useEffects
 * 
 * Features:
 * ( SWR implements)
 * - Automatic caching 
 * - Revalidation on focus
 * - Deduplication
 * - Error retry
 * - Loading states
 */

// ===================================
// FILE HOOKS (using the fileAPI)
// ===================================
 
/**
 * Fetch all the files of the user 
 * 
 * @param filters 
 * @returns- File list and file count 
 *  combined with the SWR isLoading & error states, *  also with a mutate function
 */
export function useFiles(filters?: { status?: string }) {

  // The SWR call
  const { data, error, isLoading } = useSWR<FileListResponse>(

    // uniquely identified the URL and the filters
    ['/api/files', filters],

    // The fetcher, he calls our backend for the file list
    () => fileAPI.list(filters),
    {
      // Refresh on tab switching  
      revalidateOnFocus: true,
      // Refresh when browser reopens
      revalidateOnReconnect: true,

      // only one request allowed per 5s
      dedupingInterval: 5000,
    }
  );
  
  return {
    // The files and their count returned by the API
    files: data?.files || [],
    count: data?.count || 0,

    // The loading state
    isLoading,
    // The error state
    isError: error,

    // This can be used to manually refresh the data
    // It directly calls api/files for refreshing the data 
    mutate: () => mutate(['/api/files', filters]),
  };
}

/**
 * Fetch a single file 
 * 
 * @param fileId 
 * @returns file data
 */
export function useFile(fileId: string) {
  const { data, error, isLoading } = useSWR<{ success: boolean; file: FileDetails }>(
    `/api/files/${fileId}`,
    () => fileAPI.get(fileId),
    {
      revalidateOnFocus: false,
    }
  );
  
  return {
    file: data?.file,
    isLoading,
    isError: error,
    mutate: () => mutate(`/api/files/${fileId}`),
  };
}

/**
 * To fetch all the chunk of a file 
 * 
 * @param fileId 
 * @returns -> the chunk list and count 
 */
export function useFileChunks(fileId: string) {
  const { data, error, isLoading } = useSWR<{ success: boolean; chunks: ChunkMetadata[]; count: number }>(
    `/api/files/${fileId}/chunks` ,
    () => fileAPI.getChunks(fileId),
    {

      // Refresh every 30s to see replication progress
      refreshInterval: 30000, 
    }
  );
  
  return {
    chunks: data?.chunks || [],
    count: data?.count || 0,
    isLoading,
    isError: error,
    mutate: () => mutate(`/api/files/${fileId}/chunks`),
  };
}

/**
 * Check the stats of the file
 */
export function useFileStats() {
  const { data, error, isLoading } = useSWR<{ success: boolean; stats: FileStats }>(
    '/api/files/stats',
    () => fileAPI.stats(),
    {
      revalidateOnFocus: true,
    }
  );
  
  return {
    stats: data?.stats,
    isLoading,
    isError: error,
    mutate: () => mutate('/api/files/stats'),
  };
}

// ===================================
// DEVICE HOOKS
// ===================================

/**
 * Fetch the devices based on filters
 * - status
 * - reliability
 * - storage
 * @param filters 
 * @returns 
 */
export function useDevices(filters?: {
  status?: string;
  minReliability?: number;
  minStorage?: number;
}) {
  const { data, error, isLoading } = useSWR<{ success: boolean; devices: Device[]; count: number }>(
    ['/api/devices', filters],
    () => deviceAPI.list(filters),
    {
      revalidateOnFocus: true,
      // Refresh every 30s as device stats keep changing frequently
      refreshInterval: 30000, 
    }
  );
  
  return {
    devices: data?.devices || [],
    count: data?.count || 0,
    isLoading,
    isError: error,
    mutate: () => mutate(['/api/devices', filters]),
  };
}

/**
 * To fetch a single device based on ID
 * @param deviceId 
 * @returns The device information
 */
export function useDevice(deviceId: string) {
  const { data, error, isLoading } = useSWR<{ success: boolean; device: Device }>(
    `/api/devices/${deviceId}`,
    () => deviceAPI.get(deviceId)
  );
  
  return {
    device: data?.device,
    isLoading,
    isError: error,
    mutate: () => mutate(`/api/devices/${deviceId}`),
  };
}


/**
 * Check health of device based on deviceID
 * @param deviceId  
 */
export function useDeviceHealth(deviceId: string) {
  const { data, error, isLoading } = useSWR<{ success: boolean; health: DeviceHealth }>(
    deviceId ? `/api/devices/${deviceId}/health` : null,
    () => deviceAPI.getHealth(deviceId)
  );
  
  return {
    health: data?.health,
    isLoading,
    isError: error,
    mutate: () => mutate(`/api/devices/${deviceId}/health`),
  };
}

/**
 * Check stats of all the devices connected to us
 */
export function useDeviceStats() {
  const { data, error, isLoading } = useSWR<{ success: boolean; stats: DeviceStats }>(
    '/api/devices/stats',
    () => deviceAPI.stats(),
    {
      refreshInterval: 30000, // Refresh every 30s
    }
  );
  
  return {
    stats: data?.stats,
    isLoading,
    isError: error,
    mutate: () => mutate('/api/devices/stats'),
  };
}

// ===================================
// PAYMENT HOOKS
// ===================================

/**
 * Check the payment details of the entire platform
 * @returns The payment stats
 */
export function useSystemPayments() {
  const { data, error, isLoading } = useSWR<{ success: boolean; stats: SystemPaymentStats }>(
    '/api/payments/stats',
    () => paymentAPI.getSystemStats(),
    {
      revalidateOnFocus: true,
    }
  );
  
  return {
    stats: data?.stats,
    isLoading,
    isError: error,
    mutate: () => mutate('/api/payments/stats'),
  };
}

// ===================================
// UTILITY FUNCTIONS
// ===================================

// These functions enable us to control the SWR caching and refreshing on call

/**
 * Manually trigger refresh
 */
export function revalidateAll() {
  mutate(() => true);
}

/**
 * Clear all cache manually 
 */
export function clearCache() {
  mutate(() => true, undefined, { revalidate: false });
}