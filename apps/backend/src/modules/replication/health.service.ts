import { prisma } from '../../config/database';
import { ChunkStatus, DeviceStatus } from '@prisma/client';
import { healingQueue } from '../../config/queue';

/**
 * Health Monitoring Service
 * 
 * 
 * Responsibilities:
 * - Detect degraded chunks (below redundancy target)
 * - Detect offline devices with chunks
 * - Trigger healing jobs
 * - Monitor system health
 * 
 * Think of it as the "early warning system" for data integrity!
 */


// Define type for the health of chunk
interface ChunkHealthStatus {
  chunkId: string;
  fileId: string;
  sequenceNum: number;
  currentReplicas: number;
  targetReplicas: number;
  healthyReplicas: number;
  status: ChunkStatus;
  needsHealing: boolean;
}

class HealthMonitoringService {
  

  // ========================================
  // 🏥Heal Degraded chunks
  // ========================================

  // 1. Check all chunks
  // 2. Check chunks of a file 
  // 3. Heal chunks of a file that went offline

  /**
   * Every 1 hour -> We scan all the chunks
   * 
   * This is the "main health scan" - checks every chunk
   * called by healthScheduler.ts
   * 
   * @returns Array of chunks that need healing
   */
  async scanAllChunks(): Promise<ChunkHealthStatus[]> {

    console.log('🏥 Starting system-wide health scan...');
    
    // Get all chunks with their locations
    const chunks = await prisma.chunk.findMany({
      where: {
        status: {
          in: [ChunkStatus.REPLICATING, ChunkStatus.HEALTHY, ChunkStatus.DEGRADED],
        },
      },
      include: {
        locations: {
          include: {
            device: true,
          },
        },
      },
    });
    

    // Store all chunks health status for reference 
    const healthStatuses: ChunkHealthStatus[] = [];
    
    for (const chunk of chunks) {
      // Count healthy replicas (device is online AND location is healthy)
      const healthyReplicas = chunk.locations.filter(
        loc => loc.isHealthy && loc.device.status === DeviceStatus.ONLINE
      ).length;
      
      // Does it need to have extra copies made
      const needsHealing = healthyReplicas < chunk.targetReplicas;
      
      // Push entire health status
      healthStatuses.push({
        chunkId: chunk.id,
        fileId: chunk.fileId,
        sequenceNum: chunk.sequenceNum,
        currentReplicas: chunk.currentReplicas,
        targetReplicas: chunk.targetReplicas,
        healthyReplicas,
        status: chunk.status,
        needsHealing,
      });
      
      // If needs healing, queue a healing job
      if (needsHealing) {
        await this.queueChunkHealing(chunk.id, healthyReplicas, chunk.targetReplicas);
      }
    }
    
    const needsHealingCount = healthStatuses.filter(s => s.needsHealing).length;
    console.log(`✅ Health scan complete: ${needsHealingCount}/${chunks.length} chunks need healing`);
    
    return healthStatuses;
  }
  

  /**
   * Check health of chunks for a specific file
   * 
   * Called when:
   * - File is uploaded (verify all chunks distributed)
   * - Company requests file download (ensure available)
   * - Background job runs periodic checks
   */
  async checkFileHealth(fileId: string): Promise<ChunkHealthStatus[]> {

    console.log(`🔍 Checking health of file ${fileId}...`);
    
    // Find chunks of a single file in sequence 
    const chunks = await prisma.chunk.findMany({
      where: { fileId },
      include: {
        locations: {
          include: {
            device: true,
          },
        },
      },
      orderBy: { sequenceNum: 'asc' },
    });
    

    // Has the same logic as scanAllChunks()
    const healthStatuses: ChunkHealthStatus[] = [];
    
    for (const chunk of chunks) {
      const healthyReplicas = chunk.locations.filter(
        loc => loc.isHealthy && loc.device.status === DeviceStatus.ONLINE
      ).length;
      
      const needsHealing = healthyReplicas < chunk.targetReplicas;
      
      healthStatuses.push({
        chunkId: chunk.id,
        fileId: chunk.fileId,
        sequenceNum: chunk.sequenceNum,
        currentReplicas: chunk.currentReplicas,
        targetReplicas: chunk.targetReplicas,
        healthyReplicas,
        status: chunk.status,
        needsHealing,
      });
      
      if (needsHealing) {
        await this.queueChunkHealing(chunk.id, healthyReplicas, chunk.targetReplicas);
      }
    }
    
    return healthStatuses;
  }
  

  /**
   * Detect chunks affected by a device going offline
   * 
   * Called when:
   * - Device disconnects
   * - Device marked offline by heartbeat monitor
   * 
   * This is CRITICAL - we need to immediately identify which chunks
   * lost a replica and may need re-replication!
   */
  async detectAffectedChunks(deviceId: string): Promise<string[]> {

    console.log(`🚨 Detecting chunks affected by device ${deviceId} going offline...`);
    
    // Find all chunk locations for this device
    const locations = await prisma.chunkLocation.findMany({
      where: { deviceId },
      include: {
        chunk: true,
      },
    });

    // These are the chunks which need replication
    const affectedChunkIds: string[] = [];
    
    for (const location of locations) {

      // Mark location as unhealthy
      await prisma.chunkLocation.update({
        where: { id: location.id },
        data: { isHealthy: false },
      });
      
      // Count remaining healthy replicas for this chunk, based on device status
      const healthyReplicas = await prisma.chunkLocation.count({
        where: {
          chunkId: location.chunkId,
          isHealthy: true,
          device: {
            status: DeviceStatus.ONLINE,
          },
        },
      });
      
      // Is the target replicas not met
      if (healthyReplicas < location.chunk.targetReplicas) {
        affectedChunkIds.push(location.chunkId);
        
        // Create new replicas
        await this.queueChunkHealing(
          location.chunkId,
          healthyReplicas,
          location.chunk.targetReplicas
        );
        
        // Update chunk status
        await prisma.chunk.update({
          where: { id: location.chunkId },
          data: {

            // If no healthy replicas remain, mark it as Lost or degraded
            status: healthyReplicas === 0 ? ChunkStatus.LOST : ChunkStatus.DEGRADED,
            currentReplicas: healthyReplicas,
          },
        });
      }
    }
    
    console.log(`  ⚠️ ${affectedChunkIds.length} chunks affected by device offline`);
    
    // These were the chunks stored on the device that went offline
    return affectedChunkIds;
  }
  

  // ========================================
  // UTILITIES 
  // ========================================

  /**
   * Queue a chunk healing job
   * 
   * This adds a job to Bull queue for the healing worker to process
   * 
   * Priority levels:
   * - Critical (0 replicas): Priority 1
   * - Degraded (1-2 replicas): Priority 2
   * - Maintenance (just health check): Priority 3
   */
  private async queueChunkHealing(
    chunkId: string,
    currentReplicas: number,
    targetReplicas: number
  ): Promise<void> {
    // Calculate priority based on severity
    let priority = 3; // Default: low priority
    
    if (currentReplicas === 0) {
      priority = 1; // CRITICAL: No replicas left!
    } else if (currentReplicas < targetReplicas / 2) {
      priority = 2; // HIGH: Below 50% of target
    }
    
    await healingQueue.add(
      'heal-chunk',
      {
        chunkId,
        currentReplicas,
        targetReplicas,
        timestamp: Date.now(),
      },
      {
        priority,
        attempts: 5, // We try harder for critical chunks
        backoff: {
          type: 'exponential',
          delay: priority === 1 ? 2000 : 5000, // Faster retry for critical
        },
      }
    );
    
    console.log(`  📋 Queued healing job for chunk ${chunkId} (priority: ${priority})`);
  }
  
  /**
   * Get system health summary
   * 
   * Returns high-level metrics about chunk health
   * Used for dashboard and monitoring
   */
  async getSystemHealthSummary(): Promise<{
    totalChunks: number;
    healthyChunks: number;
    degradedChunks: number;
    criticalChunks: number;
    lostChunks: number;
    healthPercentage: number;
  }> {

    const chunks = await prisma.chunk.groupBy({
      by: ['status'],
      // Get the total chunks also
      _count: true,
    });
    
    let totalChunks = 0;
    let healthyChunks = 0;
    let degradedChunks = 0;
    let criticalChunks = 0;
    let lostChunks = 0;
    
    // For every chunk we extract its status info
    chunks.forEach(group => {
      totalChunks += group._count;
      
      // If you are healthy we increase your count
      switch (group.status) {
        case ChunkStatus.HEALTHY:
          healthyChunks += group._count;
          break;
        case ChunkStatus.DEGRADED:
          degradedChunks += group._count;
          break;
        case ChunkStatus.LOST:
          lostChunks += group._count;
          break;
        case ChunkStatus.REPLICATING:
          criticalChunks += group._count;
          break;
      }
    });
    
    // A percentage of the healthy chunks stored
    const healthPercentage = totalChunks > 0 
      ? Math.round((healthyChunks / totalChunks) * 100) 
      : 100;
    
    // We return the status numbers of all the chunks  
    return {
      totalChunks,
      healthyChunks,
      degradedChunks,
      criticalChunks,
      lostChunks,
      healthPercentage,
    };
  }
  

  /**
   * Check if a file is fully available for download
   * 
   * Returns true only if ALL chunks have at least 1 healthy replica
   */
  async isFileAvailable(fileId: string): Promise<boolean> {
    const healthStatuses = await this.checkFileHealth(fileId);
    
    // File is available if every chunk has at least 1 healthy replica
    return healthStatuses.every(status => status.healthyReplicas > 0);
  }
}

export const healthMonitoringService = new HealthMonitoringService();