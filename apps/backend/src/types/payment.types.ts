// Payment types

/**
 * Used to calculate earnings per chunk
 */
export interface EarningsBreakdown {
  chunkId: string;
  fileId: string;
  fileName: string;
  sizeGB: number;
  hoursStored: number;
  ratePerGBHour: number;
  earned: number;
  storedSince: Date;
  lastVerified: Date;
}

/**
 * Calculate earnings of entire device
 */
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

/**
 * To track payments of the entire backend
 */
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
