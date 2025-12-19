import { Job } from 'bull';
import { healingQueue } from '../config/queue';
import { chunkAssignmentService } from '../modules/chunks/assignment.service';
import { prisma } from '../config/database';
import { ChunkStatus } from '@prisma/client';

/**
 * Healing Worker
 * 
 * What it does:
 * - Listens for healing jobs from the queue
 * - Re-replicates degraded chunks to new devices
 * - Ensures redundancy is maintained
 * - Keeps your data safe automatically!
 * 
 * Think of it like a medical emergency team:
 * - Gets alert (job from queue)
 * - Assesses situation (check chunk status)
 * - Takes action (replicate to new devices)
 * - Verifies recovery (check health after)
 * 
 * This runs SEPARATE from the main server process
 * start it with: node dist/workers/healing.worker.js
 */

// Type of the chunk you need to heal
interface HealChunkJobData {
  chunkId: string;
  currentReplicas: number;
  targetReplicas: number;
  timestamp: number;
}

/**
 * Process a chunk healing job
 * 
 * This is the main healing logic - gets called for each job in healing queue
 */
async function processHealChunkJob(job: Job<HealChunkJobData>): Promise<void> {

  // Extract the info needed for replication
  const { chunkId, currentReplicas, targetReplicas } = job.data;
  
  console.log(`🏥 [Job ${job.id}] Healing chunk ${chunkId} (${currentReplicas}/${targetReplicas} replicas)`);
  
  try {
    // Step 1: Get current chunk status
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
      include: {
        locations: {
          include: {
            device: true,
          },
        },
      },
    });
    
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    
    // Step 2: Count healthy replicas (might have changed since job was queued!)
    const healthyReplicas = chunk.locations.filter(
      loc => loc.isHealthy && loc.device.status === 'ONLINE'
    ).length;
    
    console.log(`  📊 Current health: ${healthyReplicas}/${targetReplicas} healthy replicas`);
    
    // Step 3: If already healed, skip
    if (healthyReplicas >= targetReplicas) {
      console.log(`  ✅ Chunk ${chunkId} already healed (${healthyReplicas}/${targetReplicas})`);
      return;
    }
    
    // Step 4: Calculate how many new replicas we need
    const neededReplicas = targetReplicas - healthyReplicas;
    
    console.log(`  🔄 Need to create ${neededReplicas} new replicas`);
    
    // Step 5: Re-assign chunk (this will create new ChunkLocation records)
    await chunkAssignmentService.reassignChunk(chunkId);
    
    // Step 6: We confirm that the replication has taken place
    // Count the total chunkLocations with active devices
    const newHealthyCount = await prisma.chunkLocation.count({
      where: {
        chunkId,
        isHealthy: true,
        device: {
          status: 'ONLINE',
        },
      },
    });
    
    // Update the new status of the chunk while ensuring it's fully replicated
    const newStatus = newHealthyCount >= targetReplicas 
      ? ChunkStatus.HEALTHY 
      : ChunkStatus.REPLICATING;
    
    // Update in DB  
    await prisma.chunk.update({
      where: { id: chunkId },
      data: {
        status: newStatus,
        currentReplicas: newHealthyCount,
      },
    });
    
    console.log(`  ✅ Healing complete: ${newHealthyCount}/${targetReplicas} replicas (${newStatus})`);
    
  } catch (error) {
    console.error(`  ❌ Healing failed for chunk ${chunkId}:`, error);

    // This is the worker
    // So we throw error so our Queue retries replication
    throw error; 
  }
}


/**
 * Setup healing worker
 * 
 * Now we setup the actual worker who picks up jobs from the queue
 */
export function startHealingWorker(): void {
  console.log('🦸 Starting Healing Worker...');
  

  // Here we define how to complete 1 job in healing Queue
  // It can heal up to 5 jobs concurrently
  healingQueue.process('heal-chunk', 5, processHealChunkJob); 
  

  // Like websocket events
  // We make Event listeners that talk back to our queue so it keeps updating the status
  
  // 1. completed
  healingQueue.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed successfully`);
  });
  
  // 2. failed
  healingQueue.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });
  
  // 3. working on it
  healingQueue.on('stalled', (job) => {
    console.warn(`⚠️ Job ${job.id} stalled (took too long)`);
  });
  
  // 4. error
  healingQueue.on('error', (error) => {
    console.error('❌ Queue error:', error);
  });
  
  console.log('✅ Healing Worker ready to process jobs');
}


/**
 * Graceful shutdown
 */
export async function stopHealingWorker(): Promise<void> {

  console.log('🛑 Stopping Healing Worker...');

  // Use the shutdown we defined earlier
  await healingQueue.close();
  console.log('✅ Healing Worker stopped');
}

// If running this file directly from server.ts (not imported)
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