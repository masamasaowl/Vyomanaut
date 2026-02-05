import { Job } from 'bull';
import { healingQueue } from '../config/queue';
import { chunkAssignmentService } from '../modules/chunks/assignment.service';
import { prisma } from '../config/database';
import { ChunkStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { ChunkError, safeAsync } from '../utils/errorHandler';

/**
 * OPTIMIZED Healing Worker
 * 
 * NEW FEATURES:
 * 1. Comprehensive logging at each step
 * 2. Error boundaries (won't crash on failure)
 * 3. Metrics tracking (healing success rate)
 * 4. Health reporting
 * 5. Graceful degradation
 * 
 * Purpose:
 * - Automatically repair chunks that fall below redundancy
 * - Triggered when devices go offline
 * - Ensures data durability
 */

interface HealChunkJobData {
  chunkId: string;
  currentReplicas: number;
  targetReplicas: number;
  timestamp: number;
  reason?: 'DEVICE_OFFLINE' | 'DEGRADED' | 'SCHEDULED_SCAN';
}

// Track healing metrics
const healingMetrics = {
  totalJobs: 0,
  successfulHeals: 0,
  failedHeals: 0,
  chunksHealed: new Set<string>(),
  lastHealTime: Date.now(),
};

/**
 * Process a healing job
 * 
 * Algorithm:
 * 1. Verify chunk still needs healing (might have recovered)
 * 2. Count current healthy replicas
 * 3. Calculate needed replicas
 * 4. Re-assign chunk to new devices
 * 5. Verify healing succeeded
 * 6. Update chunk status
 */
async function processHealChunkJob(job: Job<HealChunkJobData>): Promise<void> {
  const { chunkId, currentReplicas, targetReplicas, reason } = job.data;
  
  logger.info('Starting chunk healing job', {
    jobId: job.id,
    chunkId,
    currentReplicas,
    targetReplicas,
    reason: reason || 'UNKNOWN',
    priority: job.opts.priority
  });
  
  healingMetrics.totalJobs++;
  
  try {
    // STEP 1: Get current chunk state
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
      include: {
        locations: {
          include: {
            device: true,
          },
        },
        file: {
          select: {
            id: true,
            originalName: true,
          }
        }
      },
    });
    
    if (!chunk) {
      logger.error('Chunk not found during healing', { chunkId });
      throw new ChunkError('Chunk not found', chunkId);
    }
    
    logger.debug('Chunk state retrieved', {
      chunkId,
      fileId: chunk.fileId,
      fileName: chunk.file.originalName,
      currentStatus: chunk.status,
      locationCount: chunk.locations.length
    });
    
    // STEP 2: Count healthy replicas (status might have changed!)
    const healthyReplicas = chunk.locations.filter(
      loc => loc.isHealthy && loc.device.status === 'ONLINE'
    ).length;
    
    logger.info('Current replica health', {
      chunkId,
      healthyReplicas,
      targetReplicas,
      totalLocations: chunk.locations.length
    });
    
    // STEP 3: Check if healing is still needed
    if (healthyReplicas >= targetReplicas) {
      logger.info('Chunk already healed - skipping', {
        chunkId,
        healthyReplicas,
        targetReplicas
      });
      
      // Update status to HEALTHY
      await prisma.chunk.update({
        where: { id: chunkId },
        data: {
          status: ChunkStatus.HEALTHY,
          currentReplicas: healthyReplicas,
        },
      });
      
      return;
    }
    
    // STEP 4: Calculate needed replicas
    const neededReplicas = targetReplicas - healthyReplicas;
    
    logger.info('Healing required', {
      chunkId,
      neededReplicas,
      healthyReplicas,
      targetReplicas
    });
    
    // STEP 5: Critical check - do we have ANY healthy replicas?
    if (healthyReplicas === 0) {
      logger.error('CRITICAL: Chunk has NO healthy replicas!', {
        chunkId,
        fileId: chunk.fileId,
        fileName: chunk.file.originalName,
        status: chunk.status
      });
      
      // Mark as LOST
      await prisma.chunk.update({
        where: { id: chunkId },
        data: { status: ChunkStatus.LOST },
      });
      
      // TODO: Alert administrators
      // This means data is UNRECOVERABLE
      
      throw new ChunkError('Chunk has no healthy replicas - DATA LOST', chunkId, {
        fileId: chunk.fileId
      });
    }
    
    // STEP 6: Re-assign chunk to new devices
    logger.info('Re-assigning chunk to new devices', {
      chunkId,
      neededReplicas
    });
    
    await chunkAssignmentService.reassignChunk(chunkId);
    
    // STEP 7: Verify healing succeeded
    const newHealthyCount = await prisma.chunkLocation.count({
      where: {
        chunkId,
        isHealthy: true,
        device: {
          status: 'ONLINE',
        },
      },
    });
    
    logger.info('Healing verification', {
      chunkId,
      beforeHealing: healthyReplicas,
      afterHealing: newHealthyCount,
      targetReplicas
    });
    
    // STEP 8: Update chunk status
    const newStatus = newHealthyCount >= targetReplicas 
      ? ChunkStatus.HEALTHY 
      : ChunkStatus.REPLICATING;
    
    await prisma.chunk.update({
      where: { id: chunkId },
      data: {
        status: newStatus,
        currentReplicas: newHealthyCount,
      },
    });
    
    // STEP 9: Update metrics
    healingMetrics.successfulHeals++;
    healingMetrics.chunksHealed.add(chunkId);
    healingMetrics.lastHealTime = Date.now();
    
    logger.info('Chunk healing completed successfully', {
      chunkId,
      finalStatus: newStatus,
      replicaCount: newHealthyCount,
      targetReplicas,
      healingTime: Date.now() - job.timestamp
    });
    
  } catch (error) {
    healingMetrics.failedHeals++;
    
    logger.error('Chunk healing failed', {
      chunkId,
      jobId: job.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Re-throw so Bull will retry
    throw error;
  }
}

/**
 * Setup healing worker
 */
export function startHealingWorker(): void {
  logger.info('Starting Healing Worker...');
  
  // Process up to 5 healing jobs concurrently
  healingQueue.process('heal-chunk', 5, async (job) => {
    await safeAsync(
      () => processHealChunkJob(job),
      `Healing job ${job.id}`
    );
  });
  
  // ========================================
  // EVENT LISTENERS
  // ========================================
  
  healingQueue.on('completed', (job) => {
    logger.info('Healing job completed', {
      jobId: job.id,
      chunkId: job.data.chunkId,
      duration: Date.now() - job.timestamp
    });
  });
  
  healingQueue.on('failed', (job, err) => {
    logger.error('Healing job failed', {
      jobId: job?.id,
      chunkId: job?.data.chunkId,
      error: err.message,
      attempt: job?.attemptsMade,
      maxAttempts: job?.opts.attempts
    });
  });
  
  healingQueue.on('stalled', (job) => {
    logger.warn('Healing job stalled (taking too long)', {
      jobId: job.id,
      chunkId: job.data.chunkId
    });
  });
  
  healingQueue.on('error', (error) => {
    logger.error('Healing queue error', {
      error: error.message
    });
  });
  
  // Log metrics every 5 minutes
  setInterval(() => {
    logHealingMetrics();
  }, 5 * 60 * 1000);
  
  logger.info('Healing Worker started successfully', {
    concurrency: 5,
    maxAttempts: 5
  });
}

/**
 * Log healing metrics
 */
function logHealingMetrics(): void {
  const successRate = healingMetrics.totalJobs > 0
    ? ((healingMetrics.successfulHeals / healingMetrics.totalJobs) * 100).toFixed(2)
    : '0';
  
  logger.info('Healing Worker Metrics', {
    totalJobs: healingMetrics.totalJobs,
    successfulHeals: healingMetrics.successfulHeals,
    failedHeals: healingMetrics.failedHeals,
    successRate: `${successRate}%`,
    uniqueChunksHealed: healingMetrics.chunksHealed.size,
    lastHealTime: new Date(healingMetrics.lastHealTime).toISOString(),
    timeSinceLastHeal: `${Math.round((Date.now() - healingMetrics.lastHealTime) / 1000)}s`
  });
}

/**
 * Get healing metrics (for API endpoint)
 */
export function getHealingMetrics() {
  return {
    ...healingMetrics,
    chunksHealed: healingMetrics.chunksHealed.size,
    successRate: healingMetrics.totalJobs > 0
      ? ((healingMetrics.successfulHeals / healingMetrics.totalJobs) * 100).toFixed(2)
      : '0'
  };
}

/**
 * Graceful shutdown
 */
export async function stopHealingWorker(): Promise<void> {
  logger.info('Stopping Healing Worker...');
  
  // Log final metrics
  logHealingMetrics();
  
  await healingQueue.close();
  logger.info('Healing Worker stopped successfully');
}

// If running directly (not imported)
if (require.main === module) {
  startHealingWorker();
  
  // Handle shutdown signals
  process.on('SIGTERM', async () => {
    await stopHealingWorker();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await stopHealingWorker();
    process.exit(0);
  });
}