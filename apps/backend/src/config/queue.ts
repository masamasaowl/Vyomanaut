import Bull, { Queue } from 'bull';
import { config } from './env';

/**
 * Bull Queue Configuration
 * 
 * 
 * How it works:
 * 1. Producer adds job to queue: queue.add('heal-chunk', { chunkId })
 * 2. Redis stores the job
 * 3. Worker picks up job and processes it
 * 4. Job completes or retries on failure
 */

/**
 * Create a Bull queue with default configuration
 */
function createQueue(queueName: string): Queue {
  return new Bull(queueName, {
    redis: {
      host: config.redis.host,
      port: config.redis.port,
      // No password also works
      password: config.redis.password || undefined,
    },
    defaultJobOptions: {
      attempts: 3, // Retry failed jobs 3 times
      backoff: {
        type: 'exponential', // Wait longer between each retry
        delay: 5000, // Start with 5s, then 10s, then 20s
      },
      removeOnComplete: true, // Clean up completed jobs
      removeOnFail: false, // Keep failed jobs for debugging
    },
  });
}

/**
 * Healing Queue
 * 
 * Handles chunk replication and healing tasks
 * 
 * Job types:
 * - 'heal-chunk': Replicate a degraded chunk
 * - 'check-file': Check all chunks of a file
 * - 'cleanup-temp': Clean up temporary storage
 */
export const healingQueue = createQueue('healing');


/**
 * Metrics Queue
 * 
 * Collects and processes analytics data
 * 
 * Job types:
 * - 'calculate-earnings': Update device earnings
 * - 'aggregate-metrics': Generate system statistics
 * - 'snapshot-devices': Record device status history
 */
export const metricsQueue = createQueue('metrics');

/**
 * Cleanup Queue
 * 
 * Handles cleanup and maintenance tasks
 * 
 * Job types:
 * - 'cleanup-deleted-files': Remove chunks of deleted files
 * - 'cleanup-temp-storage': Delete old temporary chunks
 * - 'prune-logs': Clean up old log files
 */
export const cleanupQueue = createQueue('cleanup');


// ========================================
// UTILITIES 
// ========================================

/**
 * Graceful shutdown for all queues
 */
export async function closeQueues(): Promise<void> {
  console.log('📦 Closing Bull queues...');
  
  // 1. stop accepting new jobs
  // 2. close all Redis connections
  await Promise.all([
    healingQueue.close(),
    metricsQueue.close(),
    cleanupQueue.close(),
  ]);
  
  console.log('✅ All queues closed');
}


/**
 * Get health status of entire queues
 */
export async function getQueueHealth(): Promise<{
  healing: { active: number; waiting: number; failed: number };
  metrics: { active: number; waiting: number; failed: number };
  cleanup: { active: number; waiting: number; failed: number };
}> {

    // Fetch how many jobs are in queue
  const [healingCounts, metricsCounts, cleanupCounts] = await Promise.all([
    healingQueue.getJobCounts(),
    metricsQueue.getJobCounts(),
    cleanupQueue.getJobCounts(),
  ]);
  
  return {
    healing: healingCounts,
    metrics: metricsCounts,
    cleanup: cleanupCounts,
  };
}