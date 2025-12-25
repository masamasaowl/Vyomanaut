import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { DeviceEarnings, EarningsBreakdown, SystemPaymentStats } from '../../types/payment.types';

/**
 * Earnings Calculation Service
 * 
 * Responsibilities:
 * 1. Calculate earnings for devices
 * 2. Track earnings history
 * 3. Generate payment reports
 * 4. Update earnings in real-time
 */
class EarningsService {
  
  // Rate: $ per GB per hour (from config)
  private readonly RATE_PER_GB_HOUR = config.pricing.storageRatePerGBHour;
  

  // ========================================
  // Calculation of Earnings
  // ========================================

  /**
   * Calculate current earnings for a device
   * 
   * Simple Flow:
   * 1. Get all chunks stored on this device
   * 2. For each chunk, calculate: hours × GB × rate
   * 3. Sum up total earnings
   * 4. Update Device.totalEarnings
   */
  async calculateDeviceEarnings(deviceId: string): Promise<DeviceEarnings> {
    
    console.log(`💰 Calculating earnings for device ${deviceId}`);
    
    // Step 1: Get device via ID
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    // Step 2: Get all chunks stored on this device
    const chunkLocations = await prisma.chunkLocation.findMany({
      where: { 
        deviceId,
        // We only consider healthy chunks 
        isHealthy: true, 
      },
      include: {
        chunk: {

          // Also include the file which the chunk belongs to 
          include: {
            file: {
              select: {
                id: true,
                originalName: true,
              },
            },
          },
        },
      },
    });
    
    console.log(`  Found ${chunkLocations.length} chunks to calculate earnings for`);
    

    // Step 3: Calculate earnings for each chunk
    // This array contains all information necessary to calculate earnings
    const breakdown: EarningsBreakdown[] = [];
    let totalNewEarnings = 0;
    
    // Note the time
    const now = new Date();
    
    // For one single chunk
    for (const location of chunkLocations) {
      
      // When did we last calculate earnings for this chunk?
      // Important because we only pay for the new time elapsed
      const lastUpdate = location.lastEarningsUpdate;
      
      // How many hours since last update?
      const hoursSinceLastUpdate = this.calculateHoursDifference(lastUpdate, now);
      
      // How big is this chunk? (convert bytes to GB)
      const sizeGB = location.chunk.sizeBytes / (1024 * 1024 * 1024);
      
      // Calculate earnings for this period
      // Formula: earnings = storage_GB × uptime_hours × rate
      const earned = sizeGB * hoursSinceLastUpdate * this.RATE_PER_GB_HOUR;
      
      // Add to array 
      // This would be useful in creating dashboards
      breakdown.push({
        chunkId: location.chunkId,
        fileId: location.chunk.fileId,
        fileName: location.chunk.file.originalName,
        sizeGB,
        hoursStored: hoursSinceLastUpdate,
        ratePerGBHour: this.RATE_PER_GB_HOUR,
        earned,
        storedSince: location.createdAt,
        lastVerified: location.lastVerified || location.createdAt,
      });
      

      // How much did you earn for this chunk
      // This keeps on increasing for every chunk device has stored
      totalNewEarnings += earned;
      
      // Step 4: Update ChunkLocation with new earnings
      await prisma.chunkLocation.update({
        where: { id: location.id },
        data: {
          // Update time elapsed to -> now 
          lastEarningsUpdate: now,

          // Update the earnings this single chunk caused the user
          totalEarnings: {
            increment: earned,
          },
        },
      });
    }
    

    // Step 5: Update device's total earnings for all the chunks it has 
    const updatedDevice = await prisma.device.update({
      where: { id: deviceId },
      data: {
        // Lifetime earnings
        totalEarnings: {
          increment: totalNewEarnings,
        },

        // Pending Earnings change as user withdraws his sum
        pendingEarnings: {
          increment: totalNewEarnings,
        },
      },
    });
    
    console.log(`  ✅ Device earned $${totalNewEarnings.toFixed(6)} this period`);
    console.log(`  💎 Total lifetime earnings: $${Number(updatedDevice.totalEarnings).toFixed(6)}`);
    

    // Step 5: Calculate metrics to sort the devices 
    // How much did you store
    const totalGBStored = breakdown.reduce((sum, b) => sum + b.sizeGB, 0);

    // How much did we pay you in average
    const avgEarningsPerGB = totalGBStored > 0 
      ? Number(updatedDevice.totalEarnings) / totalGBStored 
      : 0;
    

    // Step 6: Get this month and last month earnings
    const thisMonth = await this.getMonthlyEarnings(deviceId, new Date());

    // Simple extract the year and current month - 1
    // Hand it to over to get monthly earnings from DB
    const lastMonth = await this.getMonthlyEarnings(
      deviceId, 
      new Date(now.getFullYear(), now.getMonth() - 1)
    );
    
    // Return this crucial data
    return {
      deviceId: device.deviceId,
      totalEarnings: Number(updatedDevice.totalEarnings),
      thisMonth,
      lastMonth,
      breakdown,
      stats: {
        totalGBStored,
        totalHoursOnline: Number(device.totalUptime) / (1000 * 60 * 60),
        chunksStored: breakdown.length,
        avgEarningsPerGB,
      },
    };
  }
  

  /**
   * Update earnings for ALL devices
   * 
   * This is run as a background job (every two days)
   * This is used by the earnings.worker.ts
   */
  async updateAllDeviceEarnings(): Promise<{
    devicesUpdated: number;
    totalEarningsDistributed: number;
  }> {
    
    console.log('💰 Starting earnings update for all devices...');
    
    // Get all devices with chunks
    const devices = await prisma.device.findMany({
      where: {
        // We only pay online devices
        status: 'ONLINE', 

        // They need to have at least one chunk
        chunks: {
          some: {}, 
        },
      },
    });
    
    console.log(` Found ${devices.length} devices to update`);
    
    let totalEarningsDistributed = 0;
    
    // Calculate earnings for each device
    for (const device of devices) {
      try {

        // Extract the earnings for this month
        const earnings = await this.calculateDeviceEarnings(device.id);

        // Add to the earnings we have distributed
        totalEarningsDistributed += earnings.thisMonth;
        
      } catch (error) {
        console.error(`  ❌ Failed to calculate earnings for ${device.deviceId}:`, error);
      }
    }
    
    console.log(`✅ Earnings update complete: $${totalEarningsDistributed.toFixed(2)} distributed`);
    
    // Return update device earnings check: success
    return {
      devicesUpdated: devices.length,
      totalEarningsDistributed,
    };
  }
  

  // ========================================
  // Calculation of Stats
  // ========================================

  /**
   * Get monthly earnings for a device
   * 
   * Note: Monthly earnings are read not calculated here
   * Used for "this month" vs "last month" comparison
   */
  private async getMonthlyEarnings(
    deviceId: string,
    date: Date
  ): Promise<number> {
    
    // Convert Date to 
    // Format: "2024-12" for December 2024
    // For ease in DB audits
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    // Try to get existing record based in ID and Period
    const record = await prisma.earningRecord.findFirst({
      where: {
        deviceId,
        period,
      },
    });
    
    // If the device is detected return his earnings stored in DB
    return record ? Number(record.earned) : 0;
  }
  

  /**
   * Record monthly earnings (called at end of each month)
   * 
   * This creates a permanent record of monthly earnings
   */
  async recordMonthlyEarnings(deviceId: string): Promise<void> {
    
    // What is the time right now()
    const now = new Date();

    // Convert to format 
    // 2024-12
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // Get device via ID
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    
    if (!device) return;
    

    // Fetch devices where chunks are stored
    const chunkLocations = await prisma.chunkLocation.findMany({

      // The chunk must be in good health
      where: { deviceId, isHealthy: true },
      include: { chunk: true },
    });
    
    // Update the total storage of chunks device gives
    // We convert chunk size in Bytes to GB
    // Start sum by 0 and continue adding new GB chunk sizes to get total storage
    const storageGB = chunkLocations.reduce(
      (sum, loc) => sum + (loc.chunk.sizeBytes / (1024 * 1024 * 1024)),
      0
    );
    
    // Track uptime
    const hoursOnline = Number(device.totalUptime) / (1000 * 60 * 60);
    
    // Create or update monthly record
    await prisma.earningRecord.upsert({
      where: {
        id: deviceId,
        period
      },
      update: {
        storageGB,
        hoursOnline,
        earned: device.pendingEarnings,
      },

      // Is this your first pay?
      create: {
        deviceId,
        period,
        storageGB,
        hoursOnline,
        earned: device.pendingEarnings,
      },
    });
    

    // Reset pending earnings for new month
    // As we distribute our sum at the very end of the month
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        pendingEarnings: 0,
        lastPaymentAt: now,
      },
    });
    
    console.log(`📅 Monthly earnings recorded for device ${device.deviceId}: $${Number(device.pendingEarnings).toFixed(6)}`);
  }
  

  /**
   * Get system-wide payment statistics
   * 
   * For admin dashboard and analytics
   */
  async getSystemPaymentStats(): Promise<SystemPaymentStats> {
    
    // Instead of pulling each device and doing the calculations
    // We ask DB to Aggregate all device earnings
    const aggregation = await prisma.device.aggregate({
      // Add up all the earnings 
      _sum: {
        totalEarnings: true,
        pendingEarnings: true,
      },

      // Count how many ID's it traversed
      _count: {
        id: true,
      },
    });
    
    // Extract the aggregation data
    const totalEarningsPaid = Number(aggregation._sum.totalEarnings || 0);
    const pendingEarnings = Number(aggregation._sum.pendingEarnings || 0);
    const devicesEarning = aggregation._count.id;

    // How much on average do we pay each device
    const avgEarningsPerDevice = devicesEarning > 0 
      ? totalEarningsPaid / devicesEarning 
      : 0;
    

    // Get top earners
    const topEarners = await prisma.device.findMany({
      // descending order in Earnings
      orderBy: {
        totalEarnings: 'desc',
      },

      // Only top 10
      take: 10,
      // Make sure they earn
      select: {
        deviceId: true,
        totalEarnings: true,
      },
    });
    
    return {
      totalEarningsPaid,
      pendingEarnings,
      devicesEarning,
      avgEarningsPerDevice,
      topEarners: topEarners.map(d => ({
        deviceId: d.deviceId,
        earnings: Number(d.totalEarnings),
      })),
    };
  }
  

  // ========================================
  // Earnings Comparison
  // ========================================
  // They are test methods for now


  /**
   * TEST METHOD FOR NOW
   * 
   * Calculate potential earnings (for new users)
   * 
   * Shows: "If you contribute 10GB for 30 days, you'll earn $X"
   */
  // calculatePotentialEarnings(storageGB: number, days: number = 30): {
  //   daily: number;
  //   monthly: number;
  //   yearly: number;
  // } {
  //   const hoursPerDay = 24;
  //   const hoursPerMonth = 24 * 30;
  //   const hoursPerYear = 24 * 365;
    
  //   return {
  //     daily: storageGB * hoursPerDay * this.RATE_PER_GB_HOUR,
  //     monthly: storageGB * hoursPerMonth * this.RATE_PER_GB_HOUR,
  //     yearly: storageGB * hoursPerYear * this.RATE_PER_GB_HOUR,
  //   };
  // }
  

  /**
   * Compare earnings with AWS costs
   * 
   * For marketing: "We pay you $X, AWS charges $Y"
   */
  // compareWithAWS(storageGB: number, days: number = 30): {
  //   userEarnings: number;
  //   awsGlacierCost: number;
  //   awsS3Cost: number;
  //   savings: number;
  // } {
  //   const hoursPerMonth = 24 * days;
  //   const userEarnings = storageGB * hoursPerMonth * this.RATE_PER_GB_HOUR;
    
  //   // AWS Glacier: ~$1/TB/month = $0.001/GB/month
  //   const awsGlacierCost = storageGB * 0.001 * (days / 30);
    
  //   // AWS S3: ~$23/TB/month = $0.023/GB/month
  //   const awsS3Cost = storageGB * 0.023 * (days / 30);
    
  //   return {
  //     userEarnings,
  //     awsGlacierCost,
  //     awsS3Cost,
  //     savings: awsS3Cost - (userEarnings * 3), // We pay 3 users per chunk
  //   };
  // }
  



  // ========================================
  // Utilities
  // ========================================
  
  /**
   * Calculate hours difference between two dates
   */
  private calculateHoursDifference(start: Date, end: Date): number {

    // The difference
    const diffMs = end.getTime() - start.getTime();
    // Convert ms to hours
    return diffMs / (1000 * 60 * 60); 
  }
  
  /**
   * Format earnings for display
   */
  formatEarnings(amount: number): string {

    // Only till 6 decimal places
    return `$${amount.toFixed(6)}`;
  }
}

export const earningsService = new EarningsService();
